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
// How often to check whether Apollos were added/removed or channel counts changed
// (e.g. ADAT channels disappear at higher sample rates).
const LAYOUT_CHECK_MS = 20000
const RESCAN_DELAY_MS = 1500

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

export const keyPath = (key) => {
	const [dev, group, id] = String(key).split('/')
	return `/devices/${dev}/${group}/${id}`
}

/**
 * Find how this Console version switches talkback on. UA doesn't document it, so look for
 * a talkback switch on the device, then on the monitor output, and otherwise fall back to
 * un-muting the TALKBACK input channel.
 */
export function findTalkback(device) {
	const prop = (names) => names?.find((n) => /^talk\s*back(on|active|enabled)?$/i.test(n) || /^talkbackon$/i.test(n))
	const devProp = prop(device.propNames)
	if (devProp) return { path: `/devices/${device.id}/${devProp}`, invert: false, how: `device ${devProp}` }
	const mon = device.channels.find((c) => c.group === 'outputs')
	const monProp = mon && prop(mon.propNames)
	if (monProp) return { path: `${keyPath(mon.key)}/${monProp}`, invert: false, how: `monitor ${monProp}` }
	if (device.talkbackChannel) return { path: `${keyPath(device.talkbackChannel)}/Mute`, invert: true, how: 'TALKBACK channel mute' }
	return null
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
	#discovering = null
	#rescanTimer = null
	#layoutTimer = null
	#namesChangedTimer = null

	/** Last known value per property path, e.g. "/devices/0/inputs/3/Mute" -> true */
	values = new Map()
	/** Discovered layout: [{ id, name, online, channels: [{ key, dev, group, id, name, sends: [] }] }] */
	devices = []
	connected = false

	constructor({ layoutCheckMs = LAYOUT_CHECK_MS, rescanDelayMs = RESCAN_DELAY_MS } = {}) {
		super()
		this.layoutCheckMs = layoutCheckMs
		this.rescanDelayMs = rescanDelayMs
	}

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
		clearInterval(this.#layoutTimer)
		clearTimeout(this.#rescanTimer)
		clearTimeout(this.#namesChangedTimer)
		this.#layoutTimer = null
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
			clearInterval(this.#layoutTimer)
			this.#layoutTimer = setInterval(() => this.#checkLayout().catch(() => null), this.layoutCheckMs)
		})
		socket.on('data', (chunk) => this.#onData(chunk))
		socket.on('error', (e) => this.emit('log', 'debug', `Socket error: ${e.message}`))
		socket.on('close', () => {
			clearInterval(this.#keepAlive)
			clearInterval(this.#layoutTimer)
			this.#keepAlive = null
			this.#layoutTimer = null
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
		const had = this.values.has(path)
		this.values.set(path, value)
		this.emit('value', path, value)

		// An Apollo came online or went away: re-read everything.
		if (had && /^\/devices\/[^/]+\/DeviceOnline$/.test(path)) this.scheduleRescan('a device came online or went offline')

		// A channel was renamed in Console: update its name in place.
		const m = /^\/devices\/([^/]+)\/(inputs|auxs|outputs)\/([^/]+)\/Name$/.exec(path)
		if (m) {
			const ch = this.devices.find((d) => d.id === m[1])?.channels.find((c) => c.group === m[2] && c.id === m[3])
			if (ch) {
				const name = String(value || ch.defaultName || ch.name)
				if (ch.name !== name) {
					ch.name = name
					clearTimeout(this.#namesChangedTimer)
					this.#namesChangedTimer = setTimeout(() => this.emit('devices', this.devices), 300)
				}
			}
		}
	}

	/** Re-read the whole layout shortly (several triggers in a row cause one rescan). */
	scheduleRescan(reason) {
		clearTimeout(this.#rescanTimer)
		this.#rescanTimer = setTimeout(() => {
			if (!this.connected) return
			this.emit('log', 'info', `Re-reading channels: ${reason}`)
			this.discover().catch((e) => this.emit('log', 'error', `Discovery failed: ${e.message}`))
		}, this.rescanDelayMs)
	}

	/** Cheap check: same devices and the same number of channels in each group? */
	async #checkLayout() {
		if (!this.connected || this.#discovering) return
		const root = await this.get('/devices')
		if (!root) return
		const ids = Object.keys(root.data?.children ?? {})
		const known = this.devices.map((d) => d.id)
		if (ids.length !== known.length || ids.some((id) => !known.includes(id))) {
			return this.scheduleRescan('Apollo added or removed')
		}
		for (const dev of this.devices) {
			for (const group of GROUPS) {
				const g = await this.get(`/devices/${dev.id}/${group}`)
				if (!g) return
				const count = Object.keys(g.data?.children ?? {}).length
				if (dev.counts?.[group] !== undefined && dev.counts[group] !== count) {
					return this.scheduleRescan(`${dev.name} ${group} changed`)
				}
			}
		}
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

	unsubscribe(path) {
		this.send(`unsubscribe ${normalisePath(path)}`)
	}

	#meterKeys = new Set()

	/** Subscribe to the level meters of these channel keys ("0/inputs/3") only. Meters are chatty. */
	setMeterChannels(keys) {
		const next = new Set(keys)
		for (const key of this.#meterKeys) {
			if (!next.has(key)) for (const side of [0, 1]) this.unsubscribe(`${keyPath(key)}/meters/${side}/MeterLevel`)
		}
		for (const key of next) {
			if (!this.#meterKeys.has(key)) for (const side of [0, 1]) this.subscribe(`${keyPath(key)}/meters/${side}/MeterLevel`)
		}
		this.#meterKeys = next
	}

	#resubscribeMeters() {
		const keys = [...this.#meterKeys]
		this.#meterKeys = new Set()
		this.setMeterChannels(keys)
	}

	/** Walk /devices and record every channel; subscribe to the properties we show. */
	async discover() {
		// Several triggers at once share one scan.
		if (!this.#discovering) {
			this.#discovering = this.#discover().finally(() => {
				this.#discovering = null
			})
		}
		return this.#discovering
	}

	async #discover() {
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
				counts: {},
				propNames: Object.keys(props),
				talkback: null,
			}
			// Online state comes from the subscription only, so a rescan can't trigger another rescan.
			this.subscribe(`/devices/${devId}/DeviceOnline`)

			for (const group of GROUPS) {
				const g = await this.get(`/devices/${devId}/${group}`)
				device.counts[group] = Object.keys(g?.data?.children ?? {}).length
				for (const chId of Object.keys(g?.data?.children ?? {})) {
					const base = `/devices/${devId}/${group}/${chId}`
					const ch = await this.get(base)
					const cp = ch?.data?.properties ?? {}
					const name = cp.Name?.value || cp.Name?.default || `${group} ${chId}`
					const channel = {
						key: `${devId}/${group}/${chId}`,
						dev: devId,
						group,
						id: chId,
						name: String(name),
						defaultName: String(cp.Name?.default || name),
						sends: [],
						preamp: false,
						// Unused channels (no ADAT connected, "N/A", hidden in Console) still exist in the engine.
						active: cp.Active?.value !== false && cp.ChannelHidden?.value !== true && !/^N\/A\b/.test(String(name)),
					}

					if (group === 'inputs' && /talk\s*back/i.test(`${cp.Name?.value ?? ''} ${cp.Name?.default ?? ''}`)) {
						device.talkbackChannel = `${devId}/${group}/${chId}`
					}
					if (group === 'outputs' && !('CRMonitorLevel' in cp)) continue // only keep the monitor output
					channel.propNames = Object.keys(cp)
					if (cp.Name?.value !== undefined) this.#store(`${base}/Name`, cp.Name.value)
					this.subscribe(`${base}/Name`)
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
						// Send names (e.g. "AUX 1", "CUE 1") are the same for every channel: read them once.
						if (!device.sendNames) {
							device.sendNames = {}
							for (const sid of channel.sends) {
								const sp = (await this.get(`${base}/sends/${sid}`))?.data?.properties ?? {}
								const sname = sp.Name?.value || sp.Name?.default
								if (sname) device.sendNames[sid] = String(sname)
							}
						}
					}
					if (group === 'inputs' && kids.includes('preamps')) {
						channel.preamp = true
						for (const prop of PREAMP_PROPS) this.subscribe(`${base}/preamps/0/${prop}`)
					}
					device.channels.push(channel)
				}
			}
			device.talkback = findTalkback(device)
			if (device.talkback) {
				this.subscribe(device.talkback.path)
				this.read(device.talkback.path).catch(() => null)
			}
			devices.push(device)
		}
		this.devices = devices
		this.#resubscribeMeters()
		this.emit('devices', devices)
		return devices
	}
}
