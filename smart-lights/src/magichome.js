// Magic Home (and other Zengge / "LEDnet" Wi-Fi controllers) LED strips, straight over your Wi-Fi:
// no account, no keys. They answer on TCP port 5577 and say where they are on UDP 48899.
// No Companion dependency, so it can be tested on its own.
import net from 'node:net'
import dgram from 'node:dgram'

const PORT = 5577

/** A command with its checksum (the low byte of the sum) on the end. */
export const withSum = (bytes) => Buffer.from([...bytes, bytes.reduce((a, b) => a + b, 0) & 0xff])

export const POWER_ON = withSum([0x71, 0x23, 0x0f])
export const POWER_OFF = withSum([0x71, 0x24, 0x0f])
export const QUERY = withSum([0x81, 0x8a, 0x8b])

/** Colour (and warm white) for RGB / RGBW controllers. */
export const colourCommand = ({ r, g, b, w = 0 }) => withSum([0x31, r & 0xff, g & 0xff, b & 0xff, w & 0xff, 0x00, 0x0f])

/** A state reply (14 bytes, 0x81 first) as { on, r, g, b, w }, or null. */
export function parseState(buf) {
	if (!buf || buf.length < 14 || buf[0] !== 0x81) return null
	return { on: buf[2] === 0x23, r: buf[6], g: buf[7], b: buf[8], w: buf[9] }
}

/** Brightness 1-100 % from a colour: its brightest channel. */
export const colourBrightness = ({ r, g, b, w = 0 }) => Math.max(1, Math.round((Math.max(r, g, b, w) / 255) * 100))

/** The same colour at another brightness (1-100 %). Black becomes white. */
export function atBrightness(c, pct) {
	const top = Math.max(c.r, c.g, c.b, c.w ?? 0)
	const base = top ? c : { r: 255, g: 255, b: 255, w: 0 }
	const k = (Math.max(1, Math.min(100, pct)) / 100) * 255 / (top || 255)
	const s = (v) => Math.max(0, Math.min(255, Math.round(v * k)))
	return { r: s(base.r), g: s(base.g), b: s(base.b), w: s(base.w ?? 0) }
}

/** "#ff8800" or 0xff8800 (Companion's colour picker) as { r, g, b, w: 0 }. */
export function toRgb(v) {
	const n = typeof v === 'number' ? v : parseInt(String(v).replace(/^#/, ''), 16)
	return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, w: 0 }
}

/** Devices from the settings: one per line, "Name, IP address". Lines starting with # are notes. */
export function parseMagicDevices(text) {
	const out = []
	for (const raw of String(text ?? '').split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const parts = line.split(',').map((s) => s.trim())
		const ip = parts.find((p) => /^\d{1,3}(\.\d{1,3}){3}$/.test(p))
		if (!ip) continue
		const name = parts.find((p) => p && p !== ip) || `LED strip ${ip.split('.').pop()}`
		out.push({ name, ip })
	}
	return out
}

/** Asks the network for Magic Home controllers; answers are "IP,MAC,model". */
export function discoverMagicHome({ ms = 2500, port = 48899, address = '255.255.255.255' } = {}) {
	return new Promise((resolve) => {
		const found = new Map()
		const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
		const done = () => {
			try {
				sock.close()
			} catch {
				// already closed
			}
			resolve([...found.values()])
		}
		sock.on('error', done)
		sock.on('message', (msg) => {
			const [ip, mac, model] = msg.toString().trim().split(',')
			if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip ?? '')) found.set(ip, { ip, mac: mac ?? '', model: model ?? '' })
		})
		sock.bind(() => {
			try {
				sock.setBroadcast(true)
			} catch {
				// not allowed: nothing found
			}
			sock.send(Buffer.from('HF-A11ASSISTHREAD'), port, address, () => {})
		})
		setTimeout(done, ms)
	})
}

/** One controller: kept connected, read every few seconds, reconnecting by itself. */
export class MagicHomeDevice {
	constructor(def, { log = () => {}, onChange = () => {}, port = PORT, pollMs = 5000, timeout = 3000 } = {}) {
		this.name = def.name
		this.ip = def.ip
		this.id = def.ip
		this.port = port
		this.log = log
		this.onChange = onChange
		this.pollMs = pollMs
		this.timeout = timeout
		this.online = false
		this.on = false
		this.colour = { r: 255, g: 255, b: 255, w: 0 }
		this.buf = Buffer.alloc(0)
		this.closed = false
	}

	get state() {
		return { on: this.on, brightness: colourBrightness(this.colour), warmCold: null, reachable: this.online }
	}

	start() {
		this.timer = setInterval(() => void this.refresh(), this.pollMs)
		this.timer.unref?.()
		return this.refresh()
	}

	stop() {
		this.closed = true
		clearInterval(this.timer)
		this.sock?.destroy()
		this.sock = null
	}

	#connect() {
		if (this.sock && !this.sock.destroyed) return Promise.resolve(this.sock)
		return new Promise((resolve, reject) => {
			const sock = net.connect({ host: this.ip, port: this.port, noDelay: true }) // small commands go straight away
			const fail = (e) => {
				sock.destroy()
				reject(e)
			}
			sock.setTimeout(this.timeout, () => fail(new Error('no answer')))
			sock.once('error', fail)
			sock.once('connect', () => {
				sock.setTimeout(0)
				sock.removeListener('error', fail)
				sock.on('error', () => sock.destroy())
				sock.on('close', () => {
					if (this.sock === sock) this.sock = null
				})
				sock.on('data', (d) => this.#take(d))
				this.sock = sock
				resolve(sock)
			})
		})
	}

	#take(d) {
		this.buf = Buffer.concat([this.buf, d])
		// state replies are 14 bytes starting 0x81; anything else (command echoes) is skipped
		while (this.buf.length) {
			const at = this.buf.indexOf(0x81)
			if (at < 0) {
				this.buf = Buffer.alloc(0)
				break
			}
			if (this.buf.length - at < 14) {
				this.buf = this.buf.subarray(at)
				break
			}
			const s = parseState(this.buf.subarray(at, at + 14))
			this.buf = this.buf.subarray(at + 14)
			if (s) {
				this.on = s.on
				if (s.r || s.g || s.b || s.w) this.colour = { r: s.r, g: s.g, b: s.b, w: s.w }
				this.#reachable(true)
				this.onChange(this)
			}
		}
	}

	#reachable(yes) {
		if (this.online === yes) return
		this.online = yes
		this.onChange(this)
	}

	async #send(bytes) {
		const sock = await this.#connect()
		await new Promise((resolve, reject) => sock.write(bytes, (e) => (e ? reject(e) : resolve())))
	}

	async refresh() {
		if (this.closed) return
		try {
			await this.#send(QUERY)
		} catch (e) {
			if (this.online) this.log('debug', `${this.name}: ${e?.message ?? e}`)
			this.#reachable(false)
		}
	}

	/** { on, brightness (0-100; 0 = off), colour ({ r, g, b, w }) } */
	async set(change) {
		if (change.colour) this.colour = { ...change.colour }
		if (change.brightness !== undefined && change.brightness !== null) {
			if (Number(change.brightness) <= 0) change = { ...change, on: false }
			else this.colour = atBrightness(this.colour, Number(change.brightness))
		}
		const colourChanged = change.colour || (change.brightness !== undefined && change.brightness !== null && Number(change.brightness) > 0)
		const on = change.on ?? (colourChanged ? true : undefined)
		if (on === false) {
			this.on = false
			this.onChange(this)
			return this.#send(POWER_OFF)
		}
		if (on === true && !this.on) {
			this.on = true
			await this.#send(POWER_ON)
		}
		if (colourChanged) await this.#send(colourCommand(this.colour))
		this.onChange(this)
	}
}
