import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base'
import { candidateLibraries, openNdi, splitSourceName } from './ndi.js'
import { Router, parseRouteNames } from './router.js'
import { runMenuScript, selectWithAutoOpen } from './virtual-input-mac.js'
import { getViewerPresets } from './viewers.js'

const GREEN = combineRgb(0, 140, 60)
const RED = combineRgb(180, 0, 0)
const GREY = combineRgb(40, 40, 40)
const WHITE = combineRgb(255, 255, 255)
const DEFAULT_ROUTES = 'Companion 1\nCompanion 2'
const DEFAULT_VI_APP = 'NDI Virtual Input'
const ORANGE = combineRgb(200, 110, 0)

const short = (full) => {
	const { machine, name } = splitSourceName(full)
	return machine ? `${name} (${machine})` : name
}
const varKey = (i) => `route_${i + 1}`

class NdiRouterInstance extends InstanceBase {
	router = null
	pollTimer = null
	presetTimer = null
	viSource = '' // what Companion last set NDI Virtual Input to (Mac)
	viQueue = Promise.resolve()

	async init(config) {
		this.config = config
		this.start()
	}

	async configUpdated(config) {
		// Saving the remembered routes also lands here: only restart when a real setting changed.
		const keys = ['routes', 'libPath', 'groups', 'extraIps', 'viApp', 'viPoll']
		const changed = keys.some((k) => (config[k] ?? '') !== (this.config[k] ?? ''))
		this.config = config
		if (changed) {
			this.stop()
			this.start()
		}
	}

	async destroy() {
		this.stop()
	}

	routeNames() {
		return parseRouteNames(this.config.routes ?? DEFAULT_ROUTES)
	}

	start() {
		this.updateDefinitions()
		this.startViPoll()
		const names = this.routeNames()
		const typed = String(this.config.libPath ?? '').trim()
		const candidates = typed ? [typed] : candidateLibraries()
		if (!candidates.length) {
			this.updateStatus(InstanceStatus.BadConfig, 'NDI not found: install NDI Tools, or set the library path')
			this.log('error', 'No NDI runtime found. Install NDI Tools (it includes the runtime) or set "NDI library" in the settings.')
			return
		}
		let lastError
		for (const libPath of candidates) {
			try {
				const ndi = openNdi(libPath, { groups: this.config.groups || null, extraIps: this.config.extraIps || null })
				let saved = {}
				try {
					saved = JSON.parse(this.config.savedRoutes || '{}')
				} catch {
					// ignore a damaged value
				}
				this.router = new Router(ndi, names, saved)
				this.log('info', `Using NDI ${ndi.version || ''} from ${libPath}`)
				break
			} catch (e) {
				lastError = e
				this.log('warn', `Couldn't use ${libPath}: ${e.message}`)
			}
		}
		if (!this.router) {
			this.updateStatus(InstanceStatus.ConnectionFailure, `NDI failed to load: ${lastError?.message ?? 'unknown'}`)
			return
		}
		this.router.on('sources', () => {
			this.updateDefinitions()
			this.publish()
		})
		this.router.on('routes', () => {
			this.publish()
			this.checkFeedbacks('route_is', 'route_watched')
		})
		this.updateStatus(InstanceStatus.Ok, names.length ? `${names.length} route${names.length === 1 ? '' : 's'}` : 'No routes (Virtual Input keys only)')
		this.publish()
		this.pollTimer = setInterval(() => {
			try {
				this.router?.poll()
			} catch (e) {
				this.log('debug', `NDI poll failed: ${e.message}`)
			}
		}, 1000)
		this.router.poll()
	}

	startViPoll() {
		const seconds = Number(this.config.viPoll ?? 10)
		if (process.platform !== 'darwin' || !(seconds > 0)) return
		this.viTimer = setInterval(() => void this.readVirtualInput(), seconds * 1000)
		void this.readVirtualInput()
	}

	stop() {
		if (this.viTimer) clearInterval(this.viTimer)
		this.viTimer = null
		if (this.pollTimer) clearInterval(this.pollTimer)
		if (this.presetTimer) clearTimeout(this.presetTimer)
		this.pollTimer = this.presetTimer = null
		try {
			this.router?.destroy()
		} catch (e) {
			this.log('debug', `NDI shutdown: ${e.message}`)
		}
		this.router = null
	}

	/** Mac: pick a source in NDI Virtual Input's drop-down. One at a time, so clicks never overlap. */
	switchVirtualInput(source) {
		this.viPending = (this.viPending ?? 0) + 1
		this.viQueue = this.viQueue.then(async () => {
			if (process.platform !== 'darwin') {
				this.log('warn', 'Switching NDI Virtual Input in the app only works on a Mac. Use a route instead.')
				return
			}
			const { machine, name } = splitSourceName(source)
			try {
				const now = await selectWithAutoOpen(
					{ processName: this.viApp(), full: source, machine, short: name, after: this.config.viAfter || 'return' },
					{ autoOpen: this.config.viAutoOpen !== false },
				)
				this.log('info', `NDI Virtual Input → ${now || source}`)
				this.setViSource(now || source)
			} catch (e) {
				this.log('error', `NDI Virtual Input: ${e.message}`)
			} finally {
				this.viPending--
			}
		})
		return this.viQueue
	}

	/** Mac: read what Virtual Input shows (also catches changes made by hand). Never holds up a key press. */
	async readVirtualInput() {
		if (this.viPending > 0 || this.viReading) return
		this.viReading = true
		try {
			const now = await runMenuScript({ processName: this.viApp(), mode: 'read' })
			if (now !== '?' && !this.viPending) this.setViSource(now) // '?' = Virtual Input doesn't say: keep the last known
		} catch {
			// not running / window closed: leave the last known value
		} finally {
			this.viReading = false
		}
	}

	viApp() {
		return this.config.viApp || DEFAULT_VI_APP
	}

	setViSource(value) {
		const v = String(value ?? '')
		if (v === this.viSource) return
		this.viSource = v
		this.setVariableValues({ vi_source: v ? splitSourceName(v).name : 'None', vi_source_full: v })
		this.checkFeedbacks('vi_is')
	}

	remember() {
		if (!this.router) return
		const savedRoutes = JSON.stringify(this.router.snapshot())
		if (savedRoutes === this.config.savedRoutes) return
		this.config = { ...this.config, savedRoutes }
		this.saveConfig(this.config)
	}

	publish() {
		const values = { source_count: this.router?.sourceList.length ?? 0 }
		this.routeNames().forEach((name, i) => {
			const target = this.router?.targetOf(name) ?? ''
			const r = this.router?.routes.get(name)
			values[`${varKey(i)}_name`] = name
			values[`${varKey(i)}_source`] = target ? splitSourceName(target).name : ''
			values[`${varKey(i)}_source_full`] = target
			values[`${varKey(i)}_watchers`] = r?.connections ?? ''
		})
		this.setVariableValues(values)
	}

	updateDefinitions() {
		const names = this.routeNames()
		const sources = this.router?.sourceList ?? []
		const routeChoices = names.map((n) => ({ id: n, label: n }))
		const routeOption = { type: 'dropdown', id: 'route', label: 'Route', default: names[0] ?? '', choices: routeChoices }
		// Keep the current targets in the list even if a source has dropped off the network.
		const known = [...new Set([...sources, ...names.map((n) => this.router?.targetOf(n)).filter(Boolean)])]
		const sourceChoices = [...known.map((s) => ({ id: s, label: short(s) })), { id: 'custom', label: '(Type the source name below)' }]
		const sourceOption = {
			type: 'dropdown',
			id: 'source',
			label: 'NDI source',
			default: sourceChoices[0].id,
			choices: sourceChoices,
			allowCustom: true,
		}
		const customOption = {
			type: 'textinput',
			id: 'custom',
			label: 'Full NDI name, e.g. STUDIO-PC (Cam 1). Variables allowed.',
			default: '',
			useVariables: true,
			isVisibleExpression: `$(options:source) == 'custom'`,
		}

		this.setActionDefinitions({
			route: {
				name: 'Route a source',
				description: 'Points the route at an NDI source. Whatever watches the route (Virtual Input, a monitor, OBS) switches to it.',
				options: [routeOption, sourceOption, customOption],
				callback: async (a, context) => {
					if (!this.router) return
					let source = a.options.source
					if (source === 'custom') source = (await context.parseVariablesInString(String(a.options.custom ?? ''))).trim()
					if (!source) return
					if (this.router.route(a.options.route, source)) {
						const url = this.router.ndi.urlOf?.(source)
						this.log('info', `${a.options.route} → ${source}${url ? ` (${url})` : ' (address not seen yet: by name)'}`)
						this.remember()
					} else this.log('warn', `NDI refused to route ${a.options.route} to ${source}`)
				},
			},
			vi_select: {
				name: 'Mac: switch NDI Virtual Input (its source drop-down)',
				description: "Picks the source in NDI Virtual Input's own window, no route needed. Needs Accessibility permission for Companion, and Virtual Input's window open.",
				options: [sourceOption, customOption],
				callback: async (a, context) => {
					let source = a.options.source
					if (source === 'custom') source = (await context.parseVariablesInString(String(a.options.custom ?? ''))).trim()
					if (source) await this.switchVirtualInput(source)
				},
			},
			vi_list: {
				name: "Mac: list NDI Virtual Input's sources (to the log)",
				description: "Writes every entry in Virtual Input's drop-down to the Log tab. Useful if a source isn't found.",
				options: [],
				callback: async () => {
					if (process.platform !== 'darwin') return
					try {
						const list = JSON.parse(await runMenuScript({ processName: this.config.viApp || DEFAULT_VI_APP, mode: 'list' }))
						this.log('info', `NDI Virtual Input drop-down: ${list.join(' | ')}`)
					} catch (e) {
						this.log('error', `NDI Virtual Input: ${e.message}`)
					}
				},
			},
			clear: {
				name: 'Clear a route (black)',
				options: [routeOption],
				callback: async (a) => {
					if (this.router?.clear(a.options.route)) this.remember()
				},
			},
		})

		this.setFeedbackDefinitions({
			route_is: {
				type: 'boolean',
				name: 'Route is showing source',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [routeOption, sourceOption],
				callback: (fb) => !!this.router && this.router.targetOf(fb.options.route) === fb.options.source,
			},
			vi_is: {
				type: 'boolean',
				name: 'NDI Virtual Input is on source (Mac)',
				defaultStyle: { bgcolor: ORANGE, color: WHITE },
				options: [sourceOption],
				callback: (fb) => !!this.viSource && this.viSource.toLowerCase() === String(fb.options.source).toLowerCase(),
			},
			route_watched: {
				type: 'boolean',
				name: 'Route is being watched (e.g. Virtual Input is using it)',
				defaultStyle: { bgcolor: RED, color: WHITE },
				options: [routeOption],
				callback: (fb) => (this.router?.routes.get(fb.options.route)?.connections ?? 0) > 0,
			},
		})

		const vars = [
			{ variableId: 'source_count', name: 'Number of NDI sources found' },
			{ variableId: 'vi_source', name: 'NDI Virtual Input source (Mac, short name)' },
			{ variableId: 'vi_source_full', name: 'NDI Virtual Input source (Mac, full NDI name)' },
		]
		names.forEach((name, i) => {
			vars.push({ variableId: `${varKey(i)}_name`, name: `Route ${i + 1} name` })
			vars.push({ variableId: `${varKey(i)}_source`, name: `Route ${i + 1} (${name}): source showing (short name)` })
			vars.push({ variableId: `${varKey(i)}_source_full`, name: `Route ${i + 1} (${name}): source showing (full NDI name)` })
			vars.push({ variableId: `${varKey(i)}_watchers`, name: `Route ${i + 1} (${name}): number of receivers watching` })
		})
		this.setVariableDefinitions(vars)

		// Presets can be many: rebuild them at most once a second while sources come and go.
		if (this.presetTimer) clearTimeout(this.presetTimer)
		this.presetTimer = setTimeout(() => {
			this.presetTimer = null
			this.setPresetDefinitions({ ...this.buildPresets(names, known), ...getViewerPresets(this) })
		}, this.router ? 1000 : 0)
	}

	buildPresets(names, sources) {
		const label = this.label || 'ndi-router'
		const presets = {}
		const viCategory = 'Virtual Input (Mac: switch in the app)'
		presets.vi_now = {
			type: 'button',
			category: viCategory,
			name: "Virtual Input: what's showing",
			style: { text: `VIRTUAL IN\\n$(${label}:vi_source)`, size: '14', color: WHITE, bgcolor: GREY },
			steps: [{ down: [], up: [] }],
			feedbacks: [],
		}
		sources.forEach((source, j) => {
			const { machine, name } = splitSourceName(source)
			presets[`vi_${j}`] = {
				type: 'button',
				category: viCategory,
				name: `Virtual Input ← ${short(source)}`,
				style: { text: machine ? `${name}\\n${machine}` : name, size: 'auto', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'vi_select', options: { source, custom: '' } }], up: [] }],
				feedbacks: [{ feedbackId: 'vi_is', options: { source }, style: { bgcolor: ORANGE, color: WHITE } }],
			}
		})
		names.forEach((route, i) => {
			const category = `Route: ${route}`
			presets[`clear_${i}`] = {
				type: 'button',
				category,
				name: `${route}: clear`,
				style: { text: `${route}\\nCLEAR`, size: '14', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'clear', options: { route } }], up: [] }],
				feedbacks: [],
			}
			presets[`show_${i}`] = {
				type: 'button',
				category,
				name: `${route}: what's showing`,
				style: { text: `${route}\\n$(${label}:${varKey(i)}_source)`, size: '14', color: WHITE, bgcolor: GREY },
				steps: [{ down: [], up: [] }],
				feedbacks: [{ feedbackId: 'route_watched', options: { route }, style: { bgcolor: RED, color: WHITE } }],
			}
			sources.forEach((source, j) => {
				const { machine, name } = splitSourceName(source)
				presets[`r${i}_s${j}`] = {
					type: 'button',
					category,
					name: `${route} ← ${short(source)}`,
					style: { text: machine ? `${name}\\n${machine}` : name, size: 'auto', color: WHITE, bgcolor: GREY },
					steps: [{ down: [{ actionId: 'route', options: { route, source, custom: '' } }], up: [] }],
					feedbacks: [{ feedbackId: 'route_is', options: { route, source }, style: { bgcolor: GREEN, color: WHITE } }],
				}
			})
		})
		return presets
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'How it works',
				value:
					'Each route is a new NDI source made by Companion, e.g. <b>YOUR-COMPUTER (Companion 1)</b>. Point NDI Virtual Input (or a monitor, OBS, vMix…) at it once. Then Companion buttons choose which camera that route shows. Needs NDI Tools installed on this computer. Routes exist while Companion is running.',
			},
			{
				type: 'textinput',
				id: 'routes',
				label: 'Route names (one per line, up to 16). Leave empty if you only use the Virtual Input keys.',
				width: 12,
				default: DEFAULT_ROUTES,
				multiline: true,
			},
			{
				type: 'textinput',
				id: 'viApp',
				label: 'Mac: NDI Virtual Input app name (for the "switch in the app" keys)',
				width: 8,
				default: DEFAULT_VI_APP,
			},
			{
				type: 'dropdown',
				id: 'viAfter',
				label: 'Mac: after switching Virtual Input',
				width: 8,
				default: 'return',
				choices: [
					{ id: 'return', label: 'Go back to the app I was using (default)' },
					{ id: 'hide', label: 'Hide Virtual Input and go back (its camera keeps working)' },
					{ id: 'stay', label: 'Leave Virtual Input in front' },
				],
			},
			{
				type: 'checkbox',
				id: 'viAutoOpen',
				label: 'Mac: open Virtual Input if it is closed',
				width: 4,
				default: true,
			},
			{
				type: 'number',
				id: 'viPoll',
				label: 'Mac: check what Virtual Input shows every (s, 0 = off)',
				width: 4,
				default: 10,
				min: 0,
				max: 60,
			},
			{ type: 'textinput', id: 'groups', label: 'NDI groups (optional, comma separated)', width: 6, default: '' },
			{ type: 'textinput', id: 'extraIps', label: 'Extra IPs to look for sources on (optional, comma separated)', width: 6, default: '' },
			{
				type: 'textinput',
				id: 'libPath',
				label: 'NDI library (leave blank to find it automatically)',
				width: 12,
				default: '',
				tooltip: 'Mac: e.g. /usr/local/lib/libndi.dylib. Windows: e.g. C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\Processing.NDI.Lib.x64.dll',
			},
		]
	}
}

runEntrypoint(NdiRouterInstance, [])
