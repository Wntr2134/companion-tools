import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { getViewerPresets } from './viewers.js'
import { EchoClient, DEFAULT_PORT, DEFAULT_POLL_MS } from './echo-client.js'
import { UCKeys, UC_DEFAULT_APP } from './uc-keys.js'
import { isUC, DEFAULT_MINUTES, DEFAULT_TITLE, getActions, getFeedbacks, getPresets, getVariableDefinitions, getVariableValues } from './controls.js'

const STATUS = {
	ok: InstanceStatus.Ok,
	connecting: InstanceStatus.Connecting,
	bad_config: InstanceStatus.BadConfig,
	connection_failure: InstanceStatus.ConnectionFailure,
	unknown_warning: InstanceStatus.UnknownWarning,
}

const UC_VISIBLE = `$(options:device) == 'uc'`
const DEVICE_VISIBLE = `$(options:device) != 'uc'`

// Feedbacks that change with the clock rather than with a poll.
const TICKING = ['paused', 'remaining_below', 'error', 'next_within']

class Echo360Instance extends InstanceBase {
	async init(config) {
		this.config = config
		this.blinkOn = true
		this.client = new EchoClient()
		this.client.on('log', (level, msg) => this.log(level, msg))
		this.uc = new UCKeys({ log: (level, msg) => this.log(level, msg) })
		this.client.on('status', (status, message) => {
			if (!isUC(this)) this.updateStatus(STATUS[status] ?? InstanceStatus.UnknownWarning, message ?? null)
		})
		this.client.on('change', () => this.#refresh())
		this.client.on('system', () => {
			const profiles = JSON.stringify(this.client.system?.profiles ?? [])
			if (profiles !== this.lastProfiles) {
				this.lastProfiles = profiles
				this.setActionDefinitions(getActions(this)) // refresh the profile dropdown
			}
		})
		this.#rebuild()
		this.#connect()
		// Tick once a second: the elapsed/remaining timers run locally between polls, and flashing feedbacks blink.
		this.ticker = setInterval(() => {
			this.blinkOn = !this.blinkOn
			this.#refresh(TICKING)
		}, 1000)
	}

	async destroy() {
		clearInterval(this.ticker)
		this.client?.stop()
	}

	async configUpdated(config) {
		const keys = ['device', 'host', 'protocol', 'port', 'username', 'password', 'pollMs', 'legacyTls']
		const reconnect = keys.some((k) => config[k] !== this.config[k])
		this.config = config
		if (reconnect) this.#connect()
		this.#refresh()
	}

	#connect() {
		const c = this.config
		if (isUC(this)) {
			// Keyboard shortcuts only: no device to poll, no login.
			this.client.stop()
			this.client.connected = false
			this.client.state = ''
			if (process.platform !== 'darwin' && process.platform !== 'win32') {
				this.updateStatus(InstanceStatus.BadConfig, 'Universal Capture shortcuts only work when Companion runs on a Mac or Windows PC')
			} else {
				this.updateStatus(InstanceStatus.Ok, 'Universal Capture keyboard shortcuts (no status)')
			}
			this.log('info', 'Universal Capture mode: sending keyboard shortcuts on this computer, no recording status available')
			return
		}
		this.client.configure({
			host: String(c.host ?? '').trim(),
			protocol: c.protocol === 'http' ? 'http' : 'https',
			port: c.port,
			username: c.username,
			password: c.password,
			pollMs: c.pollMs,
			legacyTls: c.legacyTls,
		})
		this.log('info', `Connecting to ${c.device === 'ucc' ? 'Universal Capture: Classroom' : 'capture device'} at ${c.protocol || 'https'}://${c.host}:${c.port}`)
		this.client.start()
	}

	#rebuild() {
		this.setActionDefinitions(getActions(this))
		this.setFeedbackDefinitions(getFeedbacks(this))
		this.setVariableDefinitions(getVariableDefinitions(this))
		this.setPresetDefinitions({ ...getPresets(this), ...getViewerPresets(this) })
		this.#refresh()
	}

	#refresh(feedbacks) {
		this.setVariableValues(getVariableValues(this))
		if (feedbacks) this.checkFeedbacks(...feedbacks)
		else this.checkFeedbacks()
	}

	getConfigFields() {
		const profiles = this.client?.system?.profiles ?? []
		return [
			{
				type: 'static-text',
				id: 'info',
				isVisibleExpression: DEVICE_VISIBLE,
				width: 12,
				label: 'About',
				value:
					'Controls an Echo360 capture appliance (Pro, Pod, SafeCapture HD) through its local Capture API. Ask your AV or IT team for the device address and the "Local Generic User Login" (Echo360 → Settings → Device Defaults). Don\'t use the admin login.',
			},
			{
				type: 'dropdown',
				id: 'device',
				label: 'Device type',
				width: 6,
				default: 'appliance',
				choices: [
					{ id: 'appliance', label: 'Echo360 Pro / Pod / SafeCapture HD (Capture API)' },
					{ id: 'ucc', label: 'Universal Capture: Classroom (Capture API, unconfirmed)' },
					{ id: 'uc', label: 'Universal Capture on this computer (keyboard shortcuts, no status)' },
				],
			},
			{ type: 'textinput', id: 'room', label: 'Room name (shown on buttons, optional)', width: 6, default: '' },
			{
				type: 'static-text',
				id: 'ucInfo',
				width: 12,
				label: 'Universal Capture mode',
				value:
					'Sends Universal Capture\'s own shortcuts (Cmd+6 / Ctrl+6 pause/resume, 8 finish, 1 extend, 4 open) on the computer running Companion: Cmd on a Mac, Ctrl on Windows. On a Mac, Companion needs Accessibility permission (System Settings → Privacy & Security → Accessibility). There is no start shortcut, and the shortcuts are toggles, so buttons show NO STATUS instead of a timer.',
				isVisibleExpression: UC_VISIBLE,
			},
			{
				type: 'textinput',
				id: 'ucApp',
				label: 'Universal Capture app name',
				width: 6,
				default: UC_DEFAULT_APP,
				isVisibleExpression: UC_VISIBLE,
			},
			{
				type: 'checkbox',
				id: 'ucActivate',
				label: 'Bring Universal Capture to the front before each shortcut',
				width: 6,
				default: true,
				isVisibleExpression: UC_VISIBLE,
			},
			{
				type: 'checkbox',
				id: 'ucReturn',
				label: 'Then go back to the app that was in front (e.g. the slides)',
				width: 6,
				default: true,
				isVisibleExpression: `${UC_VISIBLE} && $(options:ucActivate)`,
			},
			{ type: 'textinput', id: 'host', label: 'Device IP address or hostname', width: 6, default: '', isVisibleExpression: DEVICE_VISIBLE },
			{
				type: 'dropdown',
				id: 'protocol',
				isVisibleExpression: DEVICE_VISIBLE,
				label: 'Protocol',
				width: 3,
				default: 'https',
				choices: [
					{ id: 'https', label: 'https' },
					{ id: 'http', label: 'http' },
				],
			},
			{
				type: 'number',
				id: 'port',
				isVisibleExpression: DEVICE_VISIBLE,
				label: 'Port',
				width: 3,
				default: DEFAULT_PORT,
				min: 1,
				max: 65535,
				tooltip: 'Usually 8443 for https. Older units often use 8080 for http.',
			},
			{
				type: 'textinput',
				id: 'username',
				isVisibleExpression: DEVICE_VISIBLE,
				label: 'Username (the generic user, not admin)',
				width: 6,
				default: 'instructor',
			},
			{ type: 'secret-text', id: 'password', label: 'Password', width: 6, default: '', isVisibleExpression: DEVICE_VISIBLE },
			{
				type: 'number',
				id: 'pollMs',
				isVisibleExpression: DEVICE_VISIBLE,
				label: 'Check status every (ms)',
				width: 4,
				default: DEFAULT_POLL_MS,
				min: 1000,
				max: 10000,
			},
			{
				type: 'checkbox',
				id: 'legacyTls',
				isVisibleExpression: DEVICE_VISIBLE,
				label: 'Allow old TLS (only if an older unit won\'t connect over https)',
				width: 8,
				default: false,
			},
			{
				type: 'dropdown',
				id: 'profile',
				isVisibleExpression: DEVICE_VISIBLE,
				label: 'Default capture profile',
				width: 6,
				default: '',
				allowCustom: true,
				choices: [
					{ id: '', label: profiles.length ? `First on the device (${profiles[0]})` : 'First on the device (connect to see the list)' },
					...profiles.map((p) => ({ id: p, label: p })),
				],
			},
			{
				type: 'number',
				id: 'minutes',
				isVisibleExpression: DEVICE_VISIBLE,
				label: 'Default ad hoc length (minutes)',
				width: 3,
				default: DEFAULT_MINUTES,
				min: 1,
				max: 600,
			},
			{
				type: 'textinput',
				id: 'title',
				isVisibleExpression: DEVICE_VISIBLE,
				label: 'Default ad hoc title (variables allowed)',
				width: 12,
				default: DEFAULT_TITLE,
				useVariables: true,
			},
		]
	}
}

runEntrypoint(Echo360Instance, [])
