import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb, Regex } from '@companion-module/base'
import { StudioMonitorClient, AuthError } from './client.js'

const GREEN = combineRgb(0, 140, 60)
const RED = combineRgb(200, 0, 0)
const BLUE = combineRgb(0, 80, 160)
const GREY = combineRgb(40, 40, 40)
const WHITE = combineRgb(255, 255, 255)

/** "STUDIO-PC (Cam 1)" -> { machine, name } */
export function splitName(full) {
	const m = /^(.*?) \((.*)\)$/.exec(String(full ?? ''))
	return m ? { machine: m[1], name: m[2] } : { machine: '', name: String(full ?? '') }
}
const shortName = (full) => (full ? splitName(full).name : 'None')

class StudioMonitorInstance extends InstanceBase {
	state = { source: '', overlay: '', pip: true, muted: false, recording: false, duration: '' }
	sources = []
	timers = []
	failures = 0
	busy = false

	async init(config) {
		this.config = config
		this.updateDefinitions()
		this.start()
	}

	async configUpdated(config) {
		this.config = config
		this.stop()
		this.start()
	}

	async destroy() {
		this.stop()
	}

	start() {
		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Enter the IP of the PC running Studio Monitor')
			return
		}
		this.client = new StudioMonitorClient({
			host: this.config.host,
			port: Number(this.config.port) || 80,
			user: this.config.user ?? 'admin',
			pass: this.config.pass ?? 'admin',
		})
		this.updateStatus(InstanceStatus.Connecting)
		this.timers.push(setInterval(() => void this.pollState(), 1000))
		this.timers.push(setInterval(() => void this.pollSources(), 3000))
		void this.pollSources().then(() => this.pollState())
	}

	stop() {
		for (const t of this.timers) clearInterval(t)
		this.timers = []
		this.client = null
	}

	failed(e) {
		this.failures++
		if (e instanceof AuthError) this.updateStatus(InstanceStatus.AuthenticationFailure, e.message)
		else if (this.failures >= 3) this.updateStatus(InstanceStatus.Disconnected, 'No reply: is Studio Monitor open with web control on?')
		if (this.failures === 3 || e instanceof AuthError) this.log('warn', `Studio Monitor: ${e.message}`)
	}

	ok() {
		if (this.failures !== 0 || !this.connected) this.updateStatus(InstanceStatus.Ok)
		this.failures = 0
		this.connected = true
	}

	async pollSources() {
		if (!this.client) return
		try {
			const list = (await this.client.sources()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
			this.ok()
			if (list.length !== this.sources.length || list.some((s, i) => s !== this.sources[i])) {
				this.sources = list
				this.updateDefinitions()
				this.setVariableValues({ source_count: list.length })
			}
		} catch (e) {
			this.failed(e)
		}
	}

	async pollState() {
		if (!this.client || this.busy) return
		this.busy = true
		try {
			const [cfg, rec] = await Promise.all([this.client.configuration(), this.client.recording().catch(() => null)])
			this.ok()
			const s = this.state
			if (cfg && typeof cfg === 'object') {
				if (typeof cfg.NDI_source === 'string') s.source = cfg.NDI_source
				if (typeof cfg.NDI_overlay === 'string') s.overlay = cfg.NDI_overlay
				if (typeof cfg.decorations?.picture_in_picture === 'boolean') s.pip = cfg.decorations.picture_in_picture
				if (typeof cfg.decorations?.mute_audio === 'boolean') s.muted = cfg.decorations.mute_audio
			}
			if (rec && typeof rec === 'object') {
				if (typeof rec.recording === 'boolean') s.recording = rec.recording
				s.duration = formatDuration(rec.duration)
			}
			this.publish()
		} catch (e) {
			this.failed(e)
		} finally {
			this.busy = false
		}
	}

	publish() {
		const s = this.state
		this.setVariableValues({
			source: shortName(s.source),
			source_full: s.source,
			overlay: s.overlay ? shortName(s.overlay) : 'None',
			overlay_mode: s.overlay ? (s.pip ? 'PiP' : 'Alpha') : '',
			audio_muted: s.muted ? 'MUTED' : '',
			recording: s.recording ? 'REC' : '',
			rec_time: s.duration,
		})
		this.checkFeedbacks()
	}

	/** Send a change, update our copy at once (the next poll confirms it). */
	async apply(changes, local) {
		if (!this.client) return
		try {
			await this.client.setConfiguration(changes)
			Object.assign(this.state, local)
			this.publish()
		} catch (e) {
			this.log('error', `Studio Monitor didn't take the change: ${e.message}`)
		}
	}

	async pickSource(options, context) {
		if (options.source !== 'custom') return options.source
		return (await context.parseVariablesInString(String(options.custom ?? ''))).trim()
	}

	updateDefinitions() {
		const known = [...new Set([...this.sources, this.state.source, this.state.overlay].filter(Boolean))]
		const choices = [
			{ id: '', label: 'None (black)' },
			...known.map((s) => ({ id: s, label: `${splitName(s).name} (${splitName(s).machine})` })),
			{ id: 'custom', label: '(Type the source name below)' },
		]
		const sourceOption = { type: 'dropdown', id: 'source', label: 'NDI source', default: choices[1]?.id ?? '', choices, allowCustom: true }
		const customOption = {
			type: 'textinput',
			id: 'custom',
			label: 'Full NDI name, e.g. STUDIO-PC (Cam 1). Variables allowed.',
			default: '',
			useVariables: true,
			isVisible: (o) => o.source === 'custom',
		}
		const modeOption = {
			type: 'dropdown',
			id: 'mode',
			label: 'Mode',
			default: 'toggle',
			choices: [
				{ id: 'toggle', label: 'Toggle' },
				{ id: 'on', label: 'On' },
				{ id: 'off', label: 'Off' },
			],
		}
		const want = (mode, current) => (mode === 'on' ? true : mode === 'off' ? false : !current)

		this.setActionDefinitions({
			source: {
				name: 'Show a source',
				options: [sourceOption, customOption],
				callback: async (a, ctx) => {
					const src = await this.pickSource(a.options, ctx)
					await this.apply({ NDI_source: src }, { source: src })
				},
			},
			overlay: {
				name: 'Overlay a source (PiP or alpha)',
				options: [
					sourceOption,
					customOption,
					{
						type: 'dropdown',
						id: 'kind',
						label: 'Overlay type',
						default: 'pip',
						choices: [
							{ id: 'pip', label: 'Picture in picture' },
							{ id: 'alpha', label: 'Alpha (keyed graphics)' },
						],
					},
				],
				callback: async (a, ctx) => {
					const src = await this.pickSource(a.options, ctx)
					const pip = a.options.kind !== 'alpha'
					await this.apply({ NDI_overlay: src, decorations: { picture_in_picture: pip } }, { overlay: src, pip })
				},
			},
			overlay_hide: {
				name: 'Hide the overlay',
				options: [],
				callback: async () => this.apply({ NDI_overlay: '' }, { overlay: '' }),
			},
			audio: {
				name: 'Audio mute',
				options: [modeOption],
				callback: async (a) => {
					const muted = want(a.options.mode, this.state.muted)
					await this.apply({ decorations: { mute_audio: muted } }, { muted })
				},
			},
			record: {
				name: 'Record (ISO to disk)',
				description: 'Records the main source. Studio Monitor only records while a source is showing.',
				options: [modeOption],
				callback: async (a) => {
					if (!this.client) return
					const on = want(a.options.mode, this.state.recording)
					try {
						await this.client.setRecording(on)
						this.state.recording = on
						this.publish()
					} catch (e) {
						this.log('error', `Recording change failed: ${e.message}`)
					}
				},
			},
			custom_json: {
				name: 'Advanced: send configuration JSON',
				options: [{ type: 'textinput', id: 'json', label: 'JSON (merged into the configuration)', default: '{"NDI_source": ""}', useVariables: true }],
				callback: async (a, ctx) => {
					let obj
					try {
						obj = JSON.parse(await ctx.parseVariablesInString(String(a.options.json ?? '')))
					} catch {
						this.log('error', 'That JSON is not valid')
						return
					}
					if (this.client) await this.client.setConfiguration(obj).catch((e) => this.log('error', e.message))
				},
			},
		})

		this.setFeedbackDefinitions({
			source_is: {
				type: 'boolean',
				name: 'Source is showing',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [sourceOption],
				callback: (fb) => this.state.source === fb.options.source,
			},
			overlay_is: {
				type: 'boolean',
				name: 'Source is the overlay',
				defaultStyle: { bgcolor: BLUE, color: WHITE },
				options: [sourceOption],
				callback: (fb) => !!this.state.overlay && this.state.overlay === fb.options.source,
			},
			recording: {
				type: 'boolean',
				name: 'Recording',
				defaultStyle: { bgcolor: RED, color: WHITE },
				options: [],
				callback: () => this.state.recording,
			},
			muted: {
				type: 'boolean',
				name: 'Audio muted',
				defaultStyle: { bgcolor: RED, color: WHITE },
				options: [],
				callback: () => this.state.muted,
			},
		})

		this.setVariableDefinitions([
			{ variableId: 'source', name: 'Source showing (short name)' },
			{ variableId: 'source_full', name: 'Source showing (full NDI name)' },
			{ variableId: 'overlay', name: 'Overlay source' },
			{ variableId: 'overlay_mode', name: 'Overlay type (PiP / Alpha)' },
			{ variableId: 'audio_muted', name: 'MUTED when audio is muted' },
			{ variableId: 'recording', name: 'REC while recording' },
			{ variableId: 'rec_time', name: 'Recording time' },
			{ variableId: 'source_count', name: 'Number of NDI sources' },
		])

		const label = this.label || 'ndi-studio-monitor'
		const presets = {
			now: {
				type: 'button',
				category: 'Status',
				name: 'Showing now',
				style: { text: `$(${label}:source)`, size: 'auto', color: WHITE, bgcolor: GREY },
				steps: [{ down: [], up: [] }],
				feedbacks: [],
			},
			rec: {
				type: 'button',
				category: 'Status',
				name: 'Record toggle',
				style: { text: `REC\\n$(${label}:rec_time)`, size: '14', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'record', options: { mode: 'toggle' } }], up: [] }],
				feedbacks: [{ feedbackId: 'recording', options: {}, style: { bgcolor: RED, color: WHITE } }],
			},
			mute: {
				type: 'button',
				category: 'Status',
				name: 'Audio mute toggle',
				style: { text: 'AUDIO\\nMUTE', size: '14', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'audio', options: { mode: 'toggle' } }], up: [] }],
				feedbacks: [{ feedbackId: 'muted', options: {}, style: { bgcolor: RED, color: WHITE } }],
			},
			none: {
				type: 'button',
				category: 'Sources',
				name: 'None (black)',
				style: { text: 'NONE', size: '14', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'source', options: { source: '', custom: '' } }], up: [] }],
				feedbacks: [{ feedbackId: 'source_is', options: { source: '' }, style: { bgcolor: GREEN, color: WHITE } }],
			},
			overlay_off: {
				type: 'button',
				category: 'Overlay (PiP)',
				name: 'Hide overlay',
				style: { text: 'OVERLAY\\nOFF', size: '14', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'overlay_hide', options: {} }], up: [] }],
				feedbacks: [],
			},
		}
		known.forEach((src, i) => {
			const { machine, name } = splitName(src)
			const text = machine ? `${name}\\n${machine}` : name
			presets[`src_${i}`] = {
				type: 'button',
				category: 'Sources',
				name: `${name} (${machine})`,
				style: { text, size: 'auto', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'source', options: { source: src, custom: '' } }], up: [] }],
				feedbacks: [{ feedbackId: 'source_is', options: { source: src }, style: { bgcolor: GREEN, color: WHITE } }],
			}
			presets[`pip_${i}`] = {
				type: 'button',
				category: 'Overlay (PiP)',
				name: `PiP ${name} (${machine})`,
				style: { text: `PiP\\n${name}`, size: 'auto', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'overlay', options: { source: src, custom: '', kind: 'pip' } }], up: [] }],
				feedbacks: [{ feedbackId: 'overlay_is', options: { source: src }, style: { bgcolor: BLUE, color: WHITE } }],
			}
		})
		this.setPresetDefinitions(presets)
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Setup',
				value:
					'In NDI Studio Monitor (Windows): ☰ menu → Settings → Application → turn on <b>Web control</b>. It shows the address to use. The default web login is admin / admin unless it was turned off when NDI Tools was installed.',
			},
			{ type: 'textinput', id: 'host', label: 'IP of the PC running Studio Monitor', width: 6, default: '', regex: Regex.HOSTNAME },
			{ type: 'number', id: 'port', label: 'Port', width: 6, default: 80, min: 1, max: 65535 },
			{ type: 'textinput', id: 'user', label: 'Web user', width: 6, default: 'admin' },
			{ type: 'textinput', id: 'pass', label: 'Web password', width: 6, default: 'admin' },
		]
	}
}

export function formatDuration(v) {
	const n = Number(v)
	if (!Number.isFinite(n) || n <= 0) return ''
	const s = Math.floor(n) // Studio Monitor reports seconds
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const sec = s % 60
	return (h ? `${h}:` : '') + `${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`
}

runEntrypoint(StudioMonitorInstance, [])
