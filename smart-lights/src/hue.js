// Philips Hue through its bridge, on your own network (the bridge's local API, version 1: plain HTTP,
// no cloud). Pairing: press the round button on the bridge, then pair within 30 seconds; the bridge
// hands back a key that's kept in this connection's settings.
// No Companion dependency, so it can be tested on its own.
import dgram from 'node:dgram'

/** Hue brightness is 1-254; the module works in 0-100 %. */
export const toPct = (bri) => Math.max(1, Math.round((Number(bri) / 254) * 100))
export const toBri = (pct) => Math.max(1, Math.min(254, Math.round((Number(pct) / 100) * 254)))

/** Colour temperature: Hue uses mireds (153 = cold 6500 K … 500 = warm 2000 K); the module 0 (warm) – 100 (cold). */
export const toWarmCold = (ct) => Math.round(((500 - Number(ct)) / (500 - 153)) * 100)
export const toMired = (pct) => Math.round(500 - (Math.max(0, Math.min(100, Number(pct))) / 100) * (500 - 153))

export class HueBridge {
	/** ip: the bridge's address; key: the key it gave when paired ('' until then). */
	constructor({ ip = '', key = '', fetchFn = fetch, timeout = 5000 } = {}) {
		this.ip = ip
		this.key = key
		this.fetch = fetchFn
		this.timeout = timeout
	}

	/** Bridges on this network, from Philips' discovery service (needs the internet): [{ ip, id }]. */
	/**
	 * Finds bridges: first by asking on the local network (SSDP, which every Hue Bridge answers), then
	 * through Philips' online bridge finder, which limits how often it can be asked (429).
	 */
	static async discover({ fetchFn = fetch, local = HueBridge.discoverLocal } = {}) {
		const near = await local().catch(() => [])
		if (near.length) return near
		const res = await fetchFn('https://discovery.meethue.com/', { signal: AbortSignal.timeout(8000) })
		if (!res.ok) throw new Error(`no bridge answered on the network, and Philips' bridge finder said ${res.status}`)
		const list = await res.json()
		return (Array.isArray(list) ? list : []).filter((b) => b?.internalipaddress).map((b) => ({ ip: b.internalipaddress, id: b.id ?? '' }))
	}

	/** Asks the local network for Hue Bridges (SSDP M-SEARCH) and collects the answers for a few seconds. */
	static discoverLocal(ms = 3000) {
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
			sock.on('message', (msg, rinfo) => {
				const b = parseSsdpHue(msg.toString(), rinfo.address)
				if (b) found.set(b.ip, b)
			})
			sock.bind(() => {
				const ask = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n')
				sock.send(ask, 1900, '239.255.255.250', () => {})
			})
			setTimeout(done, ms)
		})
	}

	async #call(method, path, body) {
		if (!this.ip) throw new Error('no Hue Bridge address yet')
		const res = await this.fetch(`http://${this.ip}/api${path}`, {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(this.timeout),
		})
		const data = await res.json()
		// The bridge answers 200 with [{ error: { type, description } }] when something's wrong.
		const err = Array.isArray(data) ? data.find((x) => x?.error)?.error : null
		if (err) {
			const e = new Error(err.type === 1 ? "the bridge doesn't know this key: pair it again" : err.description)
			e.hueType = err.type
			throw e
		}
		return data
	}

	/** One pairing try: the key, or null while the bridge's button hasn't been pressed (error 101). */
	async pairOnce(name = 'companion#smart-lights') {
		try {
			const r = await this.#call('POST', '', { devicetype: name })
			const key = r?.[0]?.success?.username
			if (!key) throw new Error('the bridge gave no key')
			this.key = key
			return key
		} catch (e) {
			if (e.hueType === 101) return null
			throw e
		}
	}

	/** Lights, rooms/zones and scenes, in the module's own terms. */
	async state() {
		if (!this.key) throw new Error('not paired yet')
		const [lights, groups, scenes] = await Promise.all([this.#call('GET', `/${this.key}/lights`), this.#call('GET', `/${this.key}/groups`), this.#call('GET', `/${this.key}/scenes`)])
		return {
			lights: Object.entries(lights ?? {}).map(([id, l]) => ({
				id,
				name: l.name,
				on: !!l.state?.on,
				reachable: l.state?.reachable !== false,
				brightness: l.state?.bri !== undefined ? toPct(l.state.bri) : null,
				warmCold: l.state?.ct !== undefined ? toWarmCold(l.state.ct) : null,
			})),
			groups: Object.entries(groups ?? {})
				.filter(([, g]) => g.type === 'Room' || g.type === 'Zone')
				.map(([id, g]) => ({ id, name: g.name, type: g.type, lights: g.lights ?? [], on: !!g.state?.any_on, allOn: !!g.state?.all_on, brightness: g.action?.bri !== undefined ? toPct(g.action.bri) : null })),
			scenes: Object.entries(scenes ?? {})
				.filter(([, s]) => s.type === 'GroupScene' && s.group)
				.map(([id, s]) => ({ id, name: s.name, group: s.group })),
		}
	}

	/** Change a light: { on, brightness (0-100), warmCold (0-100) }. */
	setLight(id, change) {
		return this.#call('PUT', `/${this.key}/lights/${encodeURIComponent(id)}/state`, hueState(change))
	}

	setGroup(id, change) {
		return this.#call('PUT', `/${this.key}/groups/${encodeURIComponent(id)}/action`, hueState(change))
	}

	recallScene(groupId, sceneId) {
		return this.#call('PUT', `/${this.key}/groups/${encodeURIComponent(groupId)}/action`, { scene: sceneId })
	}
}

/** The module's change as the bridge's state body. Brightness 0 means off. */
export function hueState({ on, brightness, warmCold, transition } = {}) {
	const s = {}
	if (on !== undefined) s.on = !!on
	if (brightness !== undefined && brightness !== null) {
		if (Number(brightness) <= 0) s.on = false
		else {
			s.bri = toBri(brightness)
			if (on === undefined) s.on = true
		}
	}
	if (warmCold !== undefined && warmCold !== null) s.ct = toMired(warmCold)
	if (transition !== undefined) s.transitiontime = Math.max(0, Math.round(Number(transition) * 10))
	return s
}

/** An SSDP answer from a Hue Bridge (it carries a hue-bridgeid header), or null for anything else. */
export function parseSsdpHue(text, from) {
	const id = /^hue-bridgeid:\s*(\S+)/im.exec(text)?.[1]
	if (!id) return null
	const ip = /^location:\s*https?:\/\/([\d.]+)/im.exec(text)?.[1] ?? from
	return { ip, id: id.toLowerCase() }
}
