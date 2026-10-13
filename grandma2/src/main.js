import { InstanceBase, Regex, runEntrypoint } from '@companion-module/base'
import { overallStatus } from './status.js'
import { MA2Console, DEFAULT_EXECS, DEFAULT_FADER_TEMPLATE, DEFAULT_GM_TEMPLATE } from './console.js'
import { getActions } from './actions.js'
import { getFeedbacks } from './feedbacks.js'
import { getVariableDefinitions, getVariableValues } from './variables.js'
import { getPresets } from './presets.js'
import { UpgradeScripts } from './upgrades.js'

class GrandMA2Instance extends InstanceBase {
	async init(config) {
		this.config = config
		this.ma = new MA2Console()
		this.ma.on('log', (level, msg) => this.log(level, msg))
		this.ma.on('status', () => {
			this.#status()
			this.#refresh()
		})
		this.ma.on('change', () => this.#refresh())
		this.ma.on('line', () => this.#refresh())
		this.ma.configure(config)
		this.#rebuild()
		this.#status()
	}

	async destroy() {
		this.destroyed = true
		this.ma?.removeAllListeners()
		this.ma?.stop()
		clearTimeout(this.refreshTimer)
		this.refreshTimer = undefined
	}

	async configUpdated(config) {
		this.config = config
		const before = this.ma.execs.join(',')
		this.ma.configure(config)
		if (this.ma.execs.join(',') !== before) this.#rebuild()
		this.#status()
	}

	#status() {
		const [status, message] = overallStatus(this.ma.telnet, this.ma.wr, this.ma.config.webRemote)
		if (status === this.lastStatus && message === this.lastMessage) return
		this.lastStatus = status
		this.lastMessage = message
		this.updateStatus(status, message)
	}

	#rebuild() {
		this.setActionDefinitions(getActions(this))
		this.setFeedbackDefinitions(getFeedbacks(this))
		this.setVariableDefinitions(getVariableDefinitions(this))
		this.setPresetDefinitions(getPresets(this))
		this.#refresh()
	}

	// Polls arrive 4 times a second and knob clicks faster than that: batch the updates.
	#refresh() {
		if (this.refreshTimer || this.destroyed) return
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined
			this.setVariableValues(getVariableValues(this))
			this.checkFeedbacks()
		}, 40)
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Console setup',
				value:
					'On the console or onPC: Setup → Console → Global Settings. Set Telnet to "Login Enabled". For readback (names, levels, cues), also set Remotes to "Login Enabled" and make a separate user with a password for it (the Web Remote refuses Administrator). See the module help.',
			},
			{ type: 'textinput', id: 'host', label: 'Console / onPC IP', width: 8, default: '192.168.0.1', regex: Regex.IP },
			{ type: 'number', id: 'telnet_port', label: 'Telnet port', width: 4, default: 30000, min: 1, max: 65535 },
			{ type: 'checkbox', id: 'login', label: 'Log in on Telnet', width: 4, default: true },
			{ type: 'textinput', id: 'user', label: 'Telnet user', width: 4, default: 'administrator', isVisible: (c) => c.login !== false },
			{ type: 'textinput', id: 'pass', label: 'Telnet password', width: 4, default: 'admin', isVisible: (c) => c.login !== false },
			{
				type: 'number',
				id: 'spacing_ms',
				label: 'Gap between commands (ms)',
				width: 4,
				default: 50,
				min: 0,
				max: 1000,
				tooltip: 'Commands go out one at a time with this gap. Fader moves are merged: only the newest value is sent.',
			},
			{ type: 'number', id: 'heartbeat_s', label: 'Check the console every (s)', width: 4, default: 10, min: 2, max: 120 },

			{
				type: 'static-text',
				id: 'wr_info',
				width: 12,
				label: 'Web Remote (optional readback)',
				value: 'Executor names, fader levels, running state and cue names. Without it, the module still sends every command, and shows only what it sent.',
			},
			{ type: 'checkbox', id: 'wr_enable', label: 'Use the Web Remote', width: 4, default: false },
			{ type: 'textinput', id: 'wr_user', label: 'Web Remote user (not Administrator)', width: 4, default: 'companion', isVisible: (c) => !!c.wr_enable },
			{ type: 'textinput', id: 'wr_pass', label: 'Web Remote password', width: 4, default: '', isVisible: (c) => !!c.wr_enable },
			{ type: 'number', id: 'wr_port', label: 'Web Remote port', width: 4, default: 80, min: 1, max: 65535, isVisible: (c) => !!c.wr_enable },
			{ type: 'number', id: 'poll_ms', label: 'Read back every (ms)', width: 4, default: 250, min: 100, max: 5000, isVisible: (c) => !!c.wr_enable },
			{
				type: 'dropdown',
				id: 'fader_via',
				label: 'Send fader moves by',
				width: 4,
				default: 'auto',
				choices: [
					{ id: 'auto', label: 'Web Remote when connected, else Telnet' },
					{ id: 'telnet', label: 'Telnet only' },
				],
				isVisible: (c) => !!c.wr_enable,
			},

			{
				type: 'static-text',
				id: 'exec_info',
				width: 12,
				label: 'Executors',
				value: 'Which executors get variables, presets and readback, and which the "next / previous executor" actions step through.',
			},
			{ type: 'number', id: 'page', label: 'Start page', width: 4, default: 1, min: 1, max: 9999 },
			{ type: 'textinput', id: 'execs', label: 'Executors (e.g. 1-15, 101-105)', width: 8, default: DEFAULT_EXECS },
			{ type: 'checkbox', id: 'select_follow', label: 'Selecting an executor here also selects it on the console', width: 12, default: false },

			{
				type: 'static-text',
				id: 'adv_info',
				width: 12,
				label: 'Advanced',
				value: 'Command templates: {page}, {exec} and {level} are filled in. Change these only if the console rejects the defaults.',
			},
			{ type: 'textinput', id: 'fader_template', label: 'Fader command (Telnet)', width: 6, default: DEFAULT_FADER_TEMPLATE },
			{
				type: 'textinput',
				id: 'heartbeat_cmd',
				label: 'Heartbeat command (blank = just Enter)',
				width: 6,
				default: '',
				tooltip: 'Sent every check while idle. It must be harmless and make the console answer.',
			},
			{ type: 'textinput', id: 'gm_template', label: 'Grand master command', width: 6, default: DEFAULT_GM_TEMPLATE },
		]
	}
}

runEntrypoint(GrandMA2Instance, UpgradeScripts)
