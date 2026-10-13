// The module's model of the console: which page and executors we watch, the selected executor,
// fader levels (read back from the Web Remote, or tracked from what we sent), and how each
// action turns into a command on Telnet or the Web Remote.
import { EventEmitter } from 'node:events'
import { MA2Telnet } from './telnet.js'
import { WebRemote } from './webremote.js'

export const STEP_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
export const DEFAULT_STEP_SIZE = 2
/** Fader % per knob click for step sizes 1-10. */
export const PERCENT_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20]
export const DEFAULT_EXECS = '1-15'
export const DEFAULT_FADER_TEMPLATE = 'Fader {page}.{exec} At {level}'
export const DEFAULT_GM_TEMPLATE = 'SpecialMaster "grandmaster"."grand" At {level}'
const MAX_EXECS = 120
// After we move a fader, trust our own value over the Web Remote's for this long, so a poll
// that left the console before our change can't drag the knob backwards mid-turn.
const ECHO_GUARD_MS = 1000

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const round1 = (n) => Math.round(n * 10) / 10

export function stepLevel(options) {
	const n = Math.round(Number(options?.size))
	return STEP_SIZES.includes(n) ? n : DEFAULT_STEP_SIZE
}

/** % change for one click (negative for down). */
export function stepDelta(options) {
	return PERCENT_STEPS[stepLevel(options) - 1] * (options?.direction === 'down' ? -1 : 1)
}

/** Next level after one click, clamped to 0-100. Unknown levels count as 0. */
export function stepPercent(current, delta) {
	const base = Number.isFinite(Number(current)) && current !== null && current !== '' ? Number(current) : 0
	return clamp(round1(base + Number(delta || 0)), 0, 100)
}

/** "1-15, 101-105, 20" -> [1..15, 20, 101..105]. Executors 1-999; at most 120. */
export function parseExecList(text) {
	const out = new Set()
	for (const part of String(text ?? '').split(/[,;\s]+/)) {
		const m = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(part.trim())
		if (!m) continue
		let a = Number(m[1])
		let b = Number(m[2] ?? m[1])
		if (a > b) [a, b] = [b, a]
		for (let n = Math.max(1, a); n <= Math.min(999, b) && out.size < MAX_EXECS; n++) out.add(n)
	}
	return [...out].sort((x, y) => x - y)
}

export const formatLevel = (n) => (Number.isFinite(Number(n)) && n !== undefined && n !== null ? String(round1(Number(n))) : '')

/** Fill {page}, {exec}, {level} in a command template. */
export function fillTemplate(template, values) {
	return String(template).replace(/\{(page|exec|level)\}/g, (_, k) => String(values[k]))
}

/** Executor command keywords. Flash/Temp On/Off are the latching Telnet fallback. */
export const EXEC_VERBS = {
	go: 'Go Executor',
	goback: 'GoBack Executor',
	pause: 'Pause Executor',
	off: 'Off Executor',
	on: 'On Executor',
	toggle: 'Toggle Executor',
	top: 'Top Executor',
	select: 'Select Executor',
	flash_on: 'Flash On Executor',
	flash_off: 'Flash Off Executor',
	temp_on: 'Temp On Executor',
	temp_off: 'Temp Off Executor',
}

export class MA2Console extends EventEmitter {
	page = 1
	execs = parseExecList(DEFAULT_EXECS)
	selected = 1
	gm = 100
	/** Levels we sent, "page.exec" -> { value, at } */
	targets = new Map()
	/** Web Remote readback, "page.exec" -> state */
	polled = new Map()
	/** For the fader on/off push: level before it went to 0. */
	lastOn = new Map()
	config = {}

	constructor(opts = {}) {
		super()
		this.telnet = opts.telnet ?? new MA2Telnet(opts.telnetOptions)
		this.wr = opts.webremote ?? new WebRemote(opts.webRemoteOptions)
		this.echoGuardMs = opts.echoGuardMs ?? ECHO_GUARD_MS
		this.telnet.on('log', (l, m) => this.emit('log', l, m))
		this.wr.on('log', (l, m) => this.emit('log', l, m))
		this.telnet.on('state', () => this.emit('status'))
		this.wr.on('state', () => this.emit('status'))
		this.telnet.on('line', (line) => this.emit('line', line))
		this.wr.on('playbacks', (states, page) => {
			for (const [exec, s] of states) this.polled.set(`${page}.${exec}`, { ...s, at: Date.now() })
			this.emit('change')
		})
	}

	/** Apply connection settings and (re)start the links. */
	configure(c) {
		this.config = {
			host: String(c.host ?? '').trim(),
			telnetPort: Number(c.telnet_port) || 30000,
			login: c.login !== false,
			user: c.user ?? 'administrator',
			pass: c.pass ?? '',
			spacingMs: Number(c.spacing_ms ?? 50),
			heartbeatMs: (Number(c.heartbeat_s) || 10) * 1000,
			heartbeatCommand: String(c.heartbeat_cmd ?? ''),
			webRemote: Boolean(c.wr_enable),
			wrPort: Number(c.wr_port) || 80,
			wrUser: c.wr_user ?? '',
			wrPass: c.wr_pass ?? '',
			pollMs: Number(c.poll_ms) || 250,
			faderVia: c.fader_via === 'telnet' ? 'telnet' : 'auto',
			faderTemplate: String(c.fader_template || DEFAULT_FADER_TEMPLATE),
			gmTemplate: String(c.gm_template || DEFAULT_GM_TEMPLATE),
			selectFollow: Boolean(c.select_follow),
		}
		const execs = parseExecList(c.execs ?? DEFAULT_EXECS)
		this.execs = execs.length ? execs : parseExecList(DEFAULT_EXECS)
		// The page follows the setting when it changes; page +/- actions move it in between.
		if (!this.configured || Number(c.page) !== this.configPage) this.page = Math.max(1, Math.round(Number(c.page)) || 1)
		this.configPage = Number(c.page)
		this.configured = true
		if (!this.execs.includes(this.selected)) this.selected = this.execs[0]

		const k = this.config
		const telnetKey = JSON.stringify([k.host, k.telnetPort, k.login, k.user, k.pass, k.spacingMs, k.heartbeatMs, k.heartbeatCommand])
		if (telnetKey !== this.telnetKey) {
			this.telnetKey = telnetKey
			this.telnet.start({
				host: k.host,
				port: k.telnetPort,
				login: k.login,
				user: k.user,
				pass: k.pass,
				spacingMs: k.spacingMs,
				heartbeatMs: k.heartbeatMs,
				heartbeatCommand: k.heartbeatCommand,
			})
		}
		const wrKey = JSON.stringify([k.webRemote, k.host, k.wrPort, k.wrUser, k.wrPass, k.pollMs])
		if (wrKey !== this.wrKey) {
			this.wrKey = wrKey
			if (k.webRemote) this.wr.start({ host: k.host, port: k.wrPort, user: k.wrUser, pass: k.wrPass, pollMs: k.pollMs, page: this.page, execs: this.execs })
			else this.wr.stop()
		}
		this.wr.watch(this.page, this.execs)
		this.emit('change')
	}

	stop() {
		this.telnet.stop()
		this.wr.stop()
		this.telnetKey = this.wrKey = undefined
	}

	// ---------- sending ----------

	/** Send a command line: Telnet, or the Web Remote if Telnet is down. */
	command(text, opts = {}) {
		if (this.telnet.ok || (opts.key && !this.wr.ok)) return this.telnet.send(text, opts)
		if (this.wr.ok) return this.wr.command(text)
		return this.telnet.send(text, opts) // drops and logs
	}

	/** Which executor an action means: { page, exec } or null. */
	resolve(options = {}) {
		const page = Math.round(Number(options.page)) > 0 ? Math.round(Number(options.page)) : this.page
		const which = options.which ?? 'fixed'
		if (which === 'selected') return { page, exec: this.selected }
		if (which === 'next') return { page, exec: this.neighbour(this.selected, 1) }
		const exec = Math.round(Number(options.exec))
		if (!Number.isFinite(exec) || exec < 1 || exec > 999) return null
		return { page, exec }
	}

	execCommand(verb, target) {
		if (!target || !EXEC_VERBS[verb]) return false
		return this.command(`${EXEC_VERBS[verb]} ${target.page}.${target.exec}`)
	}

	gotoCue(target, cue) {
		const n = Number(cue)
		if (!target || !Number.isFinite(n) || n < 0) return false
		return this.command(`Goto Cue ${n} Executor ${target.page}.${target.exec}`)
	}

	// ---------- faders ----------

	levelOf(page, exec) {
		const key = `${page}.${exec}`
		const t = this.targets.get(key)
		const p = this.polled.get(key)
		if (t && (Date.now() - t.at < this.echoGuardMs || p?.level === undefined || p.at < t.at)) return t.value
		return p?.level
	}

	setFader(target, level) {
		if (!target) return false
		const value = clamp(round1(Number(level) || 0), 0, 100)
		const key = `${target.page}.${target.exec}`
		this.targets.set(key, { value, at: Date.now() })
		if (value > 0) this.lastOn.set(key, value)
		this.emit('change')
		if (this.config.faderVia === 'auto' && this.wr.ok) return this.wr.setFader(target.page, target.exec, value)
		const line = fillTemplate(this.config.faderTemplate ?? DEFAULT_FADER_TEMPLATE, { ...target, level: value })
		return this.command(line, { key: `fader:${key}` })
	}

	stepFader(target, options) {
		if (!target) return false
		return this.setFader(target, stepPercent(this.levelOf(target.page, target.exec), stepDelta(options)))
	}

	/** Push on a fader knob: to 0, or back to where it was (full if unknown). */
	toggleFader(target) {
		if (!target) return false
		const key = `${target.page}.${target.exec}`
		const cur = Number(this.levelOf(target.page, target.exec)) || 0
		if (cur > 0) {
			this.lastOn.set(key, cur)
			return this.setFader(target, 0)
		}
		return this.setFader(target, this.lastOn.get(key) || 100)
	}

	setGrandMaster(level) {
		this.gm = clamp(round1(Number(level) || 0), 0, 100)
		this.emit('change')
		return this.command(fillTemplate(this.config.gmTemplate ?? DEFAULT_GM_TEMPLATE, { page: this.page, exec: 0, level: this.gm }), { key: 'gm' })
	}

	stepGrandMaster(options) {
		return this.setGrandMaster(stepPercent(this.gm, stepDelta(options)))
	}

	// ---------- flash / temp / buttons ----------

	/**
	 * Momentary Flash or Temp. via = 'telnet' (Flash On / Flash Off keywords) or 'button1'..'button3'
	 * (press that executor button on the Web Remote; falls back to Telnet if it isn't logged in).
	 */
	momentary(kind, target, pressed, via = 'telnet') {
		if (!target) return false
		const m = /^button([123])$/.exec(String(via))
		if (m && this.wr.ok) return this.wr.button(target.page, target.exec, Number(m[1]), pressed)
		return this.execCommand(`${kind}_${pressed ? 'on' : 'off'}`, target)
	}

	execButton(target, button, pressed) {
		if (!target) return false
		const b = Math.round(Number(button))
		if (!(b >= 1 && b <= 3)) return false
		if (!this.wr.ok) {
			this.emit('log', 'warn', 'Executor button press needs the Web Remote: not sent')
			return false
		}
		return this.wr.button(target.page, target.exec, b, pressed)
	}

	// ---------- selection and pages ----------

	neighbour(exec, delta) {
		const list = this.execs
		if (!list.length) return exec
		let i = list.indexOf(exec)
		if (i === -1) i = delta > 0 ? -1 : 0
		return list[(((i + delta) % list.length) + list.length) % list.length]
	}

	select(exec) {
		const n = Math.round(Number(exec))
		if (!(n >= 1 && n <= 999)) return false
		this.selected = n
		if (this.config.selectFollow) this.execCommand('select', { page: this.page, exec: n })
		this.emit('change')
		return true
	}

	selectStep(direction) {
		return this.select(this.neighbour(this.selected, direction === 'down' ? -1 : 1))
	}

	/** consoleKeyword: FaderPage, ButtonPage, Page, or none (only the module's page changes). */
	setPage(page, consoleKeyword = 'FaderPage') {
		const n = Math.round(Number(page))
		if (!(n >= 1 && n <= 9999)) return false
		this.page = n
		this.wr.watch(this.page, this.execs)
		if (['FaderPage', 'ButtonPage', 'Page'].includes(consoleKeyword)) this.command(`${consoleKeyword} ${n}`)
		this.emit('change')
		return true
	}

	pageStep(direction, consoleKeyword) {
		return this.setPage(Math.max(1, this.page + (direction === 'down' ? -1 : 1)), consoleKeyword)
	}

	// ---------- readback for variables and feedbacks ----------

	info(exec, page = this.page) {
		const p = this.polled.get(`${page}.${exec}`)
		return {
			page,
			exec,
			name: p?.name || `Exec ${page}.${exec}`,
			level: this.levelOf(page, exec),
			running: Boolean(p?.running),
			cue: p?.cur ?? '',
			next: p?.next ?? '',
			prev: p?.prev ?? '',
			known: Boolean(p),
		}
	}
}
