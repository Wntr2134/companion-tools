import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { UAClient, DEFAULT_PORT } from './ua-client.js'
import { getActions, getFeedbacks, getPresets, getVariableDefinitions, getVariableValues } from './controls.js'
import {
	applyMeters,
	getExtraActions,
	getExtraFeedbacks,
	getExtraPresets,
	getExtraVariableDefinitions,
	getExtraVariableValues,
	watchSelection,
} from './extras.js'

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
			for (const d of devices) this.log('info', `${d.name} talkback: ${d.talkback?.how ?? 'not found'}`)
			this.#rebuild()
			watchSelection(this)
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
		const reconnect = config.host !== this.config.host || config.port !== this.config.port
		this.config = config
		if (reconnect) this.#connect()
		else {
			this.#rebuild()
			applyMeters(this)
		}
	}

	/** Re-send variable values and feedbacks (e.g. after the selection changed). */
	refreshAll() {
		this.#refreshValues()
	}

	#connect() {
		this.updateStatus(InstanceStatus.Connecting)
		this.client.start(this.config.host || '127.0.0.1', this.config.port || DEFAULT_PORT)
	}

	#rebuild() {
		this.setActionDefinitions({ ...getActions(this), ...getExtraActions(this) })
		this.setFeedbackDefinitions({ ...getFeedbacks(this), ...getExtraFeedbacks(this) })
		this.setVariableDefinitions([...getVariableDefinitions(this), ...getExtraVariableDefinitions(this)])
		this.setPresetDefinitions({ ...getExtraPresets(this), ...getPresets(this) })
		this.#refreshValues()
	}

	// Value updates can arrive in bursts (a fader moving, meters): batch them.
	// Meters update many times a second, so refresh at most 10 times a second when they're on.
	#refreshValues() {
		if (this.refreshTimer) return
		const delay = (this.config?.meters ?? 'selected') === 'off' ? 30 : 100
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined
			this.setVariableValues({ ...getVariableValues(this), ...getExtraVariableValues(this) })
			this.checkFeedbacks()
		}, delay)
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
			{
				type: 'dropdown',
				id: 'meters',
				label: 'Level meters',
				width: 6,
				default: 'selected',
				choices: [
					{ id: 'off', label: 'Off' },
					{ id: 'selected', label: 'Selected channel only (recommended)' },
					{ id: 'active', label: 'Every channel in use (more network traffic)' },
				],
			},
		]
	}
}

runEntrypoint(UADConsoleInstance, [])
