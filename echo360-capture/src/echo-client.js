// Talks to an Echo360 capture device (Pro, Pod, SafeCapture HD, or a Universal Capture: Classroom
// install) through its local Capture API: HTTP(S), Basic auth, form-encoded POSTs, XML replies.
// No Companion imports here, so the tests can drive it directly.
import http from 'node:http'
import https from 'node:https'
import { EventEmitter } from 'node:events'

export const DEFAULT_PORT = 8443
export const DEFAULT_HTTP_PORT = 8080
export const DEFAULT_POLL_MS = 2000
export const REQUEST_TIMEOUT_MS = 3000
export const CAPTURES_EVERY_MS = 10_000
export const SYSTEM_EVERY_MS = 60_000
export const BACKOFF_MS = 10_000

// ---------- tiny XML reader ----------
// The device's replies are small and flat, so a full parser isn't needed. This copes with the
// XML declaration, comments, CDATA, attributes, self-closing tags (<current/>) and entities.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s) =>
	s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
		if (e[0] === '#') {
			const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
			return Number.isFinite(n) ? String.fromCodePoint(n) : m
		}
		return ENTITIES[e] ?? m
	})

const TOKEN =
	/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/y
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Parse XML into { name, attrs, children, text }. Returns the root element. Throws on bad XML. */
export function parseXml(src) {
	const top = { name: '#document', attrs: {}, children: [], text: '' }
	const stack = [top]
	TOKEN.lastIndex = 0
	const s = String(src ?? '')
	while (TOKEN.lastIndex < s.length) {
		const m = TOKEN.exec(s)
		if (!m) throw new Error(`Bad XML near character ${TOKEN.lastIndex}`)
		const cur = stack[stack.length - 1]
		if (m[1] !== undefined) cur.text += m[1]
		else if (m[2]) {
			if (stack.length < 2 || cur.name !== m[2]) throw new Error(`Bad XML: unexpected </${m[2]}>`)
			stack.pop()
		} else if (m[3]) {
			const node = { name: m[3], attrs: {}, children: [], text: '' }
			for (const a of (m[4] || '').matchAll(ATTR)) node.attrs[a[1]] = decode(a[2] ?? a[3])
			cur.children.push(node)
			if (!m[5]) stack.push(node)
		} else if (m[6] !== undefined) cur.text += decode(m[6])
	}
	if (stack.length !== 1) throw new Error(`Bad XML: <${stack[stack.length - 1].name}> not closed`)
	const root = top.children[0]
	if (!root) throw new Error('Bad XML: empty reply')
	return root
}

/** The node at a slash path below `node` (first match at each level), or undefined. */
export function xmlGet(node, path) {
	let n = node
	for (const part of String(path).split('/').filter(Boolean)) {
		n = n?.children.find((c) => c.name === part)
		if (!n) return undefined
	}
	return n
}

/** Trimmed text at a path ('' when missing). */
export const xmlText = (node, path) => (path ? xmlGet(node, path) : node)?.text.trim() ?? ''

/** Every node matching the last part of the path, e.g. 'capture-profiles/capture-profile'. */
export function xmlAll(node, path) {
	const parts = String(path).split('/').filter(Boolean)
	const last = parts.pop()
	const parent = parts.length ? xmlGet(node, parts.join('/')) : node
	return parent ? parent.children.filter((c) => c.name === last) : []
}

/** First descendant with this tag name, depth first. */
export function xmlFind(node, name) {
	if (!node) return undefined
	for (const c of node.children) {
		if (c.name === name) return c
		const f = xmlFind(c, name)
		if (f) return f
	}
	return undefined
}

/** True when an element has no text and no non-empty children (e.g. <current/> or <current><schedule/></current>). */
export function xmlIsEmpty(node) {
	if (!node) return true
	if (node.text.trim()) return false
	return node.children.every(xmlIsEmpty)
}

// ---------- helpers ----------

/** Form-encode values only (so '&' and '=' between pairs stay literal). Spaces become '+'. */
export function encodeForm(pairs) {
	return Object.entries(pairs)
		.map(([k, v]) => `${enc(k)}=${enc(v)}`)
		.join('&')
}
const enc = (v) => encodeURIComponent(String(v ?? '')).replace(/%20/g, '+')

/** Device times are GMT ISO strings; treat a time with no zone as GMT too. */
export function parseDeviceTime(s) {
	const t = String(s ?? '').trim()
	if (!t) return undefined
	const hasZone = /(Z|[+-]\d\d:?\d\d)$/i.test(t)
	const ms = Date.parse(hasZone ? t : t + 'Z')
	return Number.isFinite(ms) ? ms : undefined
}

export class EchoError extends Error {
	constructor(code, message) {
		super(message)
		this.code = code
	}
}

/** What each raw state means for the buttons. */
export const STATE_LABELS = {
	active: 'REC',
	paused: 'PAUSED',
	waiting: 'STARTING',
	pending: 'STARTING',
	inactive: 'IDLE',
	complete: 'DONE',
}

const emptyCapture = () => ({ title: '', section: '', presenter: '', profile: '', start: undefined, duration: undefined })

function readCapture(node) {
	if (xmlIsEmpty(node)) return undefined
	const sched = xmlGet(node, 'schedule')
	const params = xmlGet(sched, 'parameters') ?? xmlFind(node, 'parameters')
	const presenters = xmlAll(params ?? node, 'presenters/presenter').map((p) => xmlText(p)).filter(Boolean)
	return {
		state: xmlText(node, 'state'),
		title: xmlText(params, 'title'),
		section: xmlText(params, 'section'),
		presenter: presenters.join(', ') || xmlText(xmlFind(node, 'presenter')),
		profile: xmlText(params, 'capture-profile/name') || xmlText(params, 'capture-profile'),
		start: parseDeviceTime(xmlText(node, 'start-time') || xmlText(sched, 'start-time')),
		duration: Number(xmlText(node, 'duration') || xmlText(sched, 'duration')) || undefined,
	}
}

// ---------- the client ----------

/**
 * Events:
 *  'status' (status, message)   status is 'ok' | 'connecting' | 'bad_config' | 'connection_failure' | 'unknown_warning'
 *  'change' ()                  anything shown on buttons changed
 *  'system' ()                  /status/system was (re)read; profiles may have changed
 *  'state' (state, previous)    the capture state changed
 *  'log' (level, message)       never contains titles, sections or presenters at info level
 */
export class EchoClient extends EventEmitter {
	constructor(timing = {}) {
		super()
		this.timing = {
			requestTimeoutMs: REQUEST_TIMEOUT_MS,
			capturesEveryMs: CAPTURES_EVERY_MS,
			systemEveryMs: SYSTEM_EVERY_MS,
			backoffMs: BACKOFF_MS,
			...timing,
		}
		this.config = {}
		this.running = false
		this.gen = 0
		this.queue = Promise.resolve()
		this.#reset()
	}

	#reset() {
		this.connected = false
		this.status = 'connecting'
		this.state = '' // '' = unknown
		this.stateAt = 0 // local ms of the last good /status/monitoring
		this.startTime = undefined // device ms
		this.duration = undefined // seconds
		this.current = emptyCapture()
		this.next = undefined
		this.system = undefined
		this.systemAt = 0
		this.capturesAt = 0
		this.clockOffset = 0 // device clock minus local clock, ms
		this.failures = 0
		this.lastMessage = ''
		this.lastError = undefined // { text, at }
	}

	/** host, protocol ('https'|'http'), port, username, password, pollMs, legacyTls */
	configure(config) {
		this.config = { ...config }
		const legacy = !!config.legacyTls
		// Module-local agents: certificate checks are skipped only for this device connection (they use
		// self-signed certificates), never process-wide. No keep-alive: old units dislike held sockets.
		this.agent =
			config.protocol === 'http'
				? new http.Agent({ keepAlive: false, maxSockets: 1 })
				: new https.Agent({
						keepAlive: false,
						maxSockets: 1,
						rejectUnauthorized: false,
						...(legacy ? { minVersion: 'TLSv1', ciphers: 'DEFAULT:@SECLEVEL=0' } : {}),
					})
	}

	get pollMs() {
		const n = Number(this.config.pollMs)
		return Number.isFinite(n) ? Math.min(10_000, Math.max(this.timing.minPollMs ?? 1000, n)) : DEFAULT_POLL_MS
	}

	start() {
		this.stop()
		this.#reset()
		this.running = true
		const gen = this.gen
		if (!this.config.host) {
			this.#setStatus('bad_config', 'Enter the capture device address')
			this.running = false
			return
		}
		this.#setStatus('connecting')
		this.timer = setTimeout(() => this.#tick(gen), 0)
	}

	stop() {
		this.running = false
		this.gen++
		clearTimeout(this.timer)
		this.timer = undefined
		this.polling = false
		this.pollAgain = false
	}

	/** Poll straight away (after a command, or the Refresh action). Also re-reads the current capture. */
	pollNow() {
		if (!this.running) return
		this.forceCaptures = true
		if (this.polling) {
			this.pollAgain = true
			return
		}
		clearTimeout(this.timer)
		const gen = this.gen
		this.timer = setTimeout(() => this.#tick(gen), 0)
	}

	/** Device clock now, in ms. */
	deviceNow(now = Date.now()) {
		return now + this.clockOffset
	}

	/** Seconds since the capture started (wall clock on the device, so it includes pauses). */
	elapsedSeconds(now = Date.now()) {
		if (!['active', 'paused'].includes(this.state) || this.startTime === undefined) return undefined
		return Math.max(0, Math.floor((this.deviceNow(now) - this.startTime) / 1000))
	}

	/** Seconds until start + duration. */
	remainingSeconds(now = Date.now()) {
		if (!['active', 'paused', 'waiting'].includes(this.state) || this.startTime === undefined || !this.duration) return undefined
		return Math.max(0, Math.ceil((this.startTime + this.duration * 1000 - this.deviceNow(now)) / 1000))
	}

	/** Local ms when the capture is due to end. */
	endTimeLocal() {
		if (this.startTime === undefined || !this.duration) return undefined
		return this.startTime + this.duration * 1000 - this.clockOffset
	}

	/** How old the last state reading is, in ms (Infinity when there isn't one). */
	stateAge(now = Date.now()) {
		return this.stateAt ? now - this.stateAt : Infinity
	}

	// ---------- HTTP ----------

	/** One request at a time: everything (polls and commands) goes through this queue. */
	request(method, path, body = '') {
		const run = () => this.#send(method, path, body)
		const p = this.queue.then(run, run)
		this.queue = p.catch(() => {})
		return p
	}

	#send(method, path, body) {
		const c = this.config
		const lib = c.protocol === 'http' ? http : https
		const auth = Buffer.from(`${c.username ?? ''}:${c.password ?? ''}`).toString('base64')
		const headers = { Authorization: `Basic ${auth}`, Accept: 'text/xml, application/xml', Connection: 'close' }
		if (method === 'POST') {
			headers['Content-Type'] = 'application/x-www-form-urlencoded'
			headers['Content-Length'] = Buffer.byteLength(body)
		}
		const port = Number(c.port) || (c.protocol === 'http' ? DEFAULT_HTTP_PORT : DEFAULT_PORT)
		return new Promise((resolve, reject) => {
			let done = false
			const finish = (err, res) => {
				if (done) return
				done = true
				clearTimeout(timer)
				err ? reject(err) : resolve(res)
			}
			const req = lib.request({ host: c.host, port, path, method, headers, agent: this.agent }, (res) => {
				const chunks = []
				res.on('data', (d) => chunks.push(d))
				res.on('end', () => finish(null, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), at: Date.now() }))
				res.on('error', (e) => finish(new EchoError(e.code || 'ERROR', e.message)))
			})
			const timer = setTimeout(() => {
				finish(new EchoError('TIMEOUT', `No reply from the device within ${this.timing.requestTimeoutMs / 1000} s`))
				req.destroy()
			}, this.timing.requestTimeoutMs)
			req.on('error', (e) => finish(new EchoError(e.code || 'ERROR', e.message)))
			req.end(method === 'POST' ? body : undefined)
		})
	}

	/** GET a status page and parse it. Throws EchoError (AUTH, HTTP, XML, TIMEOUT, ECONNREFUSED...). */
	async getStatus(name) {
		const sent = Date.now()
		const res = await this.request('GET', `/status/${name}`)
		if (res.status === 401 || res.status === 403) throw new EchoError('AUTH', 'Wrong username or password')
		if (res.status !== 200) throw new EchoError('HTTP', `HTTP ${res.status} from /status/${name}`)
		let xml
		try {
			xml = parseXml(res.body)
		} catch (e) {
			throw new EchoError('XML', `Couldn't read /status/${name}: ${e.message}`)
		}
		// Keep the device's clock offset, measured at the middle of the request.
		const wall = parseDeviceTime(xmlText(xml, 'wall-clock-time'))
		if (wall !== undefined) this.clockOffset = wall - Math.round((sent + res.at) / 2)
		return xml
	}

	// ---------- polling ----------

	async #tick(gen) {
		if (!this.running || gen !== this.gen) return
		this.polling = true
		let delay
		try {
			await this.#pollOnce()
			if (gen !== this.gen) return
			this.failures = 0
			if (!this.connected) {
				this.connected = true
				this.log('info', 'Connected to the capture device')
			}
			this.#setStatus('ok')
			delay = this.pollMs
		} catch (e) {
			if (gen !== this.gen) return
			delay = this.#pollFailed(e)
		} finally {
			if (gen === this.gen) this.polling = false
		}
		this.emit('change')
		if (this.pollAgain) {
			this.pollAgain = false
			delay = 0
		}
		if (this.running && gen === this.gen) this.timer = setTimeout(() => this.#tick(gen), delay)
	}

	async #pollOnce() {
		const now = Date.now()
		if (!this.system || now - this.systemAt >= this.timing.systemEveryMs) await this.#readSystem()
		await this.#readMonitoring()
		if (this.forceCaptures || now - this.capturesAt >= this.timing.capturesEveryMs) {
			this.forceCaptures = false
			await this.#readCaptures()
		}
	}

	#pollFailed(e) {
		this.failures++
		if (e.code === 'AUTH') {
			this.#goOffline()
			this.#setStatus('bad_config', 'Wrong username or password (use the device\'s "Local Generic User Login")')
			return this.timing.backoffMs
		}
		if (e.code === 'XML' || e.code === 'HTTP') {
			this.#setStatus('unknown_warning', e.message)
			if (this.failures >= 2) this.#goOffline()
			return this.connected ? this.pollMs : this.timing.backoffMs
		}
		// Timeout, refused, unreachable. One missed poll while connected gets a quick retry; after
		// that, show it as offline and back off so a struggling device isn't hammered.
		if (this.connected && this.failures < 2) {
			this.log('debug', `Poll failed (${e.code}), retrying`)
			return this.pollMs
		}
		if (this.connected || this.status !== 'connection_failure') this.log('warn', `Lost the capture device: ${e.message}`)
		this.#goOffline()
		this.#setStatus('connection_failure', e.code === 'TIMEOUT' ? e.message : `Can't reach the device (${e.code})`)
		return this.timing.backoffMs
	}

	#goOffline() {
		const was = this.state
		this.connected = false
		this.state = ''
		this.stateAt = 0
		this.startTime = undefined
		this.duration = undefined
		this.current = emptyCapture()
		this.next = undefined
		this.system = undefined // re-read on reconnect
		if (was) this.emit('state', '', was)
	}

	async #readSystem() {
		const x = await this.getStatus('system')
		const prevProfiles = JSON.stringify(this.system?.profiles ?? [])
		const apis = xmlAll(x, 'api-versions/api-version').map((n) => xmlText(n)).filter(Boolean)
		this.system = {
			name: xmlText(x, 'device-name') || xmlText(x, 'name') || xmlText(x, 'host-address'),
			serial: xmlText(x, 'serial-number'),
			version: xmlText(x, 'system-version'),
			apiVersion: apis[apis.length - 1] ?? '',
			location: xmlText(x, 'location'),
			profiles: xmlAll(x, 'capture-profiles/capture-profile').map((n) => xmlText(n)).filter(Boolean),
			monitorProfiles: xmlAll(x, 'monitor-profiles/monitor-profile').map((n) => xmlText(n)).filter(Boolean),
			maxCaptureMinutes: Number(xmlText(x, 'max-capture-duration-minutes')) || undefined,
			maxExtendMinutes: Number(xmlText(x, 'max-live-capture-extend-duration-minutes')) || undefined,
		}
		this.systemAt = Date.now()
		if (JSON.stringify(this.system.profiles) !== prevProfiles) {
			this.log('info', `Device has ${this.system.profiles.length} capture profile(s)`)
		}
		this.emit('system')
	}

	async #readMonitoring() {
		const x = await this.getStatus('monitoring')
		const state = xmlText(x, 'state') || 'inactive'
		this.stateAt = Date.now()
		if (['active', 'paused', 'waiting', 'pending'].includes(state)) {
			this.startTime = parseDeviceTime(xmlText(x, 'start-time')) ?? this.startTime
			this.duration = Number(xmlText(x, 'duration')) || this.duration
		} else if (state !== 'complete') {
			this.startTime = undefined
			this.duration = undefined
		}
		if (state !== this.state) {
			const prev = this.state
			this.state = state
			this.log('info', `Capture state: ${state}`)
			this.emit('state', state, prev)
			// The current capture changed: re-read titles on the next poll.
			this.forceCaptures = true
		}
	}

	async #readCaptures() {
		const x = await this.getStatus('captures')
		const cur = readCapture(xmlGet(x, 'current'))
		this.current = cur ? { ...emptyCapture(), ...cur } : emptyCapture()
		// Fill in start/duration from here if monitoring didn't give them.
		if (cur && ['active', 'paused', 'waiting'].includes(this.state)) {
			if (this.startTime === undefined) this.startTime = cur.start
			if (!this.duration) this.duration = cur.duration
		}
		this.next = readCapture(xmlGet(x, 'next'))
		this.capturesAt = Date.now()
	}

	// ---------- commands ----------

	/**
	 * Send one capture command. Never retried: on a timeout the device may still have acted, so the
	 * next poll shows the truth. Always polls straight after. Returns { ok, text }.
	 */
	async command(name, form) {
		const body = form ? encodeForm(form) : ''
		let result
		try {
			const res = await this.request('POST', `/capture/${name}`, body)
			if (res.status === 401 || res.status === 403) {
				this.#setStatus('bad_config', 'Wrong username or password')
				result = { ok: false, text: 'Wrong username or password' }
			} else {
				let root
				try {
					root = parseXml(res.body)
				} catch {
					root = undefined
				}
				if (root?.name === 'ok') result = { ok: true, text: root.attrs.text || root.text.trim() || 'OK' }
				else if (root?.name === 'error') result = { ok: false, text: root.attrs.text || root.text.trim() || 'Error' }
				else if (res.status >= 200 && res.status < 300) result = { ok: true, text: `${name}: sent` }
				else result = { ok: false, text: `HTTP ${res.status}` }
			}
		} catch (e) {
			result = {
				ok: false,
				text:
					e.code === 'TIMEOUT'
						? `No reply to ${name} (not retried: check the device state)`
						: `Couldn't send ${name}: ${e.code || e.message}`,
			}
		}
		this.lastMessage = result.text
		if (!result.ok) this.lastError = { text: result.text, at: Date.now() }
		// Device replies are fixed phrases ("Command (pause) submitted"), never titles.
		this.log(result.ok ? 'info' : 'warn', `${name}: ${result.text}`)
		this.emit('change')
		this.pollNow()
		return result
	}

	/** Record a refusal from the module itself (no request sent). */
	refuse(text) {
		this.lastMessage = text
		this.log('info', text)
		this.emit('change')
	}

	log(level, msg) {
		this.emit('log', level, msg)
	}

	#setStatus(status, message) {
		if (status === this.status && message === this.statusMessage) return
		this.status = status
		this.statusMessage = message
		this.emit('status', status, message)
	}
}
