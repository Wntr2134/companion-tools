import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base'
import { candidateLibraries, openNdi, splitSourceName } from './ndi.js'
import { Router, parseRouteNames } from './router.js'

const GREEN = combineRgb(0, 140, 60)
const RED = combineRgb(180, 0, 0)
const GREY = combineRgb(40, 40, 40)
const WHITE = combineRgb(255, 255, 255)
const DEFAULT_ROUTES = 'Companion 1\nCompanion 2'

const short = (full) => {
	const { machine, name } = splitSourceName(full)
	return machine ? `${name} (${machine})` : name
}
const varKey = (i) => `route_${i + 1}`

class NdiRouterInstance extends InstanceBase {
	router = null
	pollTimer = null
	presetTimer = null

	async init(config) {
		this.config = config
		this.start()
	}

	async configUpdated(config) {
		// Saving the remembered routes also lands here: only restart when a real setting changed.
		const keys = ['routes', 'libPath', 'groups', 'extraIps']
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
		const names = this.routeNames()
		if (!names.length) {
			this.updateStatus(InstanceStatus.BadConfig, 'Add at least one route name')
			return
		}
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
		this.updateStatus(InstanceStatus.Ok, `${names.length} route${names.length === 1 ? '' : 's'}`)
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

	stop() {
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
			isVisible: (o) => o.source === 'custom',
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
						this.log('info', `${a.options.route} → ${source}`)
						this.remember()
					} else this.log('warn', `Couldn't route ${a.options.route} to ${source}`)
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
			route_watched: {
				type: 'boolean',
				name: 'Route is being watched (e.g. Virtual Input is using it)',
				defaultStyle: { bgcolor: RED, color: WHITE },
				options: [routeOption],
				callback: (fb) => (this.router?.routes.get(fb.options.route)?.connections ?? 0) > 0,
			},
		})

		const vars = [{ variableId: 'source_count', name: 'Number of NDI sources found' }]
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
			this.setPresetDefinitions(this.buildPresets(names, known))
		}, this.router ? 1000 : 0)
	}

	buildPresets(names, sources) {
		const label = this.label || 'ndi-router'
		const presets = {}
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
			{ type: 'textinput', id: 'routes', label: 'Route names (one per line, up to 16)', width: 12, default: DEFAULT_ROUTES, multiline: true },
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
