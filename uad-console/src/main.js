import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { UAClient, DEFAULT_PORT } from './ua-client.js'
import { getActions, getFeedbacks, getPresets, getVariableDefinitions, getVariableValues } from './controls.js'

class UADConsoleInstance extends InstanceBase {
	async init(config) {
		this.config = config
		this.client = new UAClient()
		this.client.on('log', (level, msg) => this.log(level, msg))
		this.client.on('connected', () => {
			this.updateStatus(InstanceStatus.Ok)
			this.#refreshValues()
		})
		this.client.on('disconnected', () => {
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Not connected to UA Mixer Engine. Is UAD Console running?')
			this.#refreshValues()
		})
		this.client.on('devices', (devices) => {
			const count = devices.reduce((n, d) => n + d.channels.length, 0)
			this.log('info', `Found ${devices.length} device(s), ${count} channels`)
			this.#rebuild()
		})
		this.client.on('value', () => this.#refreshValues())
		this.#rebuild()
		this.#connect()
	}

	async destroy() {
		clearTimeout(this.refreshTimer)
		this.client?.stop()
	}

	async configUpdated(config) {
		this.config = config
		this.#connect()
	}

	#connect() {
		this.updateStatus(InstanceStatus.Connecting)
		this.client.start(this.config.host || '127.0.0.1', this.config.port || DEFAULT_PORT)
	}

	#rebuild() {
		this.setActionDefinitions(getActions(this))
		this.setFeedbackDefinitions(getFeedbacks(this))
		this.setVariableDefinitions(getVariableDefinitions(this))
		this.setPresetDefinitions(getPresets(this))
		this.#refreshValues()
	}

	// Value updates can arrive in bursts (e.g. a fader moving): batch them.
	#refreshValues() {
		if (this.refreshTimer) return
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined
			this.setVariableValues(getVariableValues(this))
			this.checkFeedbacks()
		}, 30)
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'About',
				value:
					'Talks to UA Mixer Engine, the background part of UAD Console. It starts with Console and keeps running after you close the Console window. Use 127.0.0.1 when Companion runs on the same Mac as the Apollo.',
			},
			{ type: 'textinput', id: 'host', label: 'Mac running UAD Console (IP)', width: 6, default: '127.0.0.1' },
			{ type: 'number', id: 'port', label: 'Port', width: 3, default: DEFAULT_PORT, min: 1, max: 65535 },
		]
	}
}

runEntrypoint(UADConsoleInstance, [])
