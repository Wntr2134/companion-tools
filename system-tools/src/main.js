import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base'
import { scanApps, runningApps, launchCommand, quitCommand, run, macPermissionHint } from './apps.js'

const GREEN = combineRgb(0, 140, 60)
const GREY = combineRgb(40, 40, 40)
const WHITE = combineRgb(255, 255, 255)

/** Preset categories by first letter, so a long list stays browsable. */
const GROUPS = [
	['A–C', /^[a-c]/i],
	['D–F', /^[d-f]/i],
	['G–L', /^[g-l]/i],
	['M–P', /^[m-p]/i],
	['Q–S', /^[q-s]/i],
	['T–Z', /^[t-z]/i],
]
const groupFor = (name) => (GROUPS.find(([, re]) => re.test(name)) ?? ['0–9 and other'])[0]

class AppLauncherInstance extends InstanceBase {
	apps = []
	running = new Set()
	pollTimer = null
	polling = false

	async init(config) {
		this.config = config
		this.updateDefinitions()
		await this.rescan()
	}

	async configUpdated(config) {
		this.config = config
		await this.rescan()
	}

	async destroy() {
		this.stopPoll()
	}

	byId(id) {
		return this.apps.find((a) => a.id === id)
	}

	async rescan() {
		this.stopPoll()
		if (process.platform !== 'darwin' && process.platform !== 'win32') {
			this.updateStatus(InstanceStatus.BadConfig, 'Only works on macOS and Windows')
			return
		}
		this.updateStatus(InstanceStatus.Connecting, 'Looking for apps…')
		try {
			const extraFolders = String(this.config.extraFolders ?? '')
				.split(/\r?\n/)
				.map((s) => s.trim())
				.filter(Boolean)
			this.apps = await scanApps({ includeSystem: this.config.includeSystem === true, extraFolders })
			this.log('info', `Found ${this.apps.length} apps`)
			if (this.apps.length) this.updateStatus(InstanceStatus.Ok, `${this.apps.length} apps`)
			else this.updateStatus(InstanceStatus.UnknownWarning, 'No apps found: see log')
		} catch (e) {
			this.log('error', `App scan failed: ${e.code ? e.code + ' ' : ''}${e.message}`)
			this.updateStatus(InstanceStatus.UnknownError, 'App scan failed: see log')
		}
		this.updateDefinitions()
		await this.pollRunning()
		this.startPoll()
	}

	startPoll() {
		const seconds = Number(this.config.pollSeconds ?? 3)
		if (!(seconds > 0)) return
		this.pollTimer = setInterval(() => void this.pollRunning(), seconds * 1000)
	}

	stopPoll() {
		if (this.pollTimer) clearInterval(this.pollTimer)
		this.pollTimer = null
	}

	async pollRunning() {
		if (this.polling || this.apps.length === 0) return
		this.polling = true
		try {
			const now = await runningApps(this.apps)
			const changed = now.size !== this.running.size || [...now].some((id) => !this.running.has(id))
			this.running = now
			if (changed) {
				this.checkFeedbacks('app_running')
				this.setVariableValues({ running_count: now.size })
			}
		} catch (e) {
			this.log('debug', `Running check failed: ${e.message}`)
		} finally {
			this.polling = false
		}
	}

	/** An app picked from the list, or one typed in (name or full path) with variables allowed. */
	async resolveApp(options, context) {
		if (options.app !== 'custom') return this.byId(options.app)
		const typed = (await context.parseVariablesInString(String(options.custom ?? ''))).trim()
		if (!typed) return undefined
		const lower = typed.toLowerCase()
		const known = this.apps.find((a) => a.name.toLowerCase() === lower || a.path.toLowerCase() === lower)
		if (known) return known
		// Not in the list: on a Mac `open -a` also accepts a plain app name; on Windows a full path works.
		return { id: 'custom', name: typed.replace(/\.app$/i, ''), path: typed }
	}

	async launch(app) {
		const [file, args] = launchCommand(app)
		try {
			await run(file, args)
			this.log('info', `Launched ${app.name}`)
			this.setVariableValues({ last_launched: app.name })
			setTimeout(() => void this.pollRunning(), 1500)
		} catch (e) {
			const why = (e.stderr || e.message).trim()
			this.log('error', `Couldn't launch ${app.name}: ${macPermissionHint(why) || why}`)
		}
	}

	async quit(app, force) {
		try {
			const [file, args] = quitCommand(app, { force })
			await run(file, args)
			this.log('info', `${force ? 'Force quit' : 'Quit'} ${app.name}`)
			setTimeout(() => void this.pollRunning(), 1500)
		} catch (e) {
			const why = (e.stderr || e.message).trim()
			this.log('error', `Couldn't quit ${app.name}: ${macPermissionHint(why) || why}`)
		}
	}

	updateDefinitions() {
		const choices = [
			...this.apps.map((a) => ({ id: a.id, label: a.name })),
			{ id: 'custom', label: '(Type a name or path below)' },
		]
		const appOption = { type: 'dropdown', id: 'app', label: 'App', default: choices[0].id, choices }
		const customOption = {
			type: 'textinput',
			id: 'custom',
			label: 'Name or full path (variables allowed)',
			default: '',
			useVariables: true,
			isVisibleExpression: `$(options:app) == 'custom'`,
		}

		this.setActionDefinitions({
			launch: {
				name: 'Launch / bring to front',
				description: 'Opens the app. If it is already open it comes to the front (Mac) or opens again (Windows, depends on the app).',
				options: [appOption, customOption],
				callback: async (a, context) => {
					const app = await this.resolveApp(a.options, context)
					if (app) await this.launch(app)
				},
			},
			quit: {
				name: 'Quit',
				options: [
					appOption,
					customOption,
					{
						type: 'checkbox',
						id: 'force',
						label: 'Force quit (unsaved work is lost)',
						default: false,
					},
				],
				callback: async (a, context) => {
					const app = await this.resolveApp(a.options, context)
					if (app) await this.quit(app, a.options.force === true)
				},
			},
			toggle: {
				name: 'Launch if closed, quit if open',
				options: [appOption],
				callback: async (a) => {
					const app = this.byId(a.options.app)
					if (!app) return
					if (this.running.has(app.id)) await this.quit(app, false)
					else await this.launch(app)
				},
			},
			rescan: {
				name: 'Rescan for apps',
				description: 'Run after installing or removing apps.',
				options: [],
				callback: async () => this.rescan(),
			},
		})

		this.setFeedbackDefinitions({
			app_running: {
				type: 'boolean',
				name: 'App is running',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [appOption],
				callback: (fb) => this.running.has(fb.options.app),
			},
		})

		this.setVariableDefinitions([
			{ variableId: 'app_count', name: 'Number of apps found' },
			{ variableId: 'running_count', name: 'Number of listed apps running' },
			{ variableId: 'last_launched', name: 'Last app launched' },
		])
		this.setVariableValues({ app_count: this.apps.length, running_count: this.running.size })

		const presets = {
			rescan: {
				type: 'button',
				category: 'Tools',
				name: 'Rescan apps',
				style: { text: 'RESCAN\\nAPPS', size: '14', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'rescan', options: {} }], up: [] }],
				feedbacks: [],
			},
		}
		for (const app of this.apps) {
			presets[`app_${app.id}`] = {
				type: 'button',
				category: `Apps ${groupFor(app.name)}`,
				name: app.name,
				style: { text: app.name, size: 'auto', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'launch', options: { app: app.id, custom: '' } }], up: [] }],
				feedbacks: [{ feedbackId: 'app_running', options: { app: app.id }, style: { bgcolor: GREEN, color: WHITE } }],
			}
		}
		this.setPresetDefinitions(presets)
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'What this does',
				value:
					'Lists the apps installed on the computer running Companion. Mac: the Applications folders. Windows: the Start Menu. Use the presets (one key per app, green while it is running) or the Launch / Quit actions.',
			},
			{
				type: 'checkbox',
				id: 'includeSystem',
				label: 'Mac: include built-in apps (Safari, Notes, System Settings…)',
				width: 6,
				default: false,
			},
			{
				type: 'number',
				id: 'pollSeconds',
				label: 'Check which apps are running every (seconds, 0 = off)',
				width: 6,
				default: 3,
				min: 0,
				max: 60,
			},
			{
				type: 'textinput',
				id: 'extraFolders',
				label: 'Mac: extra folders to search (one per line)',
				width: 12,
				default: '',
				multiline: true,
			},
		]
	}
}

runEntrypoint(AppLauncherInstance, [])
