import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base'
import { HueBridge } from './hue.js'
import { TuyaDevice, parseTuyaDevices } from './tuya.js'
import { MagicHomeDevice, parseMagicDevices, discoverMagicHome, toRgb } from './magichome.js'
import { signIn, devicesText, REGIONS } from './gridconnect.js'
import { withSurfaceExtras } from './surface-extras.js'
import { getViewerPresets } from './viewers.js'
import { buildHomePages } from './page.js'

const AMBER = combineRgb(240, 170, 40) // a lit bulb
const DARK = combineRgb(24, 26, 30)
const GREY = combineRgb(70, 70, 76)
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const COLOURS = [
	['RED', 0xff0000],
	['ORANGE', 0xff6000],
	['YELLOW', 0xffc000],
	['GREEN', 0x00ff00],
	['CYAN', 0x00ffff],
	['BLUE', 0x0000ff],
	['PURPLE', 0x8000ff],
	['PINK', 0xff0080],
	['WHITE', 0xffffff],
]
const STEPS = [1, 2, 3, 5, 8, 10, 15, 20, 25, 33] // % per knob click, for the 1-10 step size
const PAIR_SECONDS = 30
const HOLD_MS = 600 // light keys: held this long = full brightness

const slug = (s) =>
	String(s)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '') || 'x'
const short = (s, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)))

class SmartLightsInstance extends InstanceBase {
	targets = new Map() // id -> { id, name, source, kind, on, brightness, warmCold, reachable }
	scenes = []
	tuya = []
	magic = []
	timers = []

	async init(config, _isFirstInit, secrets) {
		this.config = config
		this.secrets = secrets ?? {}
		// Don't hold Companion up: the keys that don't depend on the network now, everything that talks to
		// the network in the background (Companion gives up on a module that takes over 10 s to start)
		this.updateDefinitions()
		this.updateStatus(InstanceStatus.Connecting, 'Looking for lights…')
		this.#startSoon()
		// Grid Connect is only signed in to when asked (Fetch my devices, or a FETCH key): every wrong
		// try counts against the account, and Grid Connect locks it for 15 minutes after a few
	}

	async configUpdated(config, secrets) {
		this.config = config
		this.secrets = secrets ?? {}
		if (config.pairNow) {
			// a one-off: untick it and try to pair
			this.config = { ...config, pairNow: false }
			this.saveConfig(this.config, this.secrets)
			void this.pairHue()
		}
		// only when ticked (a one-off, like Pair now)
		if (config.gcFetchNow) {
			this.config = { ...this.config, gcFetchNow: false }
			this.saveConfig(this.config, this.secrets)
			this.#startSoon()
			void this.fetchGridConnect()
			return
		}
		this.#startSoon()
	}

	#gcReady() {
		return !!String(this.config.gcEmail ?? '').trim() && !!String(this.secrets.gcPassword ?? '')
	}

	/**
	 * Signs in to Grid Connect, reads every device's ID and local key, and fills in the device list
	 * (keeping any IP address typed in for a device). Only the list is kept: the lights are then
	 * controlled over the network as before. The password never goes in the log.
	 */
	async fetchGridConnect(restart = true) {
		if (this.gcBusy) return false // one at a time
		this.gcBusy = true
		try {
			return await this.#fetchGridConnect(restart)
		} finally {
			this.gcBusy = false
		}
	}

	async #fetchGridConnect(restart) {
		if (this.gcWaitUntil && Date.now() < this.gcWaitUntil) {
			const mins = Math.ceil((this.gcWaitUntil - Date.now()) / 60000)
			this.log('warn', `Grid Connect: not trying again yet (it asked to wait): try in ${mins} minute${mins === 1 ? '' : 's'}`)
			return false
		}
		if (!this.#gcReady()) {
			this.log('warn', 'Grid Connect: put your Grid Connect email and password in the settings first')
			return false
		}
		const email = String(this.config.gcEmail).trim()
		this.gcError = null
		try {
			this.updateStatus(InstanceStatus.Connecting, 'Signing in to Grid Connect…')
			this.log('info', 'Grid Connect: signing in…')
			const region = String(this.config.gcRegion ?? 'auto')
			const cloud = await signIn(email, String(this.secrets.gcPassword), {
				country: String(this.config.gcCountry ?? '61').replace(/\D/g, '') || '61',
				regions: REGIONS[region] ? [region] : Object.keys(REGIONS),
			})
			if (region !== cloud.region) {
				// remember where the account lives: next time only that data centre is asked
				this.config = { ...this.config, gcRegion: cloud.region }
			}
			const found = await cloud.devices()
			const ips = Object.fromEntries(parseTuyaDevices(this.config.tuyaDevices).filter((d) => d.ip).map((d) => [d.id, d.ip]))
			this.config = { ...this.config, tuyaDevices: devicesText(found, ips) }
			this.saveConfig(this.config, this.secrets)
			this.log('info', `Grid Connect: found ${found.length} device${found.length === 1 ? '' : 's'} (${cloud.region} data centre)`)
			if (!found.length) this.gcError = `signed in (${cloud.region}), but the account has no devices with keys`
			if (restart) await this.start()
			return true
		} catch (e) {
			this.log('error', e.message)
			if (e.lockout) this.gcWaitUntil = Date.now() + 15 * 60000
			this.gcError = e.lockout ? 'Grid Connect asked to wait 15 minutes' : 'sign-in failed (see the log)'
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Grid Connect sign-in failed: see the log')
			return false
		}
	}

	#startSoon() {
		this.start().catch((e) => this.log('error', `Start-up: ${e?.message ?? e}`))
	}

	async destroy() {
		this.gen = (this.gen ?? 0) + 1
		this.stop()
	}

	stop() {
		for (const t of this.timers) clearInterval(t)
		this.timers = []
		for (const d of this.tuya) d.stop()
		this.tuya = []
		for (const d of this.magic) d.stop()
		this.magic = []
	}

	async start() {
		this.stop()
		const gen = (this.gen = (this.gen ?? 0) + 1) // a newer start() takes over from this one
		this.targets.clear()
		this.scenes = []
		// Grid Connect / Tuya: each device kept connected
		const defs = parseTuyaDevices(this.config.tuyaDevices)
		this.tuya = defs.map(
			(def) =>
				new TuyaDevice(def, {
					log: (level, msg) => this.log(level, msg),
					onChange: (d) => this.#tuyaChanged(d),
				}),
		)
		for (const d of this.tuya) {
			this.#tuyaChanged(d, false)
			void d.start()
		}
		// Magic Home LED strips: listed in the settings, or found on the network the first time
		if (this.config.magicHome !== false) {
			let defs = parseMagicDevices(this.config.magicDevices)
			if (!defs.length && !this.magicLooked) {
				this.magicLooked = true // once per start-up of the module, not on every Save
				const found = await discoverMagicHome().catch(() => [])
				if (gen !== this.gen) return
				if (found.length) {
					const text = found.map((f) => `LED strip ${f.ip.split('.').pop()}, ${f.ip}`).join('\n')
					this.log('info', `Found ${found.length} Magic Home controller${found.length === 1 ? '' : 's'}: rename them in the settings if you like`)
					this.config = { ...this.config, magicDevices: text }
					this.saveConfig(this.config, this.secrets)
					defs = parseMagicDevices(text)
				}
			}
			this.magic = defs.map((def) => new MagicHomeDevice(def, { log: (level, msg) => this.log(level, msg), onChange: (d) => this.#magicChanged(d) }))
			for (const d of this.magic) {
				this.#magicChanged(d, false)
				void d.start()
			}
		}
		// Hue
		this.hue = null
		if (this.config.hue !== false) {
			let ip = String(this.config.hueIp ?? '').trim()
			if (!ip) {
				try {
					ip = (await HueBridge.discover())[0]?.ip ?? ''
					if (ip) {
						this.log('info', `Found a Hue Bridge at ${ip}`)
						this.config = { ...this.config, hueIp: ip }
						this.saveConfig(this.config, this.secrets)
					}
				} catch (e) {
					this.log('warn', `Couldn't find the Hue Bridge (${e.message}): type its address in the settings (Hue app: Settings → My Hue system → the bridge → IP address)`)
				}
			}
			if (gen !== this.gen) return
			if (ip) this.hue = new HueBridge({ ip, key: String(this.secrets.hueKey ?? '') })
		}
		this.updateDefinitions()
		const seconds = Math.max(1, Number(this.config.poll ?? 2))
		if (this.hue?.key) {
			this.timers.push(setInterval(() => void this.pollHue(), seconds * 1000))
			await this.pollHue()
		}
		this.#status()
	}

	#status() {
		const parts = []
		if (this.hue && !this.hue.key) parts.push('Hue: press the bridge button, then PAIR HUE')
		if (!this.hue && this.config.hue !== false) parts.push('Hue: no bridge found')
		if (this.hueError) parts.push(`Hue: ${this.hueError}`)
		if (this.gcError) parts.push(`Grid Connect: ${this.gcError}`)
		if (this.gcError) this.updateStatus(InstanceStatus.ConnectionFailure, parts.join('; '))
		else if (parts.length) this.updateStatus(InstanceStatus.UnknownWarning, parts.join('; '))
		else {
			// a device that's switched off at the wall isn't a problem with the connection: its key goes grey
			const all = [...this.tuya, ...this.magic]
			const off = all.filter((d) => !d.online).length
			this.updateStatus(InstanceStatus.Ok, `${this.targets.size} lights and rooms${off ? ` (${off} not reachable)` : ''}`)
		}
	}

	// ---------- Hue ----------

	async pollHue() {
		if (!this.hue?.key || this.polling) return
		this.polling = true
		try {
			const s = await this.hue.state()
			const before = this.#names()
			for (const l of s.lights) this.targets.set(`hue:light:${l.id}`, { id: `hue:light:${l.id}`, name: l.name, source: 'hue', kind: 'light', on: l.on && l.reachable, brightness: l.brightness, warmCold: l.warmCold, reachable: l.reachable })
			for (const g of s.groups) this.targets.set(`hue:group:${g.id}`, { id: `hue:group:${g.id}`, name: g.name, source: 'hue', kind: 'room', on: g.on, brightness: g.brightness, warmCold: null, reachable: true })
			const seen = new Set([...s.lights.map((l) => `hue:light:${l.id}`), ...s.groups.map((g) => `hue:group:${g.id}`)])
			for (const id of [...this.targets.keys()]) if (id.startsWith('hue:') && !seen.has(id)) this.targets.delete(id)
			const scenesChanged = JSON.stringify(s.scenes) !== JSON.stringify(this.scenes)
			this.scenes = s.scenes
			if (this.hueError) {
				this.hueError = ''
				this.#status()
			}
			if (scenesChanged || this.#names() !== before) {
				this.updateDefinitions()
				this.#status()
			}
			this.#publish()
		} catch (e) {
			if (e.message !== this.hueError) this.log('warn', `Hue: ${e.message}`)
			this.hueError = e.message
			this.#status()
		} finally {
			this.polling = false
		}
	}

	/** Pairing: keeps asking the bridge for PAIR_SECONDS; succeeds as soon as its button has been pressed. */
	async pairHue() {
		if (!this.hue) return this.log('warn', 'No Hue Bridge yet: type its address in the settings')
		if (this.pairing) return
		this.pairing = true
		this.log('info', `Pairing with the Hue Bridge: press the round button on top of it now (${PAIR_SECONDS} s)`)
		this.updateStatus(InstanceStatus.Connecting, 'Press the round button on the Hue Bridge')
		try {
			for (let t = 0; t < PAIR_SECONDS; t += 2) {
				const key = await this.hue.pairOnce().catch((e) => {
					this.log('warn', `Hue pairing: ${e.message}`)
					return null
				})
				if (key) {
					this.secrets = { ...this.secrets, hueKey: key }
					this.saveConfig(this.config, this.secrets)
					this.log('info', 'Paired with the Hue Bridge')
					await this.start()
					return
				}
				await new Promise((r) => setTimeout(r, 2000))
			}
			this.log('warn', "The Hue Bridge's button wasn't pressed in time: press it, then pair again")
			this.#status()
		} finally {
			this.pairing = false
		}
	}

	// ---------- Grid Connect / Tuya ----------

	#tuyaChanged(d, publish = true) {
		const id = `tuya:${d.id}`
		const had = this.targets.get(id)
		const s = d.state
		this.targets.set(id, { id, name: d.name, source: 'tuya', kind: d.schema.kind, on: s.on, brightness: s.brightness, warmCold: s.warmCold, reachable: s.reachable })
		if (!publish) return
		if (!had || had.kind !== d.schema.kind) this.updateDefinitions()
		if (!had || had.reachable !== s.reachable) this.#status()
		this.#publish()
	}

	// ---------- Magic Home ----------

	#magicChanged(d, publish = true) {
		const id = `magic:${d.id}`
		const had = this.targets.get(id)
		const s = d.state
		this.targets.set(id, { id, name: d.name, source: 'magic', kind: 'strip', on: s.on, brightness: s.brightness, warmCold: null, reachable: s.reachable })
		if (!publish) return
		if (!had) this.updateDefinitions()
		if (!had || had.reachable !== s.reachable) this.#status()
		this.#publish()
	}

	// ---------- changes ----------

	/** Sets a light, room or plug: { on, brightness (0-100), warmCold (0-100) }. */
	async change(id, change) {
		const t = this.targets.get(id)
		if (!t) return this.log('warn', `No light or room "${id}" (yet): is it connected?`)
		// show it straight away; the next read confirms
		if (change.on !== undefined) t.on = change.on
		if (change.brightness !== undefined) {
			t.brightness = Math.max(1, change.brightness)
			t.on = change.brightness > 0
		}
		if (change.warmCold !== undefined) t.warmCold = change.warmCold
		if (change.colour) t.on = true
		this.#publish()
		try {
			const [source, kind, rest] = id.split(':')
			if (source === 'hue' && kind === 'light') await this.hue.setLight(rest, change)
			else if (source === 'hue' && kind === 'group') await this.hue.setGroup(rest, change)
			else if (source === 'tuya') await this.tuya.find((d) => d.id === kind)?.set(change)
			else if (source === 'magic') await this.magic.find((d) => d.id === kind)?.set(change)
		} catch (e) {
			this.log('warn', `${t.name}: ${e.message}`)
		}
		if (id.startsWith('hue:')) setTimeout(() => void this.pollHue(), 400)
	}

	step(id, field, delta) {
		const t = this.targets.get(id)
		if (!t) return
		const base = field === 'brightness' ? (t.on ? (t.brightness ?? 100) : 0) : (t.warmCold ?? 50)
		return this.change(id, { [field]: clamp(base + delta) })
	}

	async allOff() {
		const jobs = []
		if (this.hue?.key) jobs.push(this.hue.setGroup('0', { on: false }).catch((e) => this.log('warn', `Hue all off: ${e.message}`)))
		for (const d of [...this.tuya, ...this.magic]) if (d.online) jobs.push(d.set({ on: false }).catch((e) => this.log('warn', `${d.name}: ${e.message}`)))
		for (const t of this.targets.values()) t.on = false
		this.#publish()
		await Promise.all(jobs)
		setTimeout(() => void this.pollHue(), 400)
	}

	// ---------- Companion ----------

	#names() {
		return [...this.targets.values()].map((t) => `${t.id}=${t.name}=${t.kind}`).join('|')
	}

	#list() {
		const order = { room: 0, light: 1, strip: 2, switch: 3 }
		return [...this.targets.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
	}

	#publish() {
		const values = { lights_on: [...this.targets.values()].filter((t) => t.kind !== 'room' && t.on).length }
		for (const t of this.targets.values()) {
			const v = slug(`${t.source}_${t.name}`)
			values[`${v}_brightness`] = t.on ? `${t.brightness ?? 100}%` : 'OFF'
			values[`${v}_on`] = t.on ? 'ON' : 'OFF'
		}
		this.setVariableValues(values)
		this.checkFeedbacks('is_on', 'unreachable')
	}

	updateDefinitions() {
		const list = this.#list()
		const label = (t) => (t.kind === 'room' ? `Room: ${t.name}` : t.source === 'tuya' ? `${t.name} (Grid Connect)` : t.source === 'magic' ? `${t.name} (Magic Home)` : t.name)
		const target = { type: 'dropdown', id: 'target', label: 'Light, room or plug', default: list[0]?.id ?? '', allowCustom: true, choices: list.map((t) => ({ id: t.id, label: label(t) })) }
		const mode = { type: 'dropdown', id: 'mode', label: 'Mode', default: 'toggle', choices: [{ id: 'toggle', label: 'Toggle' }, { id: 'on', label: 'On' }, { id: 'off', label: 'Off' }] }
		const dir = { type: 'dropdown', id: 'direction', label: 'Direction', default: 'up', choices: [{ id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }] }
		const size = { type: 'dropdown', id: 'size', label: 'Step size', default: 5, choices: STEPS.map((p, i) => ({ id: i + 1, label: `${i + 1} (${p}%)` })) }
		const pct = (id) => STEPS[(Number(id) || 5) - 1] ?? 8
		const scene = { type: 'dropdown', id: 'scene', label: 'Scene', default: this.scenes[0] ? `${this.scenes[0].group}/${this.scenes[0].id}` : '', choices: this.scenes.map((s) => ({ id: `${s.group}/${s.id}`, label: `${this.targets.get(`hue:group:${s.group}`)?.name ?? 'Room'}: ${s.name}` })) }

		this.setActionDefinitions({
			power: {
				name: 'On / off (light, room or plug)',
				options: [target, mode],
				callback: (a) => {
					const t = this.targets.get(a.options.target)
					const on = a.options.mode === 'on' ? true : a.options.mode === 'off' ? false : !t?.on
					return this.change(a.options.target, { on })
				},
			},
			brightness_step: {
				name: 'Brightness: step (knob)',
				options: [target, dir, size],
				callback: (a) => this.step(a.options.target, 'brightness', (a.options.direction === 'down' ? -1 : 1) * pct(a.options.size)),
			},
			brightness_set: {
				name: 'Brightness: set',
				options: [target, { type: 'number', id: 'value', label: 'Brightness % (0 = off)', default: 100, min: 0, max: 100 }],
				callback: (a) => this.change(a.options.target, { brightness: clamp(a.options.value) }),
			},
			warm_step: {
				name: 'Warm ↔ cold white: step (knob)',
				options: [target, { ...dir, choices: [{ id: 'up', label: 'Colder (bluer)' }, { id: 'down', label: 'Warmer (yellower)' }] }, size],
				callback: (a) => this.step(a.options.target, 'warmCold', (a.options.direction === 'down' ? -1 : 1) * pct(a.options.size)),
			},
			warm_set: {
				name: 'Warm ↔ cold white: set',
				options: [target, { type: 'number', id: 'value', label: '0 = warmest, 100 = coldest', default: 30, min: 0, max: 100 }],
				callback: (a) => this.change(a.options.target, { warmCold: clamp(a.options.value) }),
			},
			colour: {
				name: 'LED strip (Magic Home): colour',
				options: [
					{ ...target, choices: target.choices.filter((c) => c.id.startsWith('magic:')), default: list.find((t) => t.source === 'magic')?.id ?? '' },
					{ type: 'colorpicker', id: 'colour', label: 'Colour', default: 0xffffff },
				],
				callback: (a) => this.change(a.options.target, { colour: toRgb(a.options.colour) }),
			},
			scene: {
				name: 'Hue: scene',
				options: [scene],
				callback: async (a) => {
					const [group, id] = String(a.options.scene).split('/')
					if (!this.hue?.key || !group) return
					await this.hue.recallScene(group, id).catch((e) => this.log('warn', `Scene: ${e.message}`))
					setTimeout(() => void this.pollHue(), 400)
				},
			},
			all_off: { name: 'All lights off', options: [], callback: () => this.allOff() },
			pair_hue: { name: 'Hue: pair with the bridge (press its button first)', options: [], callback: () => this.pairHue() },
			fetch_gridconnect: { name: 'Grid Connect: fetch my devices again (after adding or re-pairing one)', options: [], callback: () => this.fetchGridConnect() },
			reconnect: { name: 'Reconnect everything (re-read lights, rooms and scenes)', options: [], callback: () => this.start() },
		})

		this.setFeedbackDefinitions({
			is_on: {
				type: 'boolean',
				name: 'Light, room or plug is on',
				defaultStyle: { bgcolor: AMBER, color: BLACK },
				options: [target],
				callback: (fb) => !!this.targets.get(fb.options.target)?.on,
			},
			unreachable: {
				type: 'boolean',
				name: "Light or plug can't be reached (powered off at the wall?)",
				defaultStyle: { bgcolor: GREY, color: combineRgb(160, 160, 160) },
				options: [target],
				callback: (fb) => {
					const t = this.targets.get(fb.options.target)
					return !!t && !t.reachable
				},
			},
		})

		const vars = [{ variableId: 'lights_on', name: 'How many lights and plugs are on' }]
		for (const t of list) {
			const v = slug(`${t.source}_${t.name}`)
			vars.push({ variableId: `${v}_brightness`, name: `${label(t)}: brightness (or OFF)` }, { variableId: `${v}_on`, name: `${label(t)}: ON / OFF` })
		}
		this.setVariableDefinitions(vars)

		this.presetMap = withSurfaceExtras({ ...this.#presets(list, label), ...getViewerPresets(this) })
		this.pageTargets = list.map((t) => ({ id: t.id, kind: t.kind, slug: slug(`${t.source}_${t.name}`) }))
		this.setPresetDefinitions(this.presetMap)
		this.#publish()
	}

	#presets(list, label) {
		const lbl = this.label || 'smart-lights'
		const v = (id) => `$(${lbl}:${id})`
		const presets = {}
		const lit = (id) => [
			{ feedbackId: 'is_on', options: { target: id }, style: { bgcolor: AMBER, color: BLACK } },
			{ feedbackId: 'unreachable', options: { target: id }, style: { bgcolor: GREY, color: combineRgb(160, 160, 160) } },
		]
		const key = (category, name, text, down, feedbacks = [], size = 'auto') => ({ type: 'button', category, name, style: { text, size, color: WHITE, bgcolor: DARK, show_topbar: false }, steps: [{ down, up: [] }], feedbacks })
		for (const t of list) {
			const s = slug(`${t.source}_${t.name}`)
			const cat = t.kind === 'room' ? 'Rooms' : t.source === 'tuya' ? 'Grid Connect' : t.source === 'magic' ? 'LED strips' : 'Hue lights'
			const name = short(t.name.toUpperCase())
			const hasBri = t.kind !== 'switch'
			const toggle = [{ actionId: 'power', options: { target: t.id, mode: 'toggle' } }]
			if (hasBri) {
				// tap = on / off; hold = full brightness (fires while still held)
				presets[`t_${s}`] = {
					...key(cat, `${label(t)}: tap = on / off, hold = 100%`, `${name}\\n${v(`${s}_brightness`)}`, [], lit(t.id)),
					steps: [{ down: [], up: toggle, [HOLD_MS]: { options: { runWhileHeld: true }, actions: [{ actionId: 'brightness_set', options: { target: t.id, value: 100 } }] } }],
				}
			} else presets[`t_${s}`] = key(cat, `${label(t)}: on / off`, `${name}\\n${v(`${s}_on`)}`, toggle, lit(t.id))
			if (hasBri) {
				presets[`k_${s}`] = {
					type: 'button',
					category: `${cat}: knobs`,
					name: `${label(t)}: brightness knob (push = on / off)`,
					options: { rotaryActions: true },
					style: { text: `${name}\\n${v(`${s}_brightness`)}`, size: 'auto', color: WHITE, bgcolor: DARK, show_topbar: false },
					steps: [
						{
							down: [{ actionId: 'power', options: { target: t.id, mode: 'toggle' } }],
							up: [],
							rotate_left: [{ actionId: 'brightness_step', options: { target: t.id, direction: 'down', size: 5 } }],
							rotate_right: [{ actionId: 'brightness_step', options: { target: t.id, direction: 'up', size: 5 } }],
						},
					],
					feedbacks: lit(t.id),
				}
			}
		}
		for (const t of list.filter((x) => x.source === 'magic')) {
			const s = slug(`${t.source}_${t.name}`)
			for (const [word, rgb] of COLOURS) {
				const fg = (rgb >> 16) * 0.3 + ((rgb >> 8) & 0xff) * 0.59 + (rgb & 0xff) * 0.11 > 140 ? BLACK : WHITE
				presets[`c_${s}_${word.toLowerCase()}`] = {
					type: 'button',
					category: 'LED strips: colours',
					name: `${label(t)}: ${word.toLowerCase()}`,
					style: { text: `${short(t.name.toUpperCase(), 12)}\\n${word}`, size: 'auto', color: fg, bgcolor: rgb, show_topbar: false },
					steps: [{ down: [{ actionId: 'colour', options: { target: t.id, colour: rgb } }], up: [] }],
					feedbacks: [],
				}
			}
		}
		for (const sc of this.scenes) {
			const room = this.targets.get(`hue:group:${sc.group}`)?.name ?? ''
			presets[`scene_${slug(sc.id)}`] = key('Hue scenes', `${room}: ${sc.name}`, `${short(sc.name.toUpperCase())}\\n${short(room, 12)}`, [{ actionId: 'scene', options: { scene: `${sc.group}/${sc.id}` } }])
		}
		presets.all_off = key('Everything', 'All lights off', 'ALL\\nOFF', [{ actionId: 'all_off', options: {} }], [], '18')
		presets.pair_hue = key('Everything', 'Pair with the Hue Bridge (press its button first)', 'PAIR\\nHUE', [{ actionId: 'pair_hue', options: {} }])
		presets.fetch_gridconnect = key('Everything', 'Fetch my Grid Connect devices again', 'FETCH\\nGRID CON', [{ actionId: 'fetch_gridconnect', options: {} }])
		presets.reconnect = key('Everything', 'Reconnect / re-read everything', 'RE-\\nCONNECT', [{ actionId: 'reconnect', options: {} }])
		return presets
	}

	/** The Home page, built from this connection's own lights, as a file Companion imports. */
	homePage() {
		return buildHomePages({ targets: this.pageTargets ?? [], presets: this.presetMap ?? {}, connection: { id: this.id, label: this.label } })
	}

	async handleHttpRequest(request) {
		const p = String(request.path ?? '').replace(/^\/+/, '')
		if (p === 'home-page' || p === 'home-page.companionconfig') {
			return {
				status: 200,
				headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="Smart Lights Home page.companionconfig"' },
				body: JSON.stringify(this.homePage(), null, 1),
			}
		}
		return { status: 404, body: 'Not found' }
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'homePage',
				width: 12,
				label: 'Home page for the D200X',
				value: `A ready-made page of your lights (rooms first; ALL OFF; knobs = brightness): <a href="/instance/${encodeURIComponent(this.label)}/home-page" target="_blank" download>download it</a>, then Import / Export → Import → pick the file → Buttons → choose an empty page. Download it again after adding lights.`,
			},
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Philips Hue',
				value: 'Leave the address blank to find the bridge by itself. To pair: press the round button on top of the Hue Bridge, then tick <b>Pair now</b> and Save within 30 seconds (or press a PAIR HUE key).',
			},
			{ type: 'checkbox', id: 'hue', label: 'Use a Hue Bridge', width: 3, default: true },
			{ type: 'textinput', id: 'hueIp', label: 'Hue Bridge address (blank = find it)', width: 5, default: '' },
			{ type: 'checkbox', id: 'pairNow', label: 'Pair now (press the bridge button first)', width: 4, default: false },
			{ type: 'secret-text', id: 'hueKey', label: 'Hue key (filled in by pairing)', width: 12, default: '' },
			{
				type: 'static-text',
				id: 'tuyaInfo',
				width: 12,
				label: 'Grid Connect (and other Tuya) bulbs and plugs',
				value: 'Type your Grid Connect app email and password, tick <b>Fetch my devices</b> and Save (it only signs in when you tick it): the module reads each device\'s ID and key and fills in the list below. After that everything is on your own network (the cloud is only used to fetch the list). Fetch again after adding or re-pairing a device. Unofficial: if Grid Connect changes its sign-in, paste the list by hand instead (see the setup guide).',
			},
			{ type: 'textinput', id: 'gcEmail', label: 'Grid Connect email', width: 5, default: '' },
			{ type: 'secret-text', id: 'gcPassword', label: 'Grid Connect password', width: 4, default: '' },
			{ type: 'textinput', id: 'gcCountry', label: 'Country code', width: 3, default: '61' },
			{
				type: 'dropdown',
				id: 'gcRegion',
				label: 'Grid Connect data centre (Find it = try each once; remembered after a sign-in)',
				width: 12,
				default: 'auto',
				choices: [{ id: 'auto', label: 'Find it' }, ...Object.keys(REGIONS).map((r) => ({ id: r, label: r }))],
			},
			{ type: 'checkbox', id: 'gcFetchNow', label: 'Fetch my devices (on Save)', width: 12, default: false },
			{ type: 'textinput', id: 'tuyaDevices', label: 'Grid Connect devices', width: 12, default: '', multiline: true },
			{
				type: 'static-text',
				id: 'magicInfo',
				width: 12,
				label: 'Magic Home LED strips',
				value: 'Found on your network by themselves the first time (leave the list blank). One per line: <i>Name, IP address</i>; rename them here. No account needed.',
			},
			{ type: 'checkbox', id: 'magicHome', label: 'Use Magic Home LED strips', width: 4, default: true },
			{ type: 'textinput', id: 'magicDevices', label: 'Magic Home LED strips (blank = find them)', width: 12, default: '', multiline: true },
			{ type: 'number', id: 'poll', label: 'Read the Hue lights every (seconds)', width: 6, default: 2, min: 1, max: 30 },
		]
	}
}

runEntrypoint(SmartLightsInstance, [])
