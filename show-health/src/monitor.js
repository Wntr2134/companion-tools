// Device checks for the Show Health module. No Companion dependency, so it can be tested on its own.
import net from 'node:net'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'

/**
 * Parse the device list from the config text. One device per line:
 *   Name, host[, port]
 * With a port the check is a TCP connection (reliable through firewalls that drop ping);
 * without one it uses the system ping. Blank lines and lines starting with # are ignored.
 */
export function parseDevices(text) {
	const devices = []
	const seen = new Set()
	for (const raw of String(text ?? '').split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const parts = line.split(',').map((p) => p.trim())
		let [name, host, port] = parts
		if (parts.length === 1) {
			host = name
		}
		if (!host) continue
		const portNum = port ? Number(port) : undefined
		let id = slug(name || host)
		while (seen.has(id)) id += '_'
		seen.add(id)
		devices.push({
			id,
			name: name || host,
			host,
			port: Number.isInteger(portNum) && portNum > 0 && portNum < 65536 ? portNum : undefined,
		})
	}
	return devices
}

export const slug = (s) =>
	String(s)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '') || 'device'

/** TCP connect check. Resolves with the time taken in ms, rejects on failure or timeout. */
export function tcpCheck(host, port, timeoutMs) {
	return new Promise((resolve, reject) => {
		const started = Date.now()
		const socket = net.connect({ host, port })
		const done = (err) => {
			socket.removeAllListeners()
			socket.destroy()
			if (err) reject(err)
			else resolve(Date.now() - started)
		}
		socket.setTimeout(timeoutMs, () => done(new Error('timeout')))
		socket.once('connect', () => done())
		socket.once('error', (e) => done(e))
	})
}

/** One ICMP ping using the system ping command (no admin rights needed on macOS/Linux/Windows). */
export function pingCheck(host, timeoutMs, platform = process.platform) {
	const args =
		platform === 'win32'
			? ['-n', '1', '-w', String(timeoutMs), host]
			: platform === 'darwin'
				? ['-c', '1', '-W', String(timeoutMs), host] // macOS: -W is milliseconds
				: ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host] // Linux: seconds
	return new Promise((resolve, reject) => {
		const started = Date.now()
		execFile('ping', args, { timeout: timeoutMs + 1500 }, (err, stdout) => {
			if (err) return reject(err)
			const m = /time[=<]\s*([\d.]+)\s*ms/i.exec(String(stdout))
			resolve(m ? Number(m[1]) : Date.now() - started)
		})
	})
}

/**
 * Checks every device on an interval. A device is only marked DOWN after `failuresToDown`
 * misses in a row, so one dropped ping on a busy show network doesn't flash red.
 * Emits 'change' when any device changes state and 'update' after every round.
 */
export class Monitor extends EventEmitter {
	constructor({ intervalMs = 5000, timeoutMs = 1000, failuresToDown = 2, check } = {}) {
		super()
		this.intervalMs = intervalMs
		this.timeoutMs = timeoutMs
		this.failuresToDown = failuresToDown
		this.devices = []
		this.state = new Map() // id -> { status: 'unknown'|'up'|'down', latency, misses, since, lastChecked }
		this.timer = null
		this.running = false
		this.check =
			check ?? ((d) => (d.port ? tcpCheck(d.host, d.port, this.timeoutMs) : pingCheck(d.host, this.timeoutMs)))
	}

	setDevices(devices) {
		this.devices = devices
		const keep = new Set(devices.map((d) => d.id))
		for (const id of this.state.keys()) if (!keep.has(id)) this.state.delete(id)
		for (const d of devices) {
			if (!this.state.has(d.id)) this.state.set(d.id, { status: 'unknown', latency: null, misses: 0, since: Date.now(), lastChecked: null })
		}
	}

	start() {
		this.stop()
		this.running = true
		const loop = async () => {
			if (!this.running) return
			await this.checkAll()
			if (this.running) this.timer = setTimeout(loop, this.intervalMs)
		}
		void loop()
	}

	stop() {
		this.running = false
		clearTimeout(this.timer)
		this.timer = null
	}

	async checkAll() {
		let changed = false
		await Promise.all(
			this.devices.map(async (d) => {
				const s = this.state.get(d.id)
				if (!s) return
				const before = s.status
				try {
					s.latency = Math.round(await this.check(d))
					s.misses = 0
					s.status = 'up'
				} catch {
					s.misses += 1
					s.latency = null
					if (s.misses >= this.failuresToDown) s.status = 'down'
				}
				s.lastChecked = Date.now()
				if (s.status !== before) {
					s.since = Date.now()
					changed = true
				}
			}),
		)
		if (changed) this.emit('change')
		this.emit('update')
	}

	summary() {
		const down = this.devices.filter((d) => this.state.get(d.id)?.status === 'down')
		const unknown = this.devices.filter((d) => this.state.get(d.id)?.status === 'unknown')
		return {
			total: this.devices.length,
			down: down.length,
			downNames: down.map((d) => d.name),
			allOk: this.devices.length > 0 && down.length === 0 && unknown.length === 0,
		}
	}
}
