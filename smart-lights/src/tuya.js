// Grid Connect (and other Tuya-based) bulbs and plugs, straight over your Wi-Fi with each device's own
// key: no cloud, no app. Device IDs and keys come from a one-off sign-in with your Grid Connect account
// (see the setup guide); paste that list into this connection's settings.
// No Companion dependency, so it can be tested on its own.
import TuyAPI from 'tuyapi'

/**
 * Devices from the settings: the Grid Connect key tool's output pasted as it is (a name line, then
 * "devId : …", "localKey : …", optionally "category : …" and "dps : {…}"), or one per line as
 * "Name, devId, localKey[, IP address]". Lines starting with # are notes.
 * Returns [{ name, id, key, ip, category, dps }].
 */
export function parseTuyaDevices(text) {
	const out = []
	let cur = null
	const done = () => {
		if (cur?.id && cur?.key) out.push(cur)
		cur = null
	}
	for (const raw of String(text ?? '').split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const field = /^(devId|localKey|productId|category|dps|ip)\s*:\s*(.*)$/i.exec(line)
		if (field) {
			if (!cur) continue
			const [, k, v] = field
			const key = k.toLowerCase()
			if (key === 'devid') cur.id = v.trim()
			else if (key === 'localkey') cur.key = v.trim()
			else if (key === 'category') cur.category = v.trim()
			else if (key === 'ip') cur.ip = v.trim()
			else if (key === 'dps') {
				try {
					cur.dps = JSON.parse(v)
				} catch {
					// not needed: read from the device
				}
			}
			continue
		}
		const parts = line.split(',').map((s) => s.trim())
		if (parts.length >= 3 && /^[A-Za-z0-9]{16,}$/.test(parts[1])) {
			done()
			out.push({ name: parts[0], id: parts[1], key: parts[2], ip: parts[3] ?? '', category: '', dps: null })
			continue
		}
		// a device name line (the key tool prints "Name  (online)")
		done()
		cur = { name: line.replace(/\s+\((online|offline)\)\s*$/i, ''), id: '', key: '', ip: '', category: '', dps: null }
	}
	done()
	return out
}

/**
 * How to drive a device, from the data points (dps) it reports:
 *  - newer bulbs: 20 on/off, 22 brightness 10-1000, 23 warm–cold 0-1000, 21 mode
 *  - older bulbs: 1 on/off, 3 brightness 25-255, 4 warm–cold 0-255, 2 mode
 *  - plugs and switches: 1 on/off
 */
export function tuyaSchema(dps = {}) {
	const has = (k) => dps && Object.prototype.hasOwnProperty.call(dps, k)
	if (has('20')) return { kind: 'light', on: '20', mode: '21', bri: has('22') ? '22' : null, briMin: 10, briMax: 1000, temp: has('23') ? '23' : null, tempMax: 1000 }
	if (has('1') && (has('3') || has('2'))) return { kind: 'light', on: '1', mode: '2', bri: has('3') ? '3' : null, briMin: 25, briMax: 255, temp: has('4') ? '4' : null, tempMax: 255 }
	return { kind: 'switch', on: '1', bri: null, temp: null }
}

/** The device's state in the module's terms (brightness and warm–cold 0-100). */
export function tuyaState(dps = {}, schema = tuyaSchema(dps)) {
	const pct = (v, min, max) => Math.max(1, Math.round(((Number(v) - min) / (max - min)) * 100))
	return {
		on: !!dps[schema.on],
		brightness: schema.bri && dps[schema.bri] !== undefined ? pct(dps[schema.bri], schema.briMin, schema.briMax) : null,
		warmCold: schema.temp && dps[schema.temp] !== undefined ? Math.round((Number(dps[schema.temp]) / schema.tempMax) * 100) : null,
	}
}

/** A change ({ on, brightness, warmCold }) as data points to send. Brightness 0 means off. */
export function tuyaChange(change, schema) {
	const out = {}
	if (change.on !== undefined) out[schema.on] = !!change.on
	if (change.brightness !== undefined && change.brightness !== null && schema.bri) {
		if (Number(change.brightness) <= 0) out[schema.on] = false
		else {
			out[schema.bri] = Math.round(schema.briMin + (Math.min(100, Number(change.brightness)) / 100) * (schema.briMax - schema.briMin))
			if (change.on === undefined) out[schema.on] = true
			if (schema.mode) out[schema.mode] = 'white'
		}
	}
	if (change.warmCold !== undefined && change.warmCold !== null && schema.temp) {
		out[schema.temp] = Math.round((Math.max(0, Math.min(100, Number(change.warmCold))) / 100) * schema.tempMax)
		if (schema.mode) out[schema.mode] = 'white'
	}
	return out
}

/** One Tuya device kept connected, reconnecting by itself. */
export class TuyaDevice {
	constructor(def, { Api = TuyAPI, log = () => {}, onChange = () => {}, retryMs = 15000 } = {}) {
		this.def = def
		this.name = def.name
		this.id = def.id
		this.dps = { ...(def.dps ?? {}) }
		this.online = false
		this.log = log
		this.onChange = onChange
		this.retryMs = retryMs
		this.closed = false
		this.api = new Api({ id: def.id, key: def.key, ip: def.ip || undefined, version: def.version || '3.3', issueRefreshOnConnect: true })
		this.api.on('connected', () => {
			this.online = true
			this.onChange(this)
		})
		this.api.on('disconnected', () => {
			this.online = false
			this.onChange(this)
			this.#retry()
		})
		this.api.on('error', (e) => this.log('debug', `${this.name}: ${e?.message ?? e}`))
		const take = (data) => {
			if (data?.dps) {
				Object.assign(this.dps, data.dps)
				this.onChange(this)
			}
		}
		this.api.on('data', take)
		this.api.on('dp-refresh', take)
	}

	get schema() {
		return tuyaSchema(this.dps)
	}

	get state() {
		return { ...tuyaState(this.dps, this.schema), reachable: this.online }
	}

	async start() {
		if (this.closed) return
		try {
			// No IP in the settings: listen for the device's own announcement on the network (it also says
			// which protocol version it speaks)
			if (!this.api.device.ip) await this.api.find({ timeout: 12 })
			await this.api.connect()
			await this.api.get({ schema: true }).catch(() => null)
		} catch (e) {
			this.log('warn', `${this.name}: couldn't reach it (${e?.message ?? e}): trying again in ${Math.round(this.retryMs / 1000)} s`)
			this.#retry()
		}
	}

	#retry() {
		if (this.closed || this.timer) return
		this.timer = setTimeout(() => {
			this.timer = null
			void this.start()
		}, this.retryMs)
	}

	async set(change) {
		const data = tuyaChange(change, this.schema)
		if (!Object.keys(data).length) return
		if (!this.online) throw new Error(`${this.name} isn't connected`)
		Object.assign(this.dps, data) // show it straight away; the device confirms
		this.onChange(this)
		await this.api.set({ multiple: true, data })
	}

	stop() {
		this.closed = true
		clearTimeout(this.timer)
		try {
			this.api.disconnect()
		} catch {
			// already gone
		}
	}
}
