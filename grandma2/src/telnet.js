// Telnet client for the grandMA2 command line (console or onPC, TCP port 30000).
//
// - One reconnect timer at a time, cleared by stop(). Backoff 1, 2, 5, 10 s.
// - Telnet negotiation (IAC DO/WILL ...) is answered with WONT/DONT and stripped from the text,
//   even when a sequence is split across two TCP packets.
// - Login is quoted: Login "user" "pass" (MA expands unquoted words, e.g. "Al" -> "Align").
// - A FIFO command queue with spacing between lines. Fader sets carry a key: a newer value for
//   the same key replaces the queued one, so only the latest is sent. Everything else
//   (Go, Back, key presses, custom commands) is sent once or dropped, never retried.
// - Heartbeat: a harmless line every few seconds; silence for too long counts as disconnected.
import net from 'node:net'
import { EventEmitter } from 'node:events'

export const DEFAULT_TELNET_PORT = 30000

const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240

const RECONNECT_STEPS_MS = [1000, 2000, 5000, 10000]
const CONNECT_TIMEOUT_MS = 5000
const NUDGE_MS = 1500 // nothing heard after connecting: press Enter once to get a prompt
const MAX_LINE = 8192

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const PROMPT = /\[[^\]\r\n]*\]>\s*$/

/** Strip characters that would break out of a quoted MA argument or end the line. */
export function quoteArg(value) {
	return `"${String(value ?? '').replace(/["\r\n]/g, '')}"`
}

export function loginLine(user, pass) {
	return `Login ${quoteArg(user)} ${quoteArg(pass)}`
}

/** One command line: no CR/LF inside (they would split it into two commands). */
export function cleanCommand(cmd) {
	return String(cmd ?? '')
		.replace(/[\r\n]+/g, ' ')
		.trim()
}

/**
 * Telnet byte filter. Feed it raw chunks; it returns the plain data bytes and calls reply()
 * with the negotiation answers. Keeps state between chunks.
 */
export class TelnetFilter {
	#state = 'data' // data | iac | opt | sb | sb_iac
	#verb = 0

	constructor(reply) {
		this.reply = reply
	}

	push(chunk) {
		const out = []
		for (const b of chunk) {
			switch (this.#state) {
				case 'data':
					if (b === IAC) this.#state = 'iac'
					else out.push(b)
					break
				case 'iac':
					if (b === IAC) {
						out.push(IAC) // escaped 255
						this.#state = 'data'
					} else if (b === DO || b === DONT || b === WILL || b === WONT) {
						this.#verb = b
						this.#state = 'opt'
					} else if (b === SB) this.#state = 'sb'
					else this.#state = 'data' // NOP, GA, etc.: ignore
					break
				case 'opt':
					// Refuse everything: we are a dumb line terminal.
					if (this.#verb === DO) this.reply(Buffer.from([IAC, WONT, b]))
					else if (this.#verb === WILL) this.reply(Buffer.from([IAC, DONT, b]))
					this.#state = 'data'
					break
				case 'sb':
					if (b === IAC) this.#state = 'sb_iac'
					break
				case 'sb_iac':
					this.#state = b === SE ? 'data' : 'sb'
					break
			}
		}
		return Buffer.from(out)
	}
}

export class MA2Telnet extends EventEmitter {
	#socket = null
	#filter = null
	#text = ''
	#reconnectTimer = null
	#connectTimer = null
	#nudgeTimer = null
	#heartbeatTimer = null
	#queueTimer = null
	#attempt = 0
	#stopped = true
	#queue = []
	#lastSend = 0
	#lastRx = 0
	#loginSent = false
	#askedLogin = false

	/** disconnected | connecting | ok | failed */
	state = 'disconnected'
	/** Text explaining the state (for the connection status line). */
	message = ''
	guest = false
	lastResponse = ''

	constructor(opts = {}) {
		super()
		this.reconnectSteps = opts.reconnectSteps ?? RECONNECT_STEPS_MS
		this.nudgeMs = opts.nudgeMs ?? NUDGE_MS
		this.connectTimeoutMs = opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
		this.config = {}
	}

	/**
	 * @param {object} c host, port, login (bool), user, pass, spacingMs, heartbeatMs, silenceMs, heartbeatCommand
	 */
	start(c) {
		this.stop()
		this.config = {
			host: c.host,
			port: Number(c.port) || DEFAULT_TELNET_PORT,
			login: c.login !== false,
			user: c.user ?? 'administrator',
			pass: c.pass ?? '',
			spacingMs: Math.max(0, Number(c.spacingMs ?? 50) || 0),
			heartbeatMs: Math.max(200, Number(c.heartbeatMs) || 10000),
			silenceMs: Math.max(500, Number(c.silenceMs) || (Number(c.heartbeatMs) || 10000) * 2.5),
			heartbeatCommand: c.heartbeatCommand ?? '',
		}
		if (!this.config.host) return this.#setState('failed', 'No console IP set')
		this.#stopped = false
		this.#attempt = 0
		this.#connect()
	}

	stop() {
		this.#stopped = true
		clearTimeout(this.#reconnectTimer)
		clearTimeout(this.#connectTimer)
		clearTimeout(this.#nudgeTimer)
		clearInterval(this.#heartbeatTimer)
		clearTimeout(this.#queueTimer)
		this.#reconnectTimer = this.#connectTimer = this.#nudgeTimer = this.#heartbeatTimer = this.#queueTimer = null
		this.#queue = []
		this.#dropSocket()
		this.#setState('disconnected', 'Stopped')
	}

	get ok() {
		return this.state === 'ok'
	}

	#dropSocket() {
		if (!this.#socket) return
		this.#socket.removeAllListeners()
		this.#socket.on('error', () => null)
		this.#socket.destroy()
		this.#socket = null
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
		this.#text = ''
		this.#loginSent = false
		this.#askedLogin = false
		this.guest = false
		this.#setState('connecting', this.#attempt ? 'Reconnecting' : 'Connecting')
		const socket = net.connect(this.config.port, this.config.host)
		this.#socket = socket
		this.#filter = new TelnetFilter((buf) => {
			try {
				if (!socket.destroyed) socket.write(buf)
			} catch (e) {
				this.emit('log', 'debug', `Telnet negotiation reply failed: ${e.message}`)
			}
		})
		socket.setNoDelay(true)
		socket.setKeepAlive(true, 5000)
		this.#connectTimer = setTimeout(() => {
			this.emit('log', 'debug', 'Telnet connect timed out')
			socket.destroy()
		}, this.connectTimeoutMs)

		socket.on('connect', () => {
			clearTimeout(this.#connectTimer)
			this.#lastRx = Date.now()
			this.emit('log', 'debug', `Telnet connected to ${this.config.host}:${this.config.port}`)
			// Still "connecting" until the console says something.
			this.#nudgeTimer = setTimeout(() => {
				if (socket === this.#socket && this.state === 'connecting') this.#write('')
			}, this.nudgeMs)
			clearInterval(this.#heartbeatTimer)
			this.#heartbeatTimer = setInterval(() => this.#heartbeat(), this.config.heartbeatMs)
		})
		socket.on('data', (chunk) => {
			try {
				this.#onData(chunk)
			} catch (e) {
				this.emit('log', 'debug', `Ignored bad Telnet data: ${e.message}`)
			}
		})
		socket.on('error', (e) => this.emit('log', 'debug', `Telnet error: ${e.message}`))
		socket.on('close', () => {
			if (socket !== this.#socket) return
			clearTimeout(this.#connectTimer)
			clearTimeout(this.#nudgeTimer)
			clearInterval(this.#heartbeatTimer)
			this.#heartbeatTimer = null
			this.#socket = null
			this.#dropUnsafe('the connection dropped')
			if (this.state !== 'failed') this.#setState('disconnected', 'Console not answering on Telnet')
			this.#scheduleReconnect()
		})
	}

	#scheduleReconnect() {
		if (this.#stopped || this.#reconnectTimer) return
		const delay = this.reconnectSteps[Math.min(this.#attempt, this.reconnectSteps.length - 1)]
		this.#attempt++
		this.#reconnectTimer = setTimeout(() => this.#connect(), delay)
	}

	#heartbeat() {
		if (!this.#socket) return
		const quiet = Date.now() - this.#lastRx
		if (quiet > this.config.silenceMs) {
			this.emit('log', 'warn', `Nothing from the console for ${Math.round(quiet / 1000)} s: reconnecting`)
			this.#setState('disconnected', 'Console stopped answering')
			this.#socket.destroy() // close handler reconnects
			return
		}
		if (this.ok && this.#queue.length === 0) this.#write(this.config.heartbeatCommand)
	}

	#onData(chunk) {
		this.#lastRx = Date.now()
		const data = this.#filter.push(chunk)
		if (!data.length) return
		this.#text += data.toString('utf8').replace(ANSI, '')
		let nl
		while ((nl = this.#text.search(/\r?\n|\r/)) !== -1) {
			const line = this.#text.slice(0, nl)
			const m = /\r\n|\n|\r/.exec(this.#text.slice(nl))
			this.#text = this.#text.slice(nl + (m ? m[0].length : 1))
			this.#onLine(line)
		}
		if (this.#text.length > MAX_LINE) this.#text = ''
		// Prompts ("[Channel]>", "Please login") arrive without a newline.
		if (this.#text) this.#onPartial(this.#text)
	}

	#onLine(raw) {
		const line = raw.trim()
		if (!line) return
		this.#checkLogin(line)
		if (!PROMPT.test(line)) {
			this.lastResponse = line
			this.emit('line', line)
		} else this.#onPrompt()
	}

	#onPartial(text) {
		this.#checkLogin(text)
		if (PROMPT.test(text)) this.#onPrompt()
	}

	#onPrompt() {
		if (this.state === 'connecting' && !this.config.login && !this.#askedLogin) this.#loggedIn('Connected (no login)')
	}

	#checkLogin(text) {
		if (/please\s+log\s*in/i.test(text) && !this.config.login && this.state === 'connecting') {
			this.#askedLogin = true
			this.#setState('connecting', 'The console asks for a login: turn on "Log in" in the connection settings')
			return
		}
		if (/please\s+log\s*in/i.test(text) && this.config.login && !this.#loginSent && this.state === 'connecting') {
			this.#loginSent = true
			this.emit('log', 'info', `Logging in as ${this.config.user}`)
			this.#write(loginLine(this.config.user, this.config.pass))
			return
		}
		const m = /logged\s+in\s+as\s+user\s*[:'"]?\s*([^\s'"]+)?/i.exec(text)
		if (m && this.state !== 'ok') {
			this.guest = /guest/i.test(m[1] ?? text)
			if (this.guest) this.emit('log', 'warn', 'Logged in as guest: some commands may be refused. Check the user name and password.')
			this.#loggedIn(this.guest ? 'Logged in as guest' : `Logged in as ${m[1] ?? 'user'}`)
			return
		}
		if (/no\s+login|login\s+failed|wrong\s+password|unknown\s+user|invalid\s+(user|password)/i.test(text) && this.state === 'connecting') {
			this.#setState('failed', 'Login refused: check the user name and password')
			this.emit('log', 'error', 'grandMA2 refused the Telnet login')
		}
		if (!this.config.login && !this.#askedLogin && this.state === 'connecting') {
			// Login switched off in the module: any answer that isn't a login request means we're in.
			this.#loggedIn('Connected (no login)')
		}
	}

	#loggedIn(message) {
		this.#attempt = 0
		this.#setState('ok', message)
		this.#pump()
	}

	#write(line) {
		if (!this.#socket || this.#socket.destroyed) return false
		this.#socket.write(line + '\r\n')
		this.#lastSend = Date.now()
		return true
	}

	/**
	 * Queue a command line.
	 * @param {string} cmd
	 * @param {{ key?: string }} [opts] key = coalesce: a newer command with the same key replaces
	 *   a queued one, and it is kept (latest only) while disconnected. Without a key the command
	 *   is sent once and dropped if the link is down.
	 * @returns {boolean} false if it was dropped
	 */
	send(cmd, opts = {}) {
		const text = cleanCommand(cmd)
		if (!text) return false
		const key = opts.key
		if (key) {
			const queued = this.#queue.find((q) => q.key === key)
			if (queued) {
				queued.text = text
				this.#pump()
				return true
			}
		} else if (!this.ok) {
			this.emit('log', 'warn', `Not connected: dropped "${text}" (not retried)`)
			return false
		}
		this.#queue.push({ text, key })
		this.#pump()
		return true
	}

	/** Commands waiting to go out (for tests and the debug log). */
	get queued() {
		return this.#queue.map((q) => q.text)
	}

	#dropUnsafe(why) {
		const dropped = this.#queue.filter((q) => !q.key)
		if (dropped.length) this.emit('log', 'warn', `Dropped ${dropped.length} command(s) because ${why} (not retried)`)
		this.#queue = this.#queue.filter((q) => q.key)
	}

	#pump() {
		if (this.#queueTimer || !this.ok || !this.#queue.length) return
		const wait = this.config.spacingMs - (Date.now() - this.#lastSend)
		if (wait > 0) {
			this.#queueTimer = setTimeout(() => {
				this.#queueTimer = null
				this.#pump()
			}, wait)
			return
		}
		const next = this.#queue.shift()
		this.#write(next.text)
		this.emit('sent', next.text)
		if (this.#queue.length) {
			this.#queueTimer = setTimeout(() => {
				this.#queueTimer = null
				this.#pump()
			}, this.config.spacingMs)
		}
	}
}
