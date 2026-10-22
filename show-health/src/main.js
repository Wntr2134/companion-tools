import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base'
import { Monitor, parseDevices } from './monitor.js'
import { getViewerPresets } from './viewers.js'
import { parseWatchList, connectionTemplates, connectionState, everything } from './connections.js'

const GREEN = combineRgb(0, 150, 0)
const RED = combineRgb(200, 0, 0)
const GREY = combineRgb(60, 60, 60)
const AMBER = combineRgb(200, 130, 0)
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
		this.conns = connectionState({}, [])
		this.#apply()
	}

	/** Reads Companion's own connection states (errors, warnings, and the named ones). */
	async #readConnections() {
		if (this.config.watchConnections === false) return
		const watch = parseWatchList(this.config.connections)
		const values = {}
		try {
			for (const [key, template] of connectionTemplates(watch)) values[key] = await this.parseVariablesInString(template)
		} catch (e) {
			this.log('debug', `Connection states: ${e.message}`)
			return
		}
		const before = JSON.stringify(this.conns)
		this.conns = connectionState(values, watch, { warningsCount: this.config.warningsCount === true })
		if (this.conns.named.unknown.length && !this.warnedUnknown) {
			this.warnedUnknown = true
			this.log('warn', `No connection called: ${this.conns.named.unknown.join(', ')} (check the names in the settings: they must match the connection's label exactly)`)
		}
		if (JSON.stringify(this.conns) !== before) this.#publish()
	}

	async configUpdated(config) {
		this.config = config
		this.#apply()
	}

	async destroy() {
		this.monitor?.stop()
		clearInterval(this.connTimer)
	}

	#apply() {
		const devices = parseDevices(this.config.devices ?? EXAMPLE)
		this.monitor.intervalMs = Math.max(1, Number(this.config.interval) || 5) * 1000
		this.monitor.timeoutMs = Math.max(200, Number(this.config.timeout) || 1000)
		this.monitor.failuresToDown = Math.max(1, Number(this.config.failures) || 2)
		this.monitor.setDevices(devices)
		this.#definitions(devices)
		const watching = this.config.watchConnections !== false
		clearInterval(this.connTimer)
		this.warnedUnknown = false
		if (watching) {
			this.connTimer = setInterval(() => void this.#readConnections(), this.monitor.intervalMs)
			void this.#readConnections()
		}
		if (devices.length) {
			this.updateStatus(InstanceStatus.Ok)
			this.monitor.start()
		} else {
			this.monitor.stop()
			if (watching) this.updateStatus(InstanceStatus.Ok, 'Watching connections only')
			else this.updateStatus(InstanceStatus.BadConfig, 'Add some devices in the settings')
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
			everything_ok: {
				type: 'boolean',
				name: 'Everything OK (devices up, no connection errors)',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [],
				callback: () => this.#everything().ok,
			},
			anything_wrong: {
				type: 'boolean',
				name: 'Anything wrong (a device down or a connection error)',
				defaultStyle: { bgcolor: RED, color: WHITE },
				options: [],
				callback: () => this.#everything().problems > 0,
			},
			connection_warning: {
				type: 'boolean',
				name: 'A Companion connection has a warning',
				defaultStyle: { bgcolor: AMBER, color: WHITE },
				options: [],
				callback: () => this.conns.warnings > 0,
			},
		})

		this.setActionDefinitions({
			check_now: {
				name: 'Check every device now',
				options: [],
				callback: async () => {
					await Promise.all([this.monitor.checkAll(), this.#readConnections()])
				},
			},
		})

		const vars = [
			{ variableId: 'summary', name: 'Summary, e.g. "ALL OK" or "2 DOWN"' },
			{ variableId: 'down_count', name: 'Number of devices down' },
			{ variableId: 'down_list', name: 'Names of devices down' },
			{ variableId: 'everything', name: 'Devices and connections: "ALL OK" or "2 PROBLEMS"' },
			{ variableId: 'everything_list', name: "What's wrong, e.g. \"FOH SD9 down · digico error\"" },
			{ variableId: 'conn_errors', name: 'Companion connections with errors' },
			{ variableId: 'conn_warnings', name: 'Companion connections with warnings' },
			{ variableId: 'conn_total', name: 'Companion connections' },
		]
		for (const d of devices) {
			vars.push({ variableId: `${d.id}_status`, name: `${d.name} status (UP/DOWN/…)` })
			vars.push({ variableId: `${d.id}_ms`, name: `${d.name} response time (ms)` })
			vars.push({ variableId: `${d.id}_for`, name: `${d.name} time in current state` })
		}
		this.setVariableDefinitions(vars)

		const label = this.label || 'show-health'
		const presets = {
			everything: {
				type: 'button',
				category: 'Summary',
				name: 'Everything OK? (devices and connections)',
				style: { text: `$(${label}:everything)`, size: 'auto', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'check_now', options: {} }], up: [] }],
				feedbacks: [
					{ feedbackId: 'everything_ok', options: {}, style: { bgcolor: GREEN, color: WHITE } },
					{ feedbackId: 'anything_wrong', options: {}, style: { bgcolor: RED, color: WHITE } },
				],
			},
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
		this.setPresetDefinitions({ ...presets, ...getViewerPresets(this) })
		this.#publish()
	}

	#everything() {
		return everything(this.monitor.summary(), this.conns, { warningsCount: this.config.warningsCount === true })
	}

	#publish() {
		const s = this.monitor.summary()
		const values = {
			summary: s.total === 0 ? 'NO DEVICES' : s.down ? `${s.down} DOWN` : s.allOk ? 'ALL OK' : 'CHECKING',
			down_count: s.down,
			down_list: s.downNames.join(', '),
		}
		const e = this.#everything()
		Object.assign(values, {
			everything: e.summary,
			everything_list: e.list,
			conn_errors: this.conns.errors,
			conn_warnings: this.conns.warnings,
			conn_total: this.conns.total ?? '',
		})
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
			{
				type: 'static-text',
				id: 'conn_info',
				width: 12,
				label: 'Companion connections',
				value:
					'The <b>Everything OK?</b> key also goes red when any Companion connection (console, cameras, lighting…) shows an error. List connection names below to see <i>which</i> one in the "what\'s wrong" text: use each connection\'s label exactly as it is on the Connections page.',
			},
			{ type: 'checkbox', id: 'watchConnections', label: 'Include Companion connections', width: 4, default: true },
			{ type: 'checkbox', id: 'warningsCount', label: 'Count connection warnings as problems', width: 4, default: false, tooltip: 'Off: warnings (e.g. "Spotify is not open") only turn the warning feedback amber.' },
			{ type: 'textinput', id: 'connections', label: 'Connections to name (one label per line)', width: 12, default: '', multiline: true },
		]
	}
}

runEntrypoint(ShowHealthInstance, [])
