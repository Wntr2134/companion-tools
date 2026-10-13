import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base'
import { Monitor, parseDevices } from './monitor.js'

const GREEN = combineRgb(0, 150, 0)
const RED = combineRgb(200, 0, 0)
const GREY = combineRgb(60, 60, 60)
const WHITE = combineRgb(255, 255, 255)

const EXAMPLE = `# One device per line: Name, IP[, TCP port]
# With a port it checks that port (best for devices that ignore ping).
FOH SD9, 192.168.1.100
Stage rack, 192.168.1.101
Amp rack, 192.168.1.50, 80
PTZ cam 1, 192.168.0.42, 80`

const fmtAgo = (ms) => {
	const s = Math.round(ms / 1000)
	if (s < 60) return `${s}s`
	const m = Math.floor(s / 60)
	if (m < 60) return `${m}m`
	return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

class ShowHealthInstance extends InstanceBase {
	async init(config) {
		this.config = config
		this.monitor = new Monitor()
		this.monitor.on('change', () => {
			const s = this.monitor.summary()
			if (s.down) this.log('warn', `DOWN: ${s.downNames.join(', ')}`)
			else this.log('info', 'All devices up')
			this.checkFeedbacks()
		})
		this.monitor.on('update', () => this.#publish())
		this.#apply()
	}

	async configUpdated(config) {
		this.config = config
		this.#apply()
	}

	async destroy() {
		this.monitor?.stop()
	}

	#apply() {
		const devices = parseDevices(this.config.devices ?? EXAMPLE)
		this.monitor.intervalMs = Math.max(1, Number(this.config.interval) || 5) * 1000
		this.monitor.timeoutMs = Math.max(200, Number(this.config.timeout) || 1000)
		this.monitor.failuresToDown = Math.max(1, Number(this.config.failures) || 2)
		this.monitor.setDevices(devices)
		this.#definitions(devices)
		if (devices.length) {
			this.updateStatus(InstanceStatus.Ok)
			this.monitor.start()
		} else {
			this.monitor.stop()
			this.updateStatus(InstanceStatus.BadConfig, 'Add some devices in the settings')
		}
	}

	#definitions(devices) {
		const choices = devices.map((d) => ({ id: d.id, label: `${d.name} (${d.host}${d.port ? ':' + d.port : ''})` }))
		const deviceOption = { type: 'dropdown', id: 'device', label: 'Device', default: choices[0]?.id ?? '', choices }

		this.setFeedbackDefinitions({
			device_down: {
				type: 'boolean',
				name: 'Device is DOWN',
				defaultStyle: { bgcolor: RED, color: WHITE },
				options: [deviceOption],
				callback: (fb) => this.monitor.state.get(fb.options.device)?.status === 'down',
			},
			device_up: {
				type: 'boolean',
				name: 'Device is UP',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [deviceOption],
				callback: (fb) => this.monitor.state.get(fb.options.device)?.status === 'up',
			},
			all_ok: {
				type: 'boolean',
				name: 'Every device is UP',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [],
				callback: () => this.monitor.summary().allOk,
			},
			any_down: {
				type: 'boolean',
				name: 'Any device is DOWN',
				defaultStyle: { bgcolor: RED, color: WHITE },
				options: [],
				callback: () => this.monitor.summary().down > 0,
			},
		})

		this.setActionDefinitions({
			check_now: {
				name: 'Check every device now',
				options: [],
				callback: async () => {
					await this.monitor.checkAll()
				},
			},
		})

		const vars = [
			{ variableId: 'summary', name: 'Summary, e.g. "ALL OK" or "2 DOWN"' },
			{ variableId: 'down_count', name: 'Number of devices down' },
			{ variableId: 'down_list', name: 'Names of devices down' },
		]
		for (const d of devices) {
			vars.push({ variableId: `${d.id}_status`, name: `${d.name} status (UP/DOWN/…)` })
			vars.push({ variableId: `${d.id}_ms`, name: `${d.name} response time (ms)` })
			vars.push({ variableId: `${d.id}_for`, name: `${d.name} time in current state` })
		}
		this.setVariableDefinitions(vars)

		const label = this.label || 'show-health'
		const presets = {
			all_ok: {
				type: 'button',
				category: 'Summary',
				name: 'ALL OK / n DOWN',
				style: { text: `$(${label}:summary)`, size: '18', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'check_now', options: {} }], up: [] }],
				feedbacks: [
					{ feedbackId: 'all_ok', options: {}, style: { bgcolor: GREEN, color: WHITE } },
					{ feedbackId: 'any_down', options: {}, style: { bgcolor: RED, color: WHITE } },
				],
			},
		}
		for (const d of devices) {
			presets[`dev_${d.id}`] = {
				type: 'button',
				category: 'Devices',
				name: d.name,
				style: { text: `${d.name}\\n$(${label}:${d.id}_status)`, size: '14', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'check_now', options: {} }], up: [] }],
				feedbacks: [
					{ feedbackId: 'device_up', options: { device: d.id }, style: { bgcolor: GREEN, color: WHITE } },
					{ feedbackId: 'device_down', options: { device: d.id }, style: { bgcolor: RED, color: WHITE } },
				],
			}
		}
		this.setPresetDefinitions(presets)
		this.#publish()
	}

	#publish() {
		const s = this.monitor.summary()
		const values = {
			summary: s.total === 0 ? 'NO DEVICES' : s.down ? `${s.down} DOWN` : s.allOk ? 'ALL OK' : 'CHECKING',
			down_count: s.down,
			down_list: s.downNames.join(', '),
		}
		const now = Date.now()
		for (const d of this.monitor.devices) {
			const st = this.monitor.state.get(d.id)
			values[`${d.id}_status`] = st?.status === 'up' ? 'UP' : st?.status === 'down' ? 'DOWN' : '…'
			values[`${d.id}_ms`] = st?.latency ?? ''
			values[`${d.id}_for`] = st ? fmtAgo(now - st.since) : ''
		}
		this.setVariableValues(values)
		this.checkFeedbacks()
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Devices',
				value:
					'One device per line: <b>Name, IP</b> (ping) or <b>Name, IP, port</b> (checks that TCP port, best for gear that ignores ping). Lines starting with # are ignored.',
			},
			{ type: 'textinput', id: 'devices', label: 'Device list', width: 12, default: EXAMPLE, multiline: true },
			{ type: 'number', id: 'interval', label: 'Check every (seconds)', width: 4, default: 5, min: 1, max: 300 },
			{ type: 'number', id: 'timeout', label: 'Timeout per check (ms)', width: 4, default: 1000, min: 200, max: 10000 },
			{
				type: 'number',
				id: 'failures',
				label: 'Misses in a row before DOWN',
				width: 4,
				default: 2,
				min: 1,
				max: 10,
				tooltip: 'Stops one dropped ping flashing a device red.',
			},
		]
	}
}

runEntrypoint(ShowHealthInstance, [])
