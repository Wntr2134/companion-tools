import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base'
import os from 'node:os'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { scanApps, runningApps, launchCommand, quitCommand, run } from './apps.js'
import { POSITIONS, parseLayout, windowRequest, placeItem, restoreItems, summarise } from './mac-windows.js'
import {
	SOUND_READ,
	SOUND_SET,
	parseSound,
	isDarkMode,
	DARK_MODE_SET,
	EJECT_ALL,
	KEY_CODES,
	KEY_LABELS,
	MODIFIERS,
	shortcutLabel,
	SEND_KEYS,
	TYPE_TEXT,
	PASTE_TEXT,
	SPACE_SWITCH,
	LOCK_SCREEN,
	MISSION_CONTROL_PATHS,
	MAGNET,
	parseShortcutList,
	KeepAwake,
	macPermissionHint,
} from './mac-system.js'
import { cpuPercent, parseVmStat, parsePmset, mainIp, fmtUptime, fmtBytes, diskFree } from './sysinfo.js'
import { withSurfaceExtras } from './surface-extras.js'
import { getViewerPresets } from './viewers.js'
import { readDock, DOCK_SLOTS } from './dock.js'
import { Bluetooth } from './bluetooth.js'
import { IconCache, shortName } from './icons.js'
import { CompanionApi, companionRoot, planUpdates, scanInstalled } from './updater.js'

const GREEN = combineRgb(0, 140, 60)
const BLUE = combineRgb(10, 110, 230) // lit system keys (macOS accent blue)
const AMBER = combineRgb(230, 150, 0)
const GREY = combineRgb(40, 40, 40)
const DARK = combineRgb(24, 26, 30)
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const VOLUME_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20]
const ECHO_GUARD_MS = 1500
const LAYOUT_SLOTS = 6
const LAYOUT_FILE = path.join(os.homedir(), 'Library', 'Application Support', 'Companion Tools', 'window-layouts.json')

/** Media keys on Windows (volume up/down/mute). The key code comes in through an environment variable. */
const WIN_KEY = `
Add-Type -Name K -Namespace SystemToolsKeys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'
$vk = [byte][int]$env:ST_VK
[SystemToolsKeys.K]::keybd_event($vk, 0, 0, [System.UIntPtr]::Zero)
[SystemToolsKeys.K]::keybd_event($vk, 0, 2, [System.UIntPtr]::Zero)
`.trim()
const WIN_VK = { up: 0xaf, down: 0xae, mute: 0xad }

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
const short = (s, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

class SystemToolsInstance extends InstanceBase {
	apps = []
	running = new Set()
	dock = []
	btDevices = []
	btPolling = false
	dockRunning = new Set()
	screens = []
	shortcuts = []
	sound = { output: null, input: null, muted: false }
	dark = false
	layouts = {}
	timers = []
	polling = false
	sysPolling = false
	volTarget = null
	volSetAt = 0
	volSending = false
	cpuSample = os.cpus()

	get mac() {
		return process.platform === 'darwin'
	}

	async init(config, _isFirstInit, secrets) {
		this.config = config
		this.secrets = secrets ?? {}
		this.keepAwake = new KeepAwake()
		this.keepAwake.onChange = () => {
			this.setVariableValues({ keep_awake: this.keepAwake.on ? 'ON' : 'OFF' })
			this.checkFeedbacks('keep_awake')
		}
		await this.loadLayouts()
		this.updateDefinitions()
		await this.rescan()
		if (this.mac) {
			void this.refreshScreens()
			void this.refreshShortcuts()
		}
	}

	async configUpdated(config, secrets) {
		this.config = config
		this.secrets = secrets ?? {}
		await this.rescan()
		if (this.mac) void this.refreshShortcuts()
	}

	async destroy() {
		this.stopPolls()
		this.keepAwake?.stop(true)
	}

	byId(id) {
		return this.apps.find((a) => a.id === id)
	}

	// ---------- apps ----------

	async rescan() {
		this.stopPolls()
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
		await this.refreshDock(false)
		void this.refreshIcons()
		this.updateDefinitions()
		await this.pollRunning()
		this.startPolls()
	}

	/** Paired Bluetooth devices and whether each is connected. Redraws the presets when the list changes. */
	async refreshBluetooth() {
		if (!this.mac || this.btPolling) return
		this.btPolling = true
		try {
			this.bt ??= new Bluetooth()
			const list = await this.bt.list()
			const namesChanged = list.map((d) => d.address + d.name).join('|') !== this.btDevices.map((d) => d.address + d.name).join('|')
			const stateChanged = list.some((d, i) => d.connected !== this.btDevices[i]?.connected)
			this.btDevices = list
			if (namesChanged) this.updateDefinitions()
			if (namesChanged || stateChanged) {
				this.checkFeedbacks('bt_connected')
				this.setVariableValues({ bt_connected: list.filter((d) => d.connected).map((d) => d.name).join(', ') })
			}
		} catch (e) {
			if (!this.btWarned) this.log('warn', `Bluetooth: ${macPermissionHint(e.message) || e.message.split('\n')[0]}`)
			this.btWarned = true
		} finally {
			this.btPolling = false
		}
	}

	async setBluetooth(address, mode) {
		if (this.macOnly('Bluetooth')) return
		const d = this.btDevices.find((x) => x.address === address)
		const connect = mode === 'on' ? true : mode === 'off' ? false : !d?.connected
		try {
			this.bt ??= new Bluetooth()
			await this.bt.set(address, connect)
			this.log('info', `${connect ? 'Connected' : 'Disconnected'} ${d?.name ?? address}`)
		} catch (e) {
			this.fail(`Bluetooth ${connect ? 'connect' : 'disconnect'} ${d?.name ?? address}`, e)
		}
		setTimeout(() => void this.refreshBluetooth(), 1500)
	}

	get showIcons() {
		return this.mac && this.config.icons !== false
	}

	/** Draws (or loads from the cache) the icon of every listed app and Dock app, then shows them. */
	async refreshIcons() {
		if (!this.showIcons) return
		this.icons ??= new IconCache()
		try {
			const n = await this.icons.ensure([...this.dock.map((d) => d.path), ...this.apps.map((a) => a.path)])
			this.log('debug', `${n} app icons ready`)
			this.checkFeedbacks('app_icon', 'dock_icon')
		} catch (e) {
			this.log('debug', `App icons: ${e.message}`)
		}
	}

	/** An icon as the key's picture (under the name). */
	iconStyle(appPath) {
		const png = appPath && this.showIcons ? this.icons?.get(appPath) : undefined
		return png ? { png64: png, pngalignment: 'center:center' } : {}
	}

	/** The apps in the Mac's Dock, for the "Your Dock" keys. Redraws the presets only when the Dock changed. */
	async refreshDock(redefine = true) {
		if (!this.mac) return
		try {
			const dock = await readDock()
			const changed = dock.map((d) => d.path).join('\n') !== this.dock.map((d) => d.path).join('\n')
			this.dock = dock
			const values = { dock_count: dock.length }
			for (let i = 1; i <= DOCK_SLOTS; i++) {
				values[`dock_${i}`] = dock[i - 1]?.name ?? ''
				values[`dock_${i}_short`] = shortName(dock[i - 1]?.name ?? '')
			}
			this.setVariableValues(values)
			if (changed && redefine) this.updateDefinitions()
			if (changed && redefine) void this.refreshIcons()
		} catch (e) {
			this.log('debug', `Dock read failed: ${e.message}`)
		}
	}

	startPolls() {
		const seconds = Number(this.config.pollSeconds ?? 3)
		if (seconds > 0) this.timers.push(setInterval(() => void this.pollRunning(), seconds * 1000))
		this.timers.push(setInterval(() => void this.pollSystem(), 2000))
		this.timers.push(setInterval(() => void this.pollInfo(), 5000))
		this.timers.push(setInterval(() => this.tickClock(), 1000))
		if (this.mac) this.timers.push(setInterval(() => void this.refreshScreens(), 30000))
		if (this.mac) this.timers.push(setInterval(() => void this.refreshDock(), 60000))
		this.timers.push(setInterval(() => void this.autoUpdate(), 60000))
		setTimeout(() => void this.autoUpdate(), 5000)
		if (this.mac) this.timers.push(setInterval(() => void this.refreshBluetooth(), 10000))
		if (this.mac) void this.refreshBluetooth()
		this.tickClock()
		void this.pollSystem()
		void this.pollInfo()
	}

	stopPolls() {
		for (const t of this.timers) clearInterval(t)
		this.timers = []
	}

	async pollRunning() {
		if (this.polling || (this.apps.length === 0 && this.dock.length === 0)) return
		this.polling = true
		try {
			const now = await runningApps(this.apps)
			const changed = now.size !== this.running.size || [...now].some((id) => !this.running.has(id))
			this.running = now
			if (changed) {
				this.checkFeedbacks('app_running')
				this.setVariableValues({ running_count: now.size })
			}
			if (this.dock.length) {
				const dockNow = await runningApps(this.dock.map((d, i) => ({ id: String(i + 1), path: d.path })))
				const dockChanged = dockNow.size !== this.dockRunning.size || [...dockNow].some((id) => !this.dockRunning.has(id))
				this.dockRunning = dockNow
				if (dockChanged) this.checkFeedbacks('dock_running')
			}
		} catch (e) {
			this.log('debug', `Running check failed: ${e.message}`)
		} finally {
			this.polling = false
		}
	}

	/** An app picked from the list, or one typed in (name or full path) with variables allowed. */
	async resolveApp(options, context) {
		if (options.app === 'front') return null
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
			this.fail(`Couldn't launch ${app.name}`, e)
		}
	}

	async quit(app, force) {
		try {
			const [file, args] = quitCommand(app, { force })
			await run(file, args)
			this.log('info', `${force ? 'Force quit' : 'Quit'} ${app.name}`)
			setTimeout(() => void this.pollRunning(), 1500)
		} catch (e) {
			this.fail(`Couldn't quit ${app.name}`, e)
		}
	}

	fail(what, e) {
		const why = String(e?.stderr || e?.message || e).trim()
		this.log('error', `${what}: ${macPermissionHint(why) || why}`)
	}

	macOnly(what) {
		if (this.mac) return false
		this.log('warn', `${what} works on a Mac only`)
		return true
	}

	// ---------- windows ----------

	async refreshScreens() {
		try {
			const list = await windowRequest({ cmd: 'screens' })
			const names = list.map((s, i) => `${i + 1}: ${s.name}`).join(', ')
			const changed = list.length !== this.screens.length || list.some((s, i) => s.name !== this.screens[i]?.name)
			this.screens = list
			this.setVariableValues({ screen_count: list.length, screens: names })
			if (changed) this.updateDefinitions()
		} catch (e) {
			this.log('debug', `Screen list failed: ${e.message}`)
		}
	}

	async placeWindows(items, what) {
		if (this.macOnly('Moving windows')) return
		try {
			const results = await windowRequest({ cmd: 'place', items })
			const { good, bad, text } = summarise(results)
			if (bad.length) this.log('warn', `${what}: ${text}`)
			else this.log('debug', `${what}: ${good} window(s) placed`)
		} catch (e) {
			this.fail(what, e)
		}
	}

	async loadLayouts() {
		try {
			this.layouts = JSON.parse(await readFile(LAYOUT_FILE, 'utf8')) ?? {}
		} catch {
			this.layouts = {}
		}
	}

	async saveLayout(slot) {
		if (this.macOnly('Saving a window layout')) return
		try {
			const windows = await windowRequest({ cmd: 'capture' })
			this.layouts[slot] = { savedAt: new Date().toISOString(), apps: windows }
			await mkdir(path.dirname(LAYOUT_FILE), { recursive: true })
			await writeFile(LAYOUT_FILE, JSON.stringify(this.layouts, null, 1))
			this.log('info', `Layout ${slot} saved: ${windows.map((a) => a.app).join(', ')}`)
			this.checkFeedbacks('layout_saved')
		} catch (e) {
			this.fail(`Couldn't save layout ${slot}`, e)
		}
	}

	async restoreLayout(slot, launch) {
		const saved = this.layouts[slot]
		if (!saved) return this.log('warn', `Layout ${slot} is empty: arrange your windows and press a "Save layout ${slot}" key first`)
		await this.placeWindows(restoreItems(saved.apps, { launch }), `Layout ${slot}`)
	}

	// ---------- sound, dark mode, info ----------

	async pollSystem() {
		if (!this.mac || this.sysPolling) return
		this.sysPolling = true
		try {
			const s = parseSound(await run('osascript', ['-e', SOUND_READ]))
			if (this.volTarget !== null && Date.now() - this.volSetAt < ECHO_GUARD_MS) s.output = this.volTarget
			else this.volTarget = null
			const dark = await isDarkMode()
			const soundChanged = s.output !== this.sound.output || s.input !== this.sound.input || s.muted !== this.sound.muted
			this.sound = s
			if (soundChanged) {
				this.setVariableValues({ volume: s.output ?? '–', input_volume: s.input ?? '–', muted: s.muted ? 'MUTED' : '' })
				this.checkFeedbacks('muted')
			}
			if (dark !== this.dark) {
				this.dark = dark
				this.setVariableValues({ dark_mode: dark ? 'ON' : 'OFF' })
				this.checkFeedbacks('dark_mode')
			}
		} catch (e) {
			this.log('debug', `System read failed: ${e.message}`)
		} finally {
			this.sysPolling = false
		}
	}

	async pollInfo() {
		const values = {}
		const now = os.cpus()
		const cpu = cpuPercent(this.cpuSample, now)
		this.cpuSample = now
		values.cpu = cpu === null ? '' : `${cpu}%`
		let mem = null
		if (this.mac) {
			try {
				mem = parseVmStat(await run('vm_stat', []), os.totalmem())
			} catch {
				// fall through to os.freemem
			}
		}
		if (mem === null) mem = Math.round((1 - os.freemem() / os.totalmem()) * 100)
		values.memory = `${mem}%`
		try {
			const d = await diskFree()
			values.disk_free = fmtBytes(d.free)
			values.disk_used = d.total ? `${Math.round((1 - d.free / d.total) * 100)}%` : ''
		} catch {
			values.disk_free = ''
		}
		values.battery = ''
		if (this.mac) {
			try {
				const b = parsePmset(await run('pmset', ['-g', 'batt']))
				values.battery = b ? `${b.percent}%${b.charging ? ' ⚡' : ''}` : ''
			} catch {
				// desktop Macs have no battery
			}
		}
		values.ip = mainIp()
		this.companionPort = await this.companionAdminPort()
		values.companion_url = values.ip ? `http://${values.ip}:${this.companionPort}` : ''
		values.uptime = fmtUptime(os.uptime())
		values.cpu_memory = `CPU ${values.cpu}  ·  RAM ${values.memory}`
		values.disk_battery = values.battery ? `Disk ${values.disk_free} free  ·  🔋 ${values.battery}` : `Disk ${values.disk_free} free`
		this.setVariableValues(values)
	}

	tickClock() {
		const now = new Date()
		const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
		if (clock === this.clock) return
		this.clock = clock
		this.setVariableValues({
			clock,
			date: now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }),
			date_short: now.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
		})
	}

	/** The port Companion's admin pages are on (Settings → Admin port), 8000 unless changed. */
	/**
	 * Moves connections onto the newest installed version of their module (the bundle import adds new
	 * versions next to the old ones). Needs a Companion REST API key in the settings.
	 */
	async autoUpdate(manual = false) {
		const key = String(this.secrets?.apiKey ?? '').trim()
		if (this.config.autoUpdate === false && !manual) return
		if (!key) {
			if (manual) this.log('warn', 'Auto-update needs a Companion API key: see this connection\'s settings')
			return
		}
		try {
			const installed = await scanInstalled(path.join(companionRoot(), 'modules'))
			const api = new CompanionApi({ port: await this.companionAdminPort(), key })
			const plan = planUpdates(await api.connections(), installed, { onlyOurs: this.config.updateAll !== true })
			// System Tools itself goes last: switching it restarts this module.
			plan.sort((a, b) => (a.moduleId === 'system-tools') - (b.moduleId === 'system-tools'))
			for (const p of plan) {
				this.log('info', `Updating ${p.label} (${p.moduleId}) from ${p.from} to ${p.to}`)
				await api.setVersion(p.id, p.to)
			}
			this.setVariableValues({ last_update: plan.length ? `${plan.length} updated ${this.clock ?? ''}`.trim() : 'all up to date' })
			if (manual && !plan.length) this.log('info', 'Every connection is already on its newest installed version')
			this.lastUpdateError = ''
		} catch (e) {
			// The same problem is logged once (and again whenever it changes), not every minute.
			if (manual || e.message !== this.lastUpdateError) this.log('warn', `Auto-update: ${e.message}`)
			this.lastUpdateError = e.message
			this.setVariableValues({ last_update: 'failed: see log' })
		}
	}

	async companionAdminPort() {
		try {
			const port = (await this.parseVariablesInString('$(internal:bind_port)')).trim()
			if (/^\d+$/.test(port)) return Number(port)
		} catch {
			// fall back to Companion's default
		}
		return 8000
	}

	async setSound(what, value) {
		try {
			await run('osascript', ['-e', SOUND_SET, what, String(value)])
		} catch (e) {
			this.fail('Sound', e)
		}
		setTimeout(() => void this.pollSystem(), 300)
	}

	/** Fast knob turns: keep a local target and send it, never more than one set at a time. */
	async stepVolume(delta) {
		if (!this.mac) return this.winKey(delta > 0 ? 'up' : 'down')
		const base = this.volTarget ?? this.sound.output ?? 50
		this.volTarget = Math.max(0, Math.min(100, Math.round(base + delta)))
		this.volSetAt = Date.now()
		this.sound.output = this.volTarget
		this.setVariableValues({ volume: this.volTarget })
		if (this.volSending) return
		this.volSending = true
		try {
			let sent
			while (sent !== this.volTarget) {
				sent = this.volTarget
				await run('osascript', ['-e', SOUND_SET, 'output', String(sent)]).catch((e) => this.fail('Volume', e))
				this.volSetAt = Date.now()
			}
		} finally {
			this.volSending = false
		}
	}

	async winKey(which) {
		try {
			await new Promise((resolve, reject) => {
				const env = { ...process.env, ST_VK: String(WIN_VK[which]) }
				execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_KEY], { env, windowsHide: true, timeout: 8000 }, (err) => (err ? reject(err) : resolve()))
			})
		} catch (e) {
			this.fail('Volume key', e)
		}
	}

	// ---------- Shortcuts app ----------

	async refreshShortcuts() {
		try {
			const list = parseShortcutList(await run('shortcuts', ['list'], { timeout: 20000 }))
			if (list.join('\n') !== this.shortcuts.join('\n')) {
				this.shortcuts = list
				this.updateDefinitions()
			}
		} catch (e) {
			this.log('debug', `Shortcuts list failed: ${e.message}`)
		}
	}

	async osa(script, args, what, lang = 'AppleScript') {
		if (this.macOnly(what)) return
		try {
			await run('osascript', ['-l', lang, '-e', script, ...args.map(String)])
		} catch (e) {
			this.fail(what, e)
		}
	}

	// ---------- definitions ----------

	updateDefinitions() {
		const appChoices = this.apps.map((a) => ({ id: a.id, label: a.name }))
		const appOption = { type: 'dropdown', id: 'app', label: 'App', default: appChoices[0]?.id ?? 'custom', choices: [...appChoices, { id: 'custom', label: '(Type a name or path below)' }] }
		const windowAppOption = {
			type: 'dropdown',
			id: 'app',
			label: 'Window of',
			default: 'front',
			choices: [{ id: 'front', label: '(The window in front)' }, ...appChoices, { id: 'custom', label: '(Type an app name below)' }],
		}
		const customOption = {
			type: 'textinput',
			id: 'custom',
			label: 'Name or full path (variables allowed)',
			default: '',
			useVariables: true,
			isVisibleExpression: `$(options:app) == 'custom'`,
		}
		const screenCount = Math.max(2, this.screens.length)
		const btOption = {
			type: 'dropdown',
			id: 'device',
			label: 'Device',
			default: this.btDevices[0]?.address ?? '',
			allowCustom: true,
			choices: this.btDevices.map((d) => ({ id: d.address, label: `${d.name} (${d.address})` })),
		}
		const dockSlotOption = {
			type: 'dropdown',
			id: 'slot',
			label: 'Dock position',
			default: '2',
			choices: Array.from({ length: DOCK_SLOTS }, (_, i) => ({ id: String(i + 1), label: `${i + 1}${this.dock[i] ? `: ${this.dock[i].name}` : ''}` })),
		}
		const screenOption = {
			type: 'dropdown',
			id: 'screen',
			label: 'Screen',
			default: 'same',
			choices: [
				{ id: 'same', label: 'The screen it is on' },
				{ id: 'next', label: 'Next screen' },
				{ id: 'previous', label: 'Previous screen' },
				...Array.from({ length: screenCount }, (_, i) => ({ id: String(i + 1), label: `Screen ${i + 1}${this.screens[i] ? `: ${this.screens[i].name}` : ''}` })),
			],
		}
		const positionOption = { type: 'dropdown', id: 'position', label: 'Position', default: 'full', choices: Object.entries(POSITIONS).map(([id, p]) => ({ id, label: p.label })) }
		const mode = { type: 'dropdown', id: 'mode', label: 'Mode', default: 'toggle', choices: [{ id: 'toggle', label: 'Toggle' }, { id: 'on', label: 'On' }, { id: 'off', label: 'Off' }] }
		const want = (m, current) => (m === 'on' ? true : m === 'off' ? false : !current)
		const slotOption = { type: 'dropdown', id: 'slot', label: 'Layout', default: '1', choices: Array.from({ length: LAYOUT_SLOTS }, (_, i) => ({ id: String(i + 1), label: `Layout ${i + 1}` })) }
		const dir = { type: 'dropdown', id: 'direction', label: 'Direction', default: 'up', choices: [{ id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }] }
		const sizeOption = { type: 'dropdown', id: 'size', label: 'Step size', default: 2, choices: VOLUME_STEPS.map((pct, i) => ({ id: i + 1, label: `${i + 1} (${pct}%)${i === 1 ? ' default' : ''}` })) }
		const keyChoices = [
			...'abcdefghijklmnopqrstuvwxyz0123456789'.split('').map((c) => ({ id: c, label: c.toUpperCase() })),
			...Object.entries(KEY_LABELS).map(([id, label]) => ({ id, label })),
			...Object.keys(KEY_CODES)
				.filter((k) => /^f\d+$/.test(k))
				.map((k) => ({ id: k, label: k.toUpperCase() })),
			...['-', '=', '[', ']', ';', "'", ',', '.', '/', '\\', '`'].map((c) => ({ id: c, label: c })),
		]
		const sendToOption = { type: 'textinput', id: 'target', label: 'Bring this app to the front first (blank = whatever is in front)', default: '', useVariables: true }
		const pickWindowApp = async (o, ctx) => {
			if (o.app === 'front') return null
			const app = await this.resolveApp(o, ctx)
			return app ?? { name: '', path: '' }
		}

		const actions = {
			// apps (ids kept from App Launcher so old keys keep working)
			launch: {
				name: 'App: launch / bring to front',
				description: 'Opens the app. If it is already open it comes to the front (Mac) or opens again (Windows, depends on the app).',
				options: [appOption, customOption],
				callback: async (a, context) => {
					const app = await this.resolveApp(a.options, context)
					if (app) await this.launch(app)
				},
			},
			quit: {
				name: 'App: quit',
				options: [appOption, customOption, { type: 'checkbox', id: 'force', label: 'Force quit (unsaved work is lost)', default: false }],
				callback: async (a, context) => {
					const app = await this.resolveApp(a.options, context)
					if (app) await this.quit(app, a.options.force === true)
				},
			},
			toggle: {
				name: 'App: launch if closed, quit if open',
				options: [appOption],
				callback: async (a) => {
					const app = this.byId(a.options.app)
					if (!app) return
					if (this.running.has(app.id)) await this.quit(app, false)
					else await this.launch(app)
				},
			},
			dock_launch: {
				name: 'App: open the app in a Dock position (Mac)',
				description: '1 = Finder (always first in the Dock), 2 = the next app along, and so on. Follows your Dock: rearrange the Dock and the keys follow.',
				options: [dockSlotOption],
				callback: async (a) => {
					if (this.macOnly('Dock apps')) return
					const app = this.dock[Number(a.options.slot) - 1]
					if (!app) return this.log('warn', `There is no app in Dock position ${a.options.slot}`)
					await this.launch(app)
				},
			},
			bluetooth: {
				name: 'Bluetooth: connect / disconnect a device (Mac)',
				description: 'Your paired devices: headphones, speakers, keyboards… Pair a device once in System Settings → Bluetooth first.',
				options: [btOption, mode],
				callback: (a) => this.setBluetooth(String(a.options.device), a.options.mode),
			},
			refresh_bluetooth: { name: 'Bluetooth: re-read the paired devices (Mac)', options: [], callback: () => this.refreshBluetooth() },
			update_modules: {
				name: 'Companion: put every connection on its newest module version',
				description: 'Runs the auto-update now. Needs a Companion API key in this connection\'s settings.',
				options: [],
				callback: () => this.autoUpdate(true),
			},
			refresh_dock: { name: 'App: re-read the Dock (Mac)', options: [], callback: () => this.refreshDock() },
			rescan: { name: 'App: rescan for apps', description: 'Run after installing or removing apps.', options: [], callback: async () => this.rescan() },
			hide_app: {
				name: 'App: hide (Mac)',
				options: [windowAppOption, customOption],
				callback: async (a, ctx) => {
					if (this.macOnly('Hiding apps')) return
					const app = await pickWindowApp(a.options, ctx)
					await windowRequest({ cmd: 'hide', item: { app: app?.name ?? '', path: app?.path ?? '' } }).catch((e) => this.fail('Hide', e))
				},
			},
			hide_others: {
				name: 'App: hide all the others (Mac)',
				options: [windowAppOption, customOption],
				callback: async (a, ctx) => {
					if (this.macOnly('Hiding apps')) return
					const app = await pickWindowApp(a.options, ctx)
					await windowRequest({ cmd: 'hide_others', item: { app: app?.name ?? '', path: app?.path ?? '' } }).catch((e) => this.fail('Hide others', e))
				},
			},
			show_all: {
				name: 'App: show all hidden apps (Mac)',
				options: [],
				callback: async () => {
					if (this.macOnly('Showing apps')) return
					await windowRequest({ cmd: 'show_all' }).catch((e) => this.fail('Show all', e))
				},
			},

			// windows
			window_place: {
				name: 'Window: move / resize (Mac)',
				description: 'Puts a window on a screen, in a position. Needs Companion allowed under Privacy & Security → Accessibility.',
				options: [
					windowAppOption,
					customOption,
					screenOption,
					positionOption,
					{ type: 'checkbox', id: 'launch', label: 'Open the app first if it is closed', default: true, isVisibleExpression: `$(options:app) != 'front'` },
				],
				callback: async (a, ctx) => {
					const app = await pickWindowApp(a.options, ctx)
					const screen = /^\d+$/.test(String(a.options.screen)) ? Number(a.options.screen) : a.options.screen
					await this.placeWindows([placeItem(app, screen, a.options.position, { launch: app ? a.options.launch !== false : false })], app ? app.name : 'Front window')
				},
			},
			window_minimise: {
				name: 'Window: minimise (Mac)',
				options: [windowAppOption, customOption],
				callback: async (a, ctx) => {
					if (this.macOnly('Minimising')) return
					const app = await pickWindowApp(a.options, ctx)
					await windowRequest({ cmd: 'minimise', item: { app: app?.name ?? '', path: app?.path ?? '' } }).catch((e) => this.fail('Minimise', e))
				},
			},
			layout_apply: {
				name: 'Window layout: arrange apps (written list, Mac)',
				description: 'One line per app: "App name, screen, position". Positions: fill, left, right, top, bottom, left third, centre third, right third, left two thirds, right two thirds, top left, top right, bottom left, bottom right, centre large, centre.',
				options: [
					{ type: 'textinput', id: 'layout', label: 'Layout', default: 'Safari, 1, left\nFinder, 1, right', multiline: true, useVariables: true },
					{ type: 'checkbox', id: 'launch', label: 'Open apps that are closed', default: true },
				],
				callback: async (a, ctx) => {
					const { items, errors } = parseLayout(await ctx.parseVariablesInString(String(a.options.layout ?? '')))
					for (const e of errors) this.log('warn', `Layout: ${e}`)
					const placed = items.map((it) => {
						const known = this.apps.find((x) => x.name.toLowerCase() === it.app.toLowerCase())
						return placeItem(known ?? { name: it.app, path: '' }, it.screen, it.position, { launch: a.options.launch !== false })
					})
					if (placed.length) await this.placeWindows(placed, 'Layout')
				},
			},
			layout_save: { name: 'Window layout: save where the windows are now (Mac)', options: [slotOption], callback: (a) => this.saveLayout(String(a.options.slot)) },
			layout_restore: {
				name: 'Window layout: put windows back to a saved layout (Mac)',
				options: [slotOption, { type: 'checkbox', id: 'launch', label: 'Open apps that are closed', default: false }],
				callback: (a) => this.restoreLayout(String(a.options.slot), a.options.launch === true),
			},
			screens_refresh: { name: 'Window: refresh the screen list (Mac)', options: [], callback: () => this.refreshScreens() },
			magnet: {
				name: 'Magnet: send its shortcut (needs Magnet with its default shortcuts)',
				options: [{ type: 'dropdown', id: 'move', label: 'Magnet', default: 'left', choices: Object.entries(MAGNET).map(([id, m]) => ({ id, label: `${m.label} (${shortcutLabel(m.key, m.mods)})` })) }],
				callback: async (a) => {
					const m = MAGNET[a.options.move]
					if (m) await this.osa(SEND_KEYS, [m.key, m.mods.join(','), ''], 'Magnet', 'JavaScript')
				},
			},

			// show machine
			keep_awake: {
				name: 'Keep awake (stop the Mac sleeping)',
				description: 'Uses macOS\'s own caffeinate. Stops when you switch it off or Companion closes.',
				options: [mode, { type: 'checkbox', id: 'displays', label: 'Keep the displays on too', default: true }],
				callback: (a) => {
					if (this.macOnly('Keep awake')) return
					if (want(a.options.mode, this.keepAwake.on)) this.keepAwake.start(a.options.displays !== false)
					else this.keepAwake.stop()
				},
			},
			display_sleep: {
				name: 'Sleep the displays now',
				options: [],
				callback: async () => {
					if (this.macOnly('Sleeping the displays')) return
					await run('pmset', ['displaysleepnow']).catch((e) => this.fail('Display sleep', e))
				},
			},
			lock_screen: {
				name: 'Lock the screen',
				options: [],
				callback: async () => {
					if (process.platform === 'win32') return run('rundll32.exe', ['user32.dll,LockWorkStation']).catch((e) => this.fail('Lock', e))
					await this.osa(LOCK_SCREEN, [], 'Lock screen', 'JavaScript')
				},
			},
			screen_saver: {
				name: 'Start the screen saver (Mac)',
				options: [],
				callback: async () => {
					if (this.macOnly('Screen saver')) return
					await run('open', ['-a', 'ScreenSaverEngine']).catch((e) => this.fail('Screen saver', e))
				},
			},
			eject_disks: {
				name: 'Eject all disks (Mac)',
				description: 'USB sticks, SD cards, external drives and disk images. A disk that is in use stays (see the log).',
				options: [],
				callback: async () => {
					if (this.macOnly('Ejecting disks')) return
					try {
						const n = (await run('osascript', ['-e', EJECT_ALL], { timeout: 60000 })).trim()
						this.log('info', `Ejected ${n} disk(s)`)
					} catch (e) {
						this.fail('Eject', e)
					}
				},
			},
			dark_mode: {
				name: 'Dark mode (Mac)',
				options: [mode],
				callback: async (a) => {
					await this.osa(DARK_MODE_SET, [a.options.mode], 'Dark mode')
					setTimeout(() => void this.pollSystem(), 500)
				},
			},
			open_companion: {
				name: "Open Companion's admin page on this computer",
				description: 'Uses 127.0.0.1, so it works whatever the network or IP address. For a phone or iPad, use the companion_url variable (the Companion address viewer).',
				options: [
					{
						type: 'dropdown',
						id: 'page',
						label: 'Page',
						default: '',
						choices: [
							{ id: '', label: 'Admin (where you left off)' },
							{ id: 'buttons', label: 'Buttons' },
							{ id: 'connections', label: 'Connections' },
							{ id: 'emulator', label: 'Emulator' },
							{ id: 'tablet', label: 'Web buttons' },
						],
					},
				],
				callback: async (a) => {
					const url = `http://127.0.0.1:${await this.companionAdminPort()}/${a.options.page ?? ''}`
					if (process.platform === 'win32') await run('explorer.exe', [url]).catch(() => null)
					else await run('open', [url]).catch((e) => this.fail('Open Companion', e))
				},
			},
			open_target: {
				name: 'Open a file, folder or web link',
				options: [{ type: 'textinput', id: 'target', label: 'Path or link (variables allowed)', default: 'https://', useVariables: true }],
				callback: async (a, ctx) => {
					const target = (await ctx.parseVariablesInString(String(a.options.target ?? ''))).trim()
					if (!target) return
					const t = target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : target
					if (process.platform === 'win32') await run('explorer.exe', [t]).catch(() => null)
					else await run('open', [t]).catch((e) => this.fail(`Open ${target}`, e))
				},
			},

			// sound
			volume_step: {
				name: 'Sound: volume step (knob)',
				description: 'Mac: the output volume. Windows: the volume keys.',
				options: [dir, sizeOption],
				callback: (a) => {
					const pct = VOLUME_STEPS[(Number(a.options.size) || 2) - 1] ?? 3
					return this.stepVolume(a.options.direction === 'down' ? -pct : pct)
				},
			},
			volume_set: {
				name: 'Sound: set the volume (Mac)',
				options: [{ type: 'number', id: 'volume', label: 'Volume (0-100)', default: 50, min: 0, max: 100 }],
				callback: (a) => !this.macOnly('Setting the volume') && this.setSound('output', a.options.volume),
			},
			mute: {
				name: 'Sound: mute',
				options: [mode],
				callback: (a) => {
					if (!this.mac) return this.winKey('mute')
					return this.setSound('mute', want(a.options.mode, this.sound.muted))
				},
			},
			input_step: {
				name: 'Sound: microphone level step (knob, Mac)',
				options: [dir, sizeOption],
				callback: (a) => {
					if (this.macOnly('Microphone level')) return
					const pct = VOLUME_STEPS[(Number(a.options.size) || 2) - 1] ?? 3
					const next = Math.max(0, Math.min(100, (this.sound.input ?? 50) + (a.options.direction === 'down' ? -pct : pct)))
					this.sound.input = next
					this.setVariableValues({ input_volume: next })
					return this.setSound('input', next)
				},
			},

			// desktop
			mission_control: {
				name: 'Desktop: Mission Control / show desktop / app windows (Mac)',
				options: [
					{
						type: 'dropdown',
						id: 'view',
						label: 'Show',
						default: 'mission',
						choices: [
							{ id: 'mission', label: 'Mission Control' },
							{ id: 'desktop', label: 'Show desktop' },
							{ id: 'app', label: "The front app's windows" },
						],
					},
				],
				callback: async (a) => {
					if (this.macOnly('Mission Control')) return
					const arg = { mission: [], desktop: ['1'], app: ['2'] }[a.options.view] ?? []
					for (const p of MISSION_CONTROL_PATHS) {
						try {
							await run(p, arg)
							return
						} catch (e) {
							if (e.code !== 'ENOENT') return this.fail('Mission Control', e)
						}
					}
				},
			},
			space: {
				name: 'Desktop: switch to the desktop on the left / right (Mac)',
				options: [{ type: 'dropdown', id: 'direction', label: 'Direction', default: 'right', choices: [{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }] }],
				callback: (a) => this.osa(SPACE_SWITCH, [a.options.direction], 'Switch desktop', 'JavaScript'),
			},

			// keys and text
			send_keys: {
				name: 'Keys: press a keyboard shortcut (Mac)',
				options: [{ type: 'dropdown', id: 'key', label: 'Key', default: 'space', choices: keyChoices }, ...MODIFIERS.map((m) => ({ type: 'checkbox', id: m, label: m[0].toUpperCase() + m.slice(1), default: m === 'command', width: 3 })), sendToOption],
				callback: async (a, ctx) => {
					const target = (await ctx.parseVariablesInString(String(a.options.target ?? ''))).trim()
					await this.osa(SEND_KEYS, [a.options.key, MODIFIERS.filter((m) => a.options[m]).join(','), target], 'Keyboard shortcut', 'JavaScript')
				},
			},
			type_text: {
				name: 'Keys: type text (Mac)',
				description: 'Types it like a keyboard. For long text use "paste text", which is instant.',
				options: [{ type: 'textinput', id: 'text', label: 'Text (variables allowed)', default: '', useVariables: true }, sendToOption],
				callback: async (a, ctx) => {
					const text = await ctx.parseVariablesInString(String(a.options.text ?? ''))
					const target = (await ctx.parseVariablesInString(String(a.options.target ?? ''))).trim()
					if (text) await this.osa(TYPE_TEXT, [text, target], 'Type text', 'JavaScript')
				},
			},
			paste_text: {
				name: 'Keys: paste text (Mac)',
				description: 'Puts the text on the clipboard and presses ⌘V.',
				options: [
					{ type: 'textinput', id: 'text', label: 'Text (variables allowed)', default: '', useVariables: true, multiline: true },
					sendToOption,
					{ type: 'checkbox', id: 'restore', label: 'Put back what was on the clipboard (text only)', default: false },
				],
				callback: async (a, ctx) => {
					const text = await ctx.parseVariablesInString(String(a.options.text ?? ''))
					const target = (await ctx.parseVariablesInString(String(a.options.target ?? ''))).trim()
					if (text) await this.osa(PASTE_TEXT, [text, target, a.options.restore ? 'true' : 'false'], 'Paste text', 'JavaScript')
				},
			},

			// Shortcuts app
			run_shortcut: {
				name: 'Shortcuts: run a shortcut (Mac)',
				description: 'Runs one of your shortcuts from the Shortcuts app: Focus modes, wallpapers, smart home and anything else Shortcuts can do.',
				options: [{ type: 'dropdown', id: 'name', label: 'Shortcut', default: this.shortcuts[0] ?? '', allowCustom: true, choices: this.shortcuts.map((n) => ({ id: n, label: n })) }],
				callback: async (a, ctx) => {
					if (this.macOnly('Shortcuts')) return
					const name = (await ctx.parseVariablesInString(String(a.options.name ?? ''))).trim()
					if (!name) return
					try {
						await run('shortcuts', ['run', name], { timeout: 120000 })
						this.log('info', `Ran shortcut "${name}"`)
					} catch (e) {
						this.fail(`Shortcut "${name}"`, e)
					}
				},
			},
			refresh_shortcuts: { name: 'Shortcuts: refresh the list (Mac)', options: [], callback: () => this.refreshShortcuts() },
		}
		this.setActionDefinitions(actions)

		this.setFeedbackDefinitions({
			app_running: {
				type: 'boolean',
				name: 'App is running',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [appOption],
				callback: (fb) => this.running.has(fb.options.app),
			},
			bt_connected: {
				type: 'boolean',
				name: 'Bluetooth device is connected (Mac)',
				defaultStyle: { bgcolor: BLUE, color: WHITE },
				options: [btOption],
				callback: (fb) => !!this.btDevices.find((d) => d.address === fb.options.device)?.connected,
			},
			app_icon: {
				type: 'advanced',
				name: "App's icon on the key (Mac)",
				description: 'Draws the app icon in the top of the key, with room for the name underneath (text aligned to the bottom).',
				options: [appOption],
				callback: (fb) => this.iconStyle(this.byId(fb.options.app)?.path),
			},
			dock_icon: {
				type: 'advanced',
				name: "Dock app's icon on the key (Mac)",
				options: [dockSlotOption],
				callback: (fb) => this.iconStyle(this.dock[Number(fb.options.slot) - 1]?.path),
			},
			dock_running: {
				type: 'boolean',
				name: 'The app in a Dock position is running (Mac)',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [dockSlotOption],
				callback: (fb) => this.dockRunning.has(String(fb.options.slot)),
			},
			keep_awake: { type: 'boolean', name: 'Keep awake is on', defaultStyle: { bgcolor: AMBER, color: BLACK }, options: [], callback: () => this.keepAwake.on },
			muted: { type: 'boolean', name: 'Sound is muted (Mac)', defaultStyle: { bgcolor: combineRgb(200, 30, 30), color: WHITE }, options: [], callback: () => !!this.sound.muted },
			dark_mode: { type: 'boolean', name: 'Dark mode is on (Mac)', defaultStyle: { bgcolor: BLUE, color: WHITE }, options: [], callback: () => this.dark },
			layout_saved: { type: 'boolean', name: 'A window layout is saved in this slot', defaultStyle: { color: WHITE }, options: [slotOption], callback: (fb) => !!this.layouts[String(fb.options.slot)] },
		})

		this.setVariableDefinitions([
			{ variableId: 'app_count', name: 'Number of apps found' },
			{ variableId: 'running_count', name: 'Number of listed apps running' },
			{ variableId: 'last_launched', name: 'Last app launched' },
			{ variableId: 'dock_count', name: 'Number of apps in the Dock (Mac)' },
			{ variableId: 'bt_connected', name: 'Bluetooth devices connected now (Mac)' },
			...Array.from({ length: DOCK_SLOTS }, (_, i) => ({ variableId: `dock_${i + 1}`, name: `Dock app ${i + 1} (Mac)` })),
			...Array.from({ length: DOCK_SLOTS }, (_, i) => ({ variableId: `dock_${i + 1}_short`, name: `Dock app ${i + 1}, short name for under its icon (Mac)` })),
			{ variableId: 'clock', name: 'Time now (HH:MM)' },
			{ variableId: 'date', name: 'Date (Wednesday 22 October)' },
			{ variableId: 'date_short', name: 'Date (Wed 22 Oct)' },
			{ variableId: 'cpu', name: 'CPU in use' },
			{ variableId: 'memory', name: 'Memory in use' },
			{ variableId: 'cpu_memory', name: 'CPU and memory on one line' },
			{ variableId: 'disk_free', name: 'Free space on the startup disk' },
			{ variableId: 'disk_used', name: 'Startup disk used %' },
			{ variableId: 'battery', name: 'Battery (blank on desktops)' },
			{ variableId: 'disk_battery', name: 'Disk free and battery on one line' },
			{ variableId: 'ip', name: 'IP address' },
			{ variableId: 'last_update', name: 'Auto-update: what it last did' },
			{ variableId: 'companion_url', name: "Companion's address for other devices (http://IP:port)" },
			{ variableId: 'uptime', name: 'Time since the computer started' },
			{ variableId: 'volume', name: 'Output volume (Mac; – when the device has no volume)' },
			{ variableId: 'input_volume', name: 'Microphone level (Mac)' },
			{ variableId: 'muted', name: '"MUTED" when muted (Mac)' },
			{ variableId: 'keep_awake', name: 'Keep awake ON/OFF' },
			{ variableId: 'dark_mode', name: 'Dark mode ON/OFF (Mac)' },
			{ variableId: 'screen_count', name: 'Number of screens (Mac)' },
			{ variableId: 'screens', name: 'Screen numbers and names (Mac)' },
		])
		this.setVariableValues({ app_count: this.apps.length, running_count: this.running.size, keep_awake: this.keepAwake?.on ? 'ON' : 'OFF' })

		this.setPresetDefinitions(withSurfaceExtras({ ...this.buildPresets(screenCount), ...getViewerPresets(this) }))
	}

	buildPresets(screenCount) {
		const label = this.label || 'system-tools'
		const v = (id) => `$(${label}:${id})`
		const key = (category, name, text, down, feedbacks = [], size = '14') => ({
			type: 'button',
			category,
			name,
			style: { text, size, color: WHITE, bgcolor: DARK, show_topbar: false },
			steps: [{ down, up: [] }],
			feedbacks,
		})
		const act = (actionId, options = {}) => [{ actionId, options }]
		// App keys: icon on top, short name underneath (Mac; can be switched off in the settings)
		const icons = this.showIcons
		const presets = {}

		// Windows: the one in front
		const front = (position, screen = 'same') => act('window_place', { app: 'front', custom: '', screen, position, launch: false })
		for (const [id, p] of Object.entries(POSITIONS)) {
			if (id === 'keep') continue
			presets[`win_${id}`] = key('Windows: front window', `Front window: ${p.label}`, p.short, front(id), [], 'auto')
		}
		presets.win_next = key('Windows: front window', 'Front window: next screen (same spot)', 'NEXT\\nSCREEN ▶', front('keep', 'next'))
		presets.win_prev = key('Windows: front window', 'Front window: previous screen (same spot)', '◀ PREV\\nSCREEN', front('keep', 'previous'))
		presets.win_min = key('Windows: front window', 'Front window: minimise', 'MINIMISE', act('window_minimise', { app: 'front', custom: '' }))
		for (let i = 1; i <= screenCount; i++) {
			presets[`win_screen_${i}`] = key('Windows: screens', `Front window: fill screen ${i}`, `FILL\\nSCREEN ${i}`, front('full', String(i)))
			presets[`win_screen_${i}_left`] = key('Windows: screens', `Front window: screen ${i}, left half`, `SCREEN ${i}\\nLEFT ½`, front('left', String(i)))
			presets[`win_screen_${i}_right`] = key('Windows: screens', `Front window: screen ${i}, right half`, `SCREEN ${i}\\nRIGHT ½`, front('right', String(i)))
		}
		presets.screens_refresh = key('Windows: screens', 'Refresh the screen list', 'SCREENS\\n' + v('screen_count'), act('screens_refresh'))

		// Layouts
		for (let i = 1; i <= LAYOUT_SLOTS; i++) {
			const saved = [{ feedbackId: 'layout_saved', options: { slot: String(i) }, style: { bgcolor: combineRgb(30, 70, 140), color: WHITE } }]
			presets[`layout_${i}`] = key('Window layouts', `Layout ${i}: put windows back`, `LAYOUT\\n${i}`, act('layout_restore', { slot: String(i), launch: false }), saved, '18')
			presets[`layout_${i}_save`] = key('Window layouts', `Layout ${i}: save where windows are now`, `SAVE\\nLAYOUT ${i}`, act('layout_save', { slot: String(i) }), saved)
		}
		presets.layout_written = key('Window layouts', 'Arrange apps from a written list (edit the action)', 'ARRANGE\\nAPPS', act('layout_apply', { layout: 'Safari, 1, left\nFinder, 1, right', launch: true }))

		// Show machine
		presets.keep_awake = key('Show machine', 'Keep awake (toggle)', 'KEEP\\nAWAKE', act('keep_awake', { mode: 'toggle', displays: true }), [{ feedbackId: 'keep_awake', options: {}, style: { bgcolor: AMBER, color: BLACK } }])
		presets.display_sleep = key('Show machine', 'Sleep the displays', 'SLEEP\\nSCREENS', act('display_sleep'))
		presets.lock = key('Show machine', 'Lock the screen', 'LOCK', act('lock_screen'), [], '18')
		presets.update_modules = key('Show machine', 'Put connections on their newest module versions', 'UPDATE\\nMODULES', act('update_modules'))
		presets.open_companion = key('Show machine', "Open Companion's admin page", 'OPEN\\nCOMPANION', act('open_companion', { page: '' }))
		presets.screen_saver = key('Show machine', 'Screen saver', 'SCREEN\\nSAVER', act('screen_saver'))
		presets.eject = key('Show machine', 'Eject all disks', 'EJECT\\nDISKS ⏏', act('eject_disks'))
		presets.dark_mode = key('Show machine', 'Dark mode (toggle)', 'DARK\\nMODE', act('dark_mode', { mode: 'toggle' }), [{ feedbackId: 'dark_mode', options: {}, style: { bgcolor: BLUE, color: WHITE } }])

		// Sound
		const mutedFb = [{ feedbackId: 'muted', options: {}, style: { bgcolor: combineRgb(200, 30, 30), color: WHITE } }]
		presets.volume_knob = {
			type: 'button',
			category: 'Sound',
			name: 'Volume knob (push = mute)',
			options: { rotaryActions: true },
			style: { text: `VOL\\n${v('volume')}`, size: '14', color: WHITE, bgcolor: DARK, show_topbar: false },
			steps: [{ down: act('mute', { mode: 'toggle' }), up: [], rotate_left: act('volume_step', { direction: 'down', size: 2 }), rotate_right: act('volume_step', { direction: 'up', size: 2 }) }],
			feedbacks: mutedFb,
		}
		presets.mic_knob = {
			type: 'button',
			category: 'Sound',
			name: 'Microphone level knob',
			options: { rotaryActions: true },
			style: { text: `MIC\\n${v('input_volume')}`, size: '14', color: WHITE, bgcolor: DARK, show_topbar: false },
			steps: [{ down: [], up: [], rotate_left: act('input_step', { direction: 'down', size: 2 }), rotate_right: act('input_step', { direction: 'up', size: 2 }) }],
			feedbacks: [],
		}
		presets.mute = key('Sound', 'Mute (toggle)', 'MUTE', act('mute', { mode: 'toggle' }), mutedFb, '18')

		// Desktop
		presets.mission = key('Desktop', 'Mission Control', 'MISSION\\nCONTROL', act('mission_control', { view: 'mission' }))
		presets.show_desktop = key('Desktop', 'Show desktop', 'SHOW\\nDESKTOP', act('mission_control', { view: 'desktop' }))
		presets.app_windows = key('Desktop', "Front app's windows", 'APP\\nWINDOWS', act('mission_control', { view: 'app' }))
		presets.space_left = key('Desktop', 'Desktop to the left', '◀\\nDESKTOP', act('space', { direction: 'left' }))
		presets.space_right = key('Desktop', 'Desktop to the right', 'DESKTOP\\n▶', act('space', { direction: 'right' }))
		presets.hide_others = key('Desktop', 'Hide all apps but the front one', 'HIDE\\nOTHERS', act('hide_others', { app: 'front', custom: '' }))
		presets.show_all = key('Desktop', 'Show all hidden apps', 'SHOW\\nALL', act('show_all'))

		// Keys and text
		const keys = (k, mods) => Object.fromEntries([['key', k], ...['command', 'option', 'control', 'shift'].map((m) => [m, mods.includes(m)]), ['target', '']])
		presets.key_screenshot = key('Keys and text', 'Screenshot of an area (⇧⌘4)', 'SCREEN-\\nSHOT', act('send_keys', keys('4', ['command', 'shift'])))
		presets.key_spotlight = key('Keys and text', 'Spotlight (⌘Space)', 'SPOT-\\nLIGHT', act('send_keys', keys('space', ['command'])))
		presets.key_copy = key('Keys and text', 'Copy (⌘C)', 'COPY', act('send_keys', keys('c', ['command'])), [], '18')
		presets.key_paste = key('Keys and text', 'Paste (⌘V)', 'PASTE', act('send_keys', keys('v', ['command'])), [], '18')
		presets.key_undo = key('Keys and text', 'Undo (⌘Z)', 'UNDO', act('send_keys', keys('z', ['command'])), [], '18')
		presets.key_custom = key('Keys and text', 'Any shortcut (edit the action)', 'SHORT-\\nCUT', act('send_keys', keys('space', ['command'])))
		presets.paste_text = key('Keys and text', 'Paste saved text (edit the action)', 'PASTE\\nTEXT', act('paste_text', { text: 'Hello from Companion', target: '', restore: false }))

		// Magnet
		for (const [id, m] of Object.entries(MAGNET)) {
			presets[`magnet_${id}`] = key('Magnet (needs Magnet)', `Magnet: ${m.label}`, `MAGNET\\n${short(m.label.toUpperCase(), 12)}`, act('magnet', { move: id }), [], 'auto')
		}

		// Shortcuts app
		this.shortcuts.slice(0, 48).forEach((name, i) => {
			presets[`shortcut_${i}`] = key('Shortcuts app', name, short(name, 18), act('run_shortcut', { name }), [], 'auto')
		})
		presets.shortcuts_refresh = key('Shortcuts app', 'Refresh the shortcut list', 'REFRESH\\nSHORTCUTS', act('refresh_shortcuts'))

		// Your Dock: one key per Dock position, showing that app's name, green while it runs
		for (let i = 1; i <= DOCK_SLOTS; i++) {
			presets[`dock_${i}`] = {
				type: 'button',
				category: 'Your Dock',
				name: this.dock[i - 1] ? `Dock ${i}: ${this.dock[i - 1].name}` : `Dock app ${i}`,
				style: icons
					? { text: v(`dock_${i}_short`), size: '14', alignment: 'center:bottom', color: WHITE, bgcolor: GREY, show_topbar: false }
					: { text: v(`dock_${i}`), size: 'auto', color: WHITE, bgcolor: GREY, show_topbar: false },
				steps: [{ down: act('dock_launch', { slot: String(i) }), up: [] }],
				feedbacks: [
					...(icons ? [{ feedbackId: 'dock_icon', options: { slot: String(i) } }] : []),
					{ feedbackId: 'dock_running', options: { slot: String(i) }, style: { bgcolor: GREEN, color: WHITE } },
				],
			}
		}
		// Bluetooth: one key per paired device, blue while connected
		this.btDevices.slice(0, 24).forEach((d) => {
			presets[`bt_${d.address.replace(/[^a-f0-9]/g, '')}`] = key('Bluetooth', `Connect / disconnect ${d.name}`, short(d.name, 18), act('bluetooth', { device: d.address, mode: 'toggle' }), [
				{ feedbackId: 'bt_connected', options: { device: d.address }, style: { bgcolor: BLUE, color: WHITE } },
			], 'auto')
		})
		presets.refresh_bluetooth = key('Bluetooth', 'Re-read the paired devices', 'RE-READ\\nBLUETOOTH', act('refresh_bluetooth'))

		presets.refresh_dock = key('Your Dock', 'Re-read the Dock', 'RE-READ\\nDOCK', act('refresh_dock'))

		// Apps
		presets.rescan = key('Apps: tools', 'Rescan apps', 'RESCAN\\nAPPS', act('rescan'))
		for (const app of this.apps) {
			presets[`app_${app.id}`] = {
				type: 'button',
				category: `Apps ${groupFor(app.name)}`,
				name: app.name,
				style: icons
					? { text: shortName(app.name), size: '14', alignment: 'center:bottom', color: WHITE, bgcolor: GREY, show_topbar: false }
					: { text: app.name, size: 'auto', color: WHITE, bgcolor: GREY },
				steps: [{ down: act('launch', { app: app.id, custom: '' }), up: [] }],
				feedbacks: [
					...(icons ? [{ feedbackId: 'app_icon', options: { app: app.id } }] : []),
					{ feedbackId: 'app_running', options: { app: app.id }, style: { bgcolor: GREEN, color: WHITE } },
				],
			}
		}
		return presets
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'What this does',
				value:
					'Apps (Mac and Windows): one key per installed app, green while running. Mac: move and resize windows across screens and save window layouts, keep awake, sound, dark mode, lock, eject, Mission Control, keyboard shortcuts, saved text and your Shortcuts. Window moving and keyboard shortcuts need Companion allowed under System Settings → Privacy &amp; Security → <b>Accessibility</b>.',
			},
			{ type: 'checkbox', id: 'includeSystem', label: 'Mac: include built-in apps (Safari, Notes, System Settings…)', width: 6, default: false },
			{ type: 'checkbox', id: 'icons', label: 'Mac: show app icons on app keys', width: 6, default: true },
			{
				type: 'static-text',
				id: 'update_info',
				width: 12,
				label: 'Auto-update module versions',
				value:
					'After you import a new bundle, this moves your connections onto the new versions by itself (checked every minute). Companion can\'t do this for imported modules on its own. Once: Companion → <b>Settings → REST API</b> → switch it on → <b>Add API key</b> with the <b>connections</b> and <b>write</b> scopes → paste the key below.',
			},
			{ type: 'checkbox', id: 'autoUpdate', label: 'Auto-update module versions', width: 4, default: true },
			{ type: 'checkbox', id: 'updateAll', label: 'Also other imported modules (not just companion-tools)', width: 8, default: false },
			{ type: 'secret-text', id: 'apiKey', label: 'Companion API key', width: 12, default: '' },
			{ type: 'number', id: 'pollSeconds', label: 'Check which apps are running every (seconds, 0 = off)', width: 6, default: 3, min: 0, max: 60 },
			{ type: 'textinput', id: 'extraFolders', label: 'Mac: extra folders to search for apps (one per line)', width: 12, default: '', multiline: true },
		]
	}
}

runEntrypoint(SystemToolsInstance, [])
