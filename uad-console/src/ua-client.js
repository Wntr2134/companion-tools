// Client for the UA Mixer Engine control protocol (the one UAD Console itself uses).
//
// Plain TCP, port 4710. Every message in both directions ends with a NUL byte.
// Commands: "get <path>", "set <path>/value/ <value>", "subscribe <path>".
// Replies are JSON: {"path": "...", "data": ...}. Not documented by Universal Audio:
// worked out from raduvarga/UA-Midi-Control and franqulator/cuefinger.
import net from 'node:net'
import { EventEmitter } from 'node:events'

export const DEFAULT_PORT = 4710
const KEEP_ALIVE_MS = 3000
const RECONNECT_MS = 3000
const GET_TIMEOUT_MS = 3000
// While a knob is turning, ignore echoes from the engine for this long after our own
// set, so a late echo can't drag the value backwards mid-turn.
const ECHO_GUARD_MS = 400

export const GROUPS = ['inputs', 'auxs', 'outputs']

// Channel properties we track and subscribe to.
const CHANNEL_PROPS = {
	inputs: ['Mute', 'Solo', 'FaderLevel', 'Pan'],
	auxs: ['Mute', 'FaderLevel'],
	outputs: ['Mute', 'FaderLevel', 'CRMonitorLevel', 'DimOn'],
}
const PREAMP_PROPS = ['48V', 'Pad', 'Phase', 'LowCut', 'GainTapered']

/** "/devices/0/inputs/3/Mute/value/" -> "/devices/0/inputs/3/Mute" */
export function normalisePath(path) {
	return String(path ?? '')
		.replace(/\/+$/, '')
		.replace(/\/value$/, '')
		.replace(/\/+$/, '')
}

/** Pull a plain value out of the different reply shapes the engine uses. */
export function extractValue(data) {
	if (data === null || typeof data !== 'object') return data
	if ('value' in data && (data.value === null || typeof data.value !== 'object')) return data.value
	const v = data.properties?.value
	if (v && typeof v === 'object' && 'value' in v) return v.value
	return undefined
}

export function formatValue(value) {
	if (typeof value === 'boolean') return value ? 'true' : 'false'
	if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(6)
	return String(value)
}

export class UAClient extends EventEmitter {
	#socket = null
	#buffer = Buffer.alloc(0)
	#waiters = new Map()
	#keepAlive = null
	#reconnect = null
	#host = '127.0.0.1'
	#port = DEFAULT_PORT
	#stopped = true
	#lastLocalSet = new Map()

	/** Last known value per property path, e.g. "/devices/0/inputs/3/Mute" -> true */
	values = new Map()
	/** Discovered layout: [{ id, name, online, channels: [{ key, dev, group, id, name, sends: [] }] }] */
	devices = []
	connected = false

	start(host, port) {
		this.stop()
		this.#host = host || '127.0.0.1'
		this.#port = Number(port) || DEFAULT_PORT
		this.#stopped = false
		this.#connect()
	}

	stop() {
		this.#stopped = true
		clearTimeout(this.#reconnect)
		clearInterval(this.#keepAlive)
		this.#reconnect = null
		this.#keepAlive = null
		if (this.#socket) {
			this.#socket.removeAllListeners()
			this.#socket.destroy()
			this.#socket = null
		}
		this.#setConnected(false)
		for (const list of this.#waiters.values()) for (const w of list) w(null)
		this.#waiters.clear()
	}

	#connect() {
		if (this.#stopped) return
		const socket = net.connect(this.#port, this.#host)
		this.#socket = socket
		this.#buffer = Buffer.alloc(0)
		socket.setNoDelay(true)

		socket.on('connect', () => {
			this.#setConnected(true)
			this.#keepAlive = setInterval(() => this.send('set /Sleep false'), KEEP_ALIVE_MS)
			this.discover().catch((e) => this.emit('log', 'error', `Discovery failed: ${e.message}`))
		})
		socket.on('data', (chunk) => this.#onData(chunk))
		socket.on('error', (e) => this.emit('log', 'debug', `Socket error: ${e.message}`))
		socket.on('close', () => {
			clearInterval(this.#keepAlive)
			this.#keepAlive = null
			this.#setConnected(false)
			if (!this.#stopped) this.#reconnect = setTimeout(() => this.#connect(), RECONNECT_MS)
		})
	}

	#setConnected(state) {
		if (this.connected === state) return
		this.connected = state
		this.emit(state ? 'connected' : 'disconnected')
	}

	#onData(chunk) {
		this.#buffer = Buffer.concat([this.#buffer, chunk])
		let nul
		while ((nul = this.#buffer.indexOf(0)) !== -1) {
			const text = this.#buffer.subarray(0, nul).toString('utf8')
			this.#buffer = this.#buffer.subarray(nul + 1)
			if (text) this.#onMessage(text)
		}
		if (this.#buffer.length > 4 * 1024 * 1024) this.#buffer = Buffer.alloc(0) // runaway guard
	}

	#onMessage(text) {
		let msg
		try {
			msg = JSON.parse(text)
		} catch {
			return
		}
		const path = normalisePath(msg.path)
		const list = this.#waiters.get(path)
		if (list?.length) list.shift()(msg)

		// Plain value updates (subscriptions, set echoes)
		const value = extractValue(msg.data)
		if (value !== undefined && !(msg.data && typeof msg.data === 'object' && msg.data.children)) {
			const guard = this.#lastLocalSet.get(path)
			if (guard && Date.now() - guard < ECHO_GUARD_MS) return
			this.#store(path, value)
		}
	}

	#store(path, value) {
		if (this.values.get(path) === value) return
		this.values.set(path, value)
		this.emit('value', path, value)
	}

	send(line) {
		if (!this.#socket || !this.connected) return false
		this.#socket.write(line + '\0')
		return true
	}

	get(path, timeoutMs = GET_TIMEOUT_MS) {
		return new Promise((resolve) => {
			if (!this.connected) return resolve(null)
			const key = normalisePath(path)
			const list = this.#waiters.get(key) ?? []
			const done = (m) => {
				clearTimeout(timer)
				resolve(m)
			}
			const timer = setTimeout(() => {
				const l = this.#waiters.get(key) ?? []
				const i = l.indexOf(done)
				if (i !== -1) l.splice(i, 1)
				resolve(null)
			}, timeoutMs)
			list.push(done)
			this.#waiters.set(key, list)
			this.send(`get ${path}`)
		})
	}

	/** Set a property (path without "/value"). Updates the local copy straight away. */
	set(path, value) {
		const key = normalisePath(path)
		this.#lastLocalSet.set(key, Date.now())
		this.#store(key, value)
		return this.send(`set ${key}/value/ ${formatValue(value)}`)
	}

	/** Read a property's current value, asking the engine if we don't know it yet. */
	async read(path) {
		const key = normalisePath(path)
		if (this.values.has(key)) return this.values.get(key)
		const msg = await this.get(key)
		const value = extractValue(msg?.data)
		if (value !== undefined) this.#store(key, value)
		return value
	}

	subscribe(path) {
		this.send(`subscribe ${normalisePath(path)}`)
	}

	/** Walk /devices and record every channel; subscribe to the properties we show. */
	async discover() {
		const devices = []
		const root = await this.get('/devices')
		for (const devId of Object.keys(root?.data?.children ?? {})) {
			const dev = await this.get(`/devices/${devId}`)
			const props = dev?.data?.properties ?? {}
			const device = {
				id: devId,
				name: String(props.DeviceName?.value ?? `Device ${devId}`),
				online: props.DeviceOnline?.value,
				channels: [],
			}
			this.subscribe(`/devices/${devId}/DeviceOnline`)
			if (device.online !== undefined) this.#store(`/devices/${devId}/DeviceOnline`, device.online)

			for (const group of GROUPS) {
				const g = await this.get(`/devices/${devId}/${group}`)
				for (const chId of Object.keys(g?.data?.children ?? {})) {
					const base = `/devices/${devId}/${group}/${chId}`
					const ch = await this.get(base)
					const cp = ch?.data?.properties ?? {}
					const name = cp.Name?.value || cp.Name?.default || `${group} ${chId}`
					const channel = { key: `${devId}/${group}/${chId}`, dev: devId, group, id: chId, name: String(name), sends: [], preamp: false }

					if (group === 'outputs' && !('CRMonitorLevel' in cp)) continue // only keep the monitor output
					for (const prop of CHANNEL_PROPS[group]) {
						if (!(prop in cp)) continue
						const v = cp[prop]?.value
						if (v !== undefined) this.#store(`${base}/${prop}`, v)
						this.subscribe(`${base}/${prop}`)
					}

					const kids = Object.keys(ch?.data?.children ?? {})
					if (kids.includes('sends')) {
						const sends = await this.get(`${base}/sends`)
						channel.sends = Object.keys(sends?.data?.children ?? {})
					}
					if (group === 'inputs' && kids.includes('preamps')) {
						channel.preamp = true
						for (const prop of PREAMP_PROPS) this.subscribe(`${base}/preamps/0/${prop}`)
					}
					device.channels.push(channel)
				}
			}
			devices.push(device)
		}
		this.devices = devices
		this.emit('devices', devices)
		return devices
	}
}
