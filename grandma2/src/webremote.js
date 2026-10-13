// grandMA2 Web Remote client: the JSON-over-WebSocket protocol the browser remote uses.
//
// Not documented by MA Lighting. Worked out from community projects (johnsudaar/xtouchgma2,
// klnspdr/node-grandma2, ArtGateOne/ma2apcmini) and not yet tested on onPC 3.9.60.89.
//
//   connect   ws://<ip>:80/?ma=1
//   client -> {"session":0}                      server -> {"status":"server ready"}, {"session":S,"forceLogin":true}
//   client -> {"requestType":"login","username":U,"password":md5(P),"session":S,"maxRequests":10}
//   server -> {"responseType":"login","result":true|false}
//   keep-alive: {"session":S} every few seconds
//   poll:     {"requestType":"playbacks","startIndex":[0],"itemsCount":[15],"pageIndex":0,"itemsType":[2],...}
//   fader:    {"requestType":"playbacks_userInput","execIndex":4,"pageIndex":0,"faderValue":0.5,"type":1,...}
//   button:   {"requestType":"playbacks_userInput","execIndex":4,"pageIndex":0,"buttonId":0,"pressed":true,"released":false,"type":0,...}
//   command:  {"requestType":"command","command":"Go Executor 1.5","session":S,"maxRequests":0}
//
// Pages and executors are 0-based on the wire. Executors come back in blocks of 5.
// Uses Node 22's built-in global WebSocket: no extra packages.
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'

export const DEFAULT_WEB_PORT = 80
const RECONNECT_STEPS_MS = [1000, 2000, 5000, 10000, 30000]
const KEEPALIVE_MS = 10000
const SILENCE_MS = 10000
const POLL_STALE_MS = 2000 // a poll with no reply after this long doesn't block the next one
const FADER_MIN_GAP_MS = 40 // per executor: at most one fader message per 40 ms, latest value wins

export const md5hex = (text) =>
	createHash('md5')
		.update(String(text ?? ''), 'utf8')
		.digest('hex')

/** Executor numbers (1-based, 1-100 fader, 101+ button) -> poll ranges in blocks of 5 (0-based). */
export function pollRanges(execs) {
	const ranges = []
	for (const type of [2, 3]) {
		const blocks = [...new Set(execs.filter((e) => (type === 2 ? e <= 100 : e > 100)).map((e) => Math.floor((e - 1) / 5) * 5))].sort((a, b) => a - b)
		for (const b of blocks) {
			const last = ranges[ranges.length - 1]
			if (last && last.type === type && last.start + last.count === b) last.count += 5
			else ranges.push({ start: b, count: 5, type })
		}
	}
	return ranges
}

export function playbacksRequest(session, pageIndex, ranges) {
	return {
		requestType: 'playbacks',
		startIndex: ranges.map((r) => r.start),
		itemsCount: ranges.map((r) => r.count),
		pageIndex,
		itemsType: ranges.map((r) => r.type),
		view: 2,
		execButtonViewMode: 1,
		buttonsViewMode: 0,
		session,
		maxRequests: 1,
	}
}

const text = (o) => (o && typeof o === 'object' && typeof o.t === 'string' ? o.t.trim() : '')

/** Cue list text: 3 items = previous, current, next (as xtouchgma2 reads it). */
export function parseCues(cues) {
	const items = Array.isArray(cues?.items) ? cues.items.map(text) : []
	if (items.length >= 3) return { prev: items[0], cur: items[1], next: items[2] }
	if (items.length === 2) return { prev: '', cur: items[0], next: items[1] }
	if (items.length === 1) return { prev: '', cur: items[0], next: '' }
	return { prev: '', cur: '', next: '' }
}

/** Fader block -> 0-100 %, or undefined. */
export function faderPercent(f) {
	if (!f || typeof f !== 'object') return undefined
	const v = Number(f.v)
	if (!Number.isFinite(v)) return undefined
	const min = Number.isFinite(Number(f.min)) ? Number(f.min) : 0
	const max = Number.isFinite(Number(f.max)) ? Number(f.max) : 1
	const pct = max > min ? ((v - min) / (max - min)) * 100 : v <= 1 ? v * 100 : v
	return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10
}

/**
 * Turn a "playbacks" reply into executor states.
 * @param {object} msg the reply
 * @param {{start:number,count:number,type:number}[]} ranges the ranges that were requested, in order
 * @returns {Map<number, {exec:number,name:string,level?:number,levelText:string,running:boolean,cue:string,next:string,prev:string,buttons:string[]}>}
 */
export function parsePlaybacks(msg, ranges) {
	const out = new Map()
	const groups = Array.isArray(msg?.itemGroups) ? msg.itemGroups : []
	groups.forEach((group, g) => {
		const range = ranges[g]
		if (!range || !Array.isArray(group?.items)) return
		group.items.forEach((block, b) => {
			if (!Array.isArray(block)) return
			let cursor = range.start + b * 5 // 0-based executor index
			for (const item of block) {
				if (!item || typeof item !== 'object') {
					cursor++
					continue
				}
				const blocks = Array.isArray(item.executorBlocks) ? item.executorBlocks : []
				const width = Math.max(1, Number(item.combinedItems) || 0, blocks.length)
				const cues = parseCues(item.cues)
				const name = text(item.tt)
				for (let k = 0; k < width; k++) {
					const eb = blocks[k] ?? {}
					const fader = eb.fader
					const state = {
						exec: cursor + k + 1,
						name,
						level: faderPercent(fader),
						levelText: typeof fader?.vT === 'string' ? fader.vT.trim() : '',
						running: Boolean(item.isRun) && item.isRun !== '0',
						...cues,
						buttons: [eb.button1, eb.button2, eb.button3].map(text),
					}
					if (state.level === undefined && item.bottomButtons?.items?.[k]?.fader) state.level = faderPercent(item.bottomButtons.items[k].fader)
					out.set(state.exec, state)
				}
				cursor += width
			}
		})
	})
	return out
}

export class WebRemote extends EventEmitter {
	#ws = null
	#stopped = true
	#attempt = 0
	#reconnectTimer = null
	#keepAliveTimer = null
	#pollTimer = null
	#session = 0
	#loginSent = false
	#lastRx = 0
	#pollAt = 0
	#pollRanges = []
	#pollPage = 0
	#faderPending = new Map()
	#faderLast = new Map()
	#faderTimers = new Map()

	/** off | connecting | ok | refused | error */
	state = 'off'
	message = ''
	/** Latest executor states from polling, by executor number. */
	executors = new Map()

	constructor(opts = {}) {
		super()
		this.WebSocketImpl = opts.WebSocket ?? globalThis.WebSocket
		this.reconnectSteps = opts.reconnectSteps ?? RECONNECT_STEPS_MS
		this.keepAliveMs = opts.keepAliveMs ?? KEEPALIVE_MS
		this.silenceMs = opts.silenceMs ?? SILENCE_MS
		this.faderGapMs = opts.faderGapMs ?? FADER_MIN_GAP_MS
		this.config = {}
	}

	/** @param {object} c host, port, user, pass, pollMs, page (1-based), execs (1-based numbers) */
	start(c) {
		this.stop()
		this.config = { ...c, port: Number(c.port) || DEFAULT_WEB_PORT, pollMs: Math.max(50, Number(c.pollMs) || 250) }
		if (!this.WebSocketImpl) return this.#setState('error', 'This Node.js has no built-in WebSocket (needs Node 22)')
		if (!c.host) return this.#setState('error', 'No console IP set')
		this.#stopped = false
		this.#attempt = 0
		this.#connect()
	}

	stop() {
		this.#stopped = true
		clearTimeout(this.#reconnectTimer)
		clearInterval(this.#keepAliveTimer)
		clearInterval(this.#pollTimer)
		for (const t of this.#faderTimers.values()) clearTimeout(t)
		this.#faderTimers.clear()
		this.#faderPending.clear()
		this.#reconnectTimer = this.#keepAliveTimer = this.#pollTimer = null
		this.#closeSocket()
		this.#setState('off', '')
	}

	get ok() {
		return this.state === 'ok'
	}

	/** Change what is polled (page 1-based, executor numbers). */
	watch(page, execs) {
		this.config.page = page
		this.config.execs = execs
	}

	#closeSocket() {
		const ws = this.#ws
		this.#ws = null
		if (!ws) return
		ws.onopen = ws.onmessage = ws.onclose = null
		ws.onerror = () => null
		try {
			ws.close()
		} catch {
			// already closed
		}
	}

	#setState(state, message = '') {
		if (this.state === state && this.message === message) return
		this.state = state
		this.message = message
		this.emit('state', state, message)
	}

	#connect() {
		if (this.#stopped) return
		this.#reconnectTimer = null
		this.#session = 0
		this.#loginSent = false
		this.#pollAt = 0
		this.#setState('connecting', 'Connecting to Web Remote')
		let ws
		try {
			ws = new this.WebSocketImpl(`ws://${this.config.host}:${this.config.port}/?ma=1`)
		} catch (e) {
			this.#setState('error', `Web Remote: ${e.message}`)
			return this.#scheduleReconnect()
		}
		this.#ws = ws
		ws.onopen = () => {
			this.#lastRx = Date.now()
			this.#send({ session: 0 })
			clearInterval(this.#keepAliveTimer)
			this.#keepAliveTimer = setInterval(() => this.#keepAlive(), this.keepAliveMs)
		}
		ws.onmessage = (ev) => {
			try {
				this.#onMessage(ev.data)
			} catch (e) {
				this.emit('log', 'debug', `Ignored bad Web Remote message: ${e.message}`)
			}
		}
		ws.onerror = () => this.emit('log', 'debug', 'Web Remote socket error')
		ws.onclose = () => {
			if (ws !== this.#ws) return
			this.#ws = null
			clearInterval(this.#keepAliveTimer)
			clearInterval(this.#pollTimer)
			this.#keepAliveTimer = this.#pollTimer = null
			if (this.state !== 'refused') this.#setState('error', 'Web Remote not reachable')
			this.#scheduleReconnect()
		}
	}

	#scheduleReconnect() {
		if (this.#stopped || this.#reconnectTimer) return
		const steps = this.reconnectSteps
		// After a refused login, wait the longest step: retrying fast won't fix a password.
		const delay = this.state === 'refused' ? steps[steps.length - 1] : steps[Math.min(this.#attempt, steps.length - 1)]
		this.#attempt++
		this.#reconnectTimer = setTimeout(() => this.#connect(), delay)
	}

	#send(obj) {
		const ws = this.#ws
		if (!ws || ws.readyState !== 1) return false
		try {
			ws.send(JSON.stringify(obj))
			return true
		} catch (e) {
			this.emit('log', 'debug', `Web Remote send failed: ${e.message}`)
			return false
		}
	}

	#keepAlive() {
		if (this.ok && Date.now() - this.#lastRx > this.silenceMs) {
			this.emit('log', 'warn', 'Web Remote stopped answering: reconnecting')
			this.#setState('error', 'Web Remote stopped answering')
			this.#giveUpForNow()
			return
		}
		if (this.#session > 0) this.#send({ session: this.#session })
	}

	#onMessage(data) {
		this.#lastRx = Date.now()
		let raw = data
		if (typeof raw !== 'string') {
			if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) raw = Buffer.from(raw).toString('utf8')
			else return
		}
		let msg
		try {
			msg = JSON.parse(raw)
		} catch {
			return
		}
		if (!msg || typeof msg !== 'object') return

		if (typeof msg.session === 'number') {
			if (msg.session === -1) {
				this.#setState('refused', 'Web Remote is switched off on the console (Setup → Console → Global Settings → Remotes)')
				this.#giveUpForNow()
				return
			}
			if (msg.session > 0) this.#session = msg.session
			// Log in whether or not the console insists (forceLogin): it's harmless when it doesn't.
			if (this.#session > 0 && !this.#loginSent) {
				this.#loginSent = true
				this.#send({
					requestType: 'login',
					username: String(this.config.user ?? ''),
					password: md5hex(this.config.pass),
					session: this.#session,
					maxRequests: 10,
				})
			}
		}
		if (msg.status === 'server ready' && this.#session === 0 && !this.#loginSent) this.#send({ session: 0 })

		if (msg.responseType === 'login') {
			if (msg.result === true) {
				this.#attempt = 0
				this.#setState('ok', 'Web Remote logged in')
				this.#startPolling()
			} else {
				this.#setState('refused', 'Web Remote login refused: check user and password (Administrator is not allowed; max 3 remote users)')
				this.emit('log', 'error', 'Web Remote login refused')
				this.#giveUpForNow()
			}
			return
		}
		if (msg.responseType === 'playbacks') {
			this.#pollAt = 0
			const states = parsePlaybacks(msg, this.#pollRanges)
			if (states.size) {
				for (const [n, s] of states) this.executors.set(n, s)
				this.emit('playbacks', states, this.#pollPage)
			}
		}
	}

	/** Close and retry after the longest wait (a refusal won't fix itself in a second). */
	#giveUpForNow() {
		this.#closeSocket()
		clearInterval(this.#keepAliveTimer)
		clearInterval(this.#pollTimer)
		this.#keepAliveTimer = this.#pollTimer = null
		this.#scheduleReconnect()
	}

	#startPolling() {
		clearInterval(this.#pollTimer)
		this.#poll()
		this.#pollTimer = setInterval(() => this.#poll(), this.config.pollMs)
	}

	#poll() {
		if (!this.ok) return
		if (this.#pollAt && Date.now() - this.#pollAt < POLL_STALE_MS) return // previous one still out
		const execs = Array.isArray(this.config.execs) ? this.config.execs : []
		const ranges = pollRanges(execs)
		if (!ranges.length) return
		const page = Math.max(1, Number(this.config.page) || 1)
		if (page !== this.#pollPage) this.executors.clear()
		this.#pollRanges = ranges
		this.#pollPage = page
		this.#pollAt = Date.now()
		this.#send(playbacksRequest(this.#session, page - 1, ranges))
	}

	/** Set a fader (0-100 %). Merged per executor: only the newest value goes out. */
	setFader(page, exec, percent) {
		if (!this.ok) return false
		const key = `${page}.${exec}`
		this.#faderPending.set(key, { page, exec, value: Math.min(100, Math.max(0, percent)) / 100 })
		if (this.#faderTimers.has(key)) return true
		const wait = Math.max(0, this.faderGapMs - (Date.now() - (this.#faderLast.get(key) ?? 0)))
		const flush = () => {
			this.#faderTimers.delete(key)
			const p = this.#faderPending.get(key)
			if (!p) return
			this.#faderPending.delete(key)
			this.#faderLast.set(key, Date.now())
			this.#send({
				requestType: 'playbacks_userInput',
				cmdline: '',
				execIndex: p.exec - 1,
				pageIndex: p.page - 1,
				faderValue: Math.round(p.value * 1000) / 1000,
				type: 1,
				session: this.#session,
				maxRequests: 0,
			})
		}
		if (wait === 0) flush()
		else this.#faderTimers.set(key, setTimeout(flush, wait))
		return true
	}

	/** Press or release one of an executor's buttons (1-3). Sent once, never retried. */
	button(page, exec, button, pressed) {
		if (!this.ok) return false
		return this.#send({
			requestType: 'playbacks_userInput',
			cmdline: '',
			execIndex: exec - 1,
			pageIndex: page - 1,
			buttonId: Math.min(2, Math.max(0, button - 1)),
			pressed: Boolean(pressed),
			released: !pressed,
			type: 0,
			session: this.#session,
			maxRequests: 0,
		})
	}

	command(cmd) {
		if (!this.ok) return false
		return this.#send({ requestType: 'command', command: String(cmd), session: this.#session, maxRequests: 0 })
	}
}
