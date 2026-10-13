// Actions, feedbacks, variables and presets for the UAD Console module.
import { combineRgb } from '@companion-module/base'

// ---------- step sizes (same 1-10 idea as the Panasonic knobs) ----------

export const STEP_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
export const DEFAULT_STEP_SIZE = 2
/** dB per knob click for faders, sends and monitor level. */
export const DB_STEPS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 10]
/** Pan change per click (-1 = hard left, 1 = hard right). */
export const PAN_STEPS = [0.01, 0.02, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5]
/** Preamp gain change per click, on the 0-1 "tapered" scale. */
export const GAIN_STEPS = [0.005, 0.01, 0.02, 0.03, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2]

export const FADER_MIN = -144 // the engine's "-inf"
export const FADER_MAX = 12
const FADER_FLOOR = -60 // turning up from -inf starts here
export const MONITOR_MIN = -96
export const MONITOR_MAX = 0

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const round2 = (n) => Math.round(n * 100) / 100

export function stepLevel(options) {
	const n = Math.round(Number(options?.size))
	return STEP_SIZES.includes(n) ? n : DEFAULT_STEP_SIZE
}

/** New dB value after one knob click. */
export function stepDb(current, deltaDb, min = FADER_MIN, max = FADER_MAX) {
	let base = Number(current)
	if (!Number.isFinite(base)) base = min
	const isFader = min === FADER_MIN
	if (isFader && deltaDb > 0 && base < FADER_FLOOR) base = FADER_FLOOR - deltaDb
	let next = round2(base + deltaDb)
	if (isFader && deltaDb < 0 && next < FADER_FLOOR) next = FADER_MIN
	return clamp(next, min, max)
}

export const formatDb = (v) => {
	const n = Number(v)
	if (!Number.isFinite(n)) return ''
	if (n <= -143.9) return '-inf'
	return (n > 0 ? '+' : '') + n.toFixed(1)
}

const sizeOption = {
	type: 'dropdown',
	id: 'size',
	label: 'Step size',
	default: DEFAULT_STEP_SIZE,
	choices: STEP_SIZES.map((n) => ({
		id: n,
		label: n === 1 ? '1 (tiny, smoothest)' : n === DEFAULT_STEP_SIZE ? `${n} (default)` : n === 10 ? '10 (huge)' : String(n),
	})),
	tooltip: 'How far one knob click moves. 1 = tiny steps for smooth continuous turning.',
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

const directionOption = (up = 'Up', down = 'Down') => ({
	type: 'dropdown',
	id: 'direction',
	label: 'Direction',
	default: 'up',
	choices: [
		{ id: 'up', label: up },
		{ id: 'down', label: down },
	],
})

// ---------- channel helpers ----------

export function allChannels(client) {
	return client.devices.flatMap((d) => d.channels.map((c) => ({ ...c, deviceName: d.name, multi: client.devices.length > 1 })))
}

const GROUP_LABEL = { inputs: 'In', auxs: 'Aux', outputs: 'Monitor' }

function channelChoices(client, groups) {
	const list = allChannels(client).filter((c) => groups.includes(c.group))
	return list.map((c) => ({
		id: c.key,
		label: `${c.multi ? c.deviceName + ' ' : ''}${GROUP_LABEL[c.group]} ${Number(c.id) + 1}: ${c.name}`,
	}))
}

function channelOption(client, groups, label = 'Channel') {
	const choices = channelChoices(client, groups)
	return {
		type: 'dropdown',
		id: 'channel',
		label,
		default: choices[0]?.id ?? '0/inputs/0',
		choices: choices.length ? choices : [{ id: '0/inputs/0', label: 'Not connected yet: In 1' }],
		allowCustom: true,
		tooltip: 'Channels are read from UAD Console when the module connects.',
	}
}

const channelPath = (key) => {
	const [dev, group, id] = String(key).split('/')
	return `/devices/${dev}/${group}/${id}`
}

function monitorPath(client, options) {
	if (options?.channel) return channelPath(options.channel)
	const mon = allChannels(client).find((c) => c.group === 'outputs')
	return mon ? channelPath(mon.key) : '/devices/0/outputs/0'
}

async function applyBool(client, path, mode) {
	let next
	if (mode === 'on') next = true
	else if (mode === 'off') next = false
	else {
		const cur = await client.read(path)
		next = !(cur === true || cur === 'true')
	}
	client.set(path, next)
}

// ---------- actions ----------

export function getActions(self) {
	const c = self.client
	const inputsAuxs = channelOption(c, ['inputs', 'auxs'])
	const inputs = channelOption(c, ['inputs'])
	const monitor = channelOption(c, ['outputs'], 'Monitor output')

	const sendChoices = []
	const auxNames = new Map(allChannels(c).filter((ch) => ch.group === 'auxs').map((ch) => [ch.id, ch.name]))
	const sendIds = [...new Set(allChannels(c).flatMap((ch) => ch.sends))].sort((a, b) => a - b)
	for (const id of sendIds.length ? sendIds : ['0', '1', '2', '3']) {
		sendChoices.push({ id, label: `Send ${Number(id) + 1}${auxNames.has(id) ? ': ' + auxNames.get(id) : ''}` })
	}
	const sendOption = {
		type: 'dropdown',
		id: 'send',
		label: 'Send (aux / cue)',
		default: sendChoices[0].id,
		choices: sendChoices,
		allowCustom: true,
	}

	return {
		mute: {
			name: 'Channel - Mute',
			description: 'For a momentary mute, use On for press and Off for release (or the "momentary" presets).',
			options: [inputsAuxs, modeOption],
			callback: async (a) => applyBool(c, `${channelPath(a.options.channel)}/Mute`, a.options.mode),
		},
		solo: {
			name: 'Channel - Solo',
			options: [inputs, modeOption],
			callback: async (a) => applyBool(c, `${channelPath(a.options.channel)}/Solo`, a.options.mode),
		},
		levelSet: {
			name: 'Channel - Fader level: set',
			options: [inputsAuxs, { type: 'number', id: 'db', label: 'Level (dB, -144 = -inf)', default: 0, min: FADER_MIN, max: FADER_MAX, step: 0.1 }],
			callback: async (a) => c.set(`${channelPath(a.options.channel)}/FaderLevel`, clamp(Number(a.options.db), FADER_MIN, FADER_MAX)),
		},
		levelStep: {
			name: 'Channel - Fader level: step (knob)',
			description: 'Put Up on Rotate right and Down on Rotate left.',
			options: [inputsAuxs, directionOption(), sizeOption],
			callback: async (a) => {
				const path = `${channelPath(a.options.channel)}/FaderLevel`
				const d = DB_STEPS[stepLevel(a.options) - 1] * (a.options.direction === 'down' ? -1 : 1)
				c.set(path, stepDb(await c.read(path), d))
			},
		},
		panSet: {
			name: 'Channel - Pan: set',
			options: [inputs, { type: 'number', id: 'pan', label: 'Pan (-100 = left, 0 = centre, 100 = right)', default: 0, min: -100, max: 100 }],
			callback: async (a) => c.set(`${channelPath(a.options.channel)}/Pan`, clamp(Number(a.options.pan) / 100, -1, 1)),
		},
		panStep: {
			name: 'Channel - Pan: step (knob)',
			options: [inputs, directionOption('Right', 'Left'), sizeOption],
			callback: async (a) => {
				const path = `${channelPath(a.options.channel)}/Pan`
				const cur = Number(await c.read(path)) || 0
				const d = PAN_STEPS[stepLevel(a.options) - 1] * (a.options.direction === 'down' ? -1 : 1)
				c.set(path, round2(clamp(cur + d, -1, 1) * 100) / 100)
			},
		},
		sendStep: {
			name: 'Send - Level: step (knob)',
			options: [inputs, sendOption, directionOption(), sizeOption],
			callback: async (a) => {
				const path = `${channelPath(a.options.channel)}/sends/${a.options.send}/Gain`
				const d = DB_STEPS[stepLevel(a.options) - 1] * (a.options.direction === 'down' ? -1 : 1)
				c.set(path, stepDb(await c.read(path), d))
			},
		},
		sendSet: {
			name: 'Send - Level: set',
			options: [inputs, sendOption, { type: 'number', id: 'db', label: 'Level (dB, -144 = -inf)', default: 0, min: FADER_MIN, max: FADER_MAX, step: 0.1 }],
			callback: async (a) => c.set(`${channelPath(a.options.channel)}/sends/${a.options.send}/Gain`, clamp(Number(a.options.db), FADER_MIN, FADER_MAX)),
		},
		sendMute: {
			name: 'Send - Mute',
			options: [inputs, sendOption, modeOption],
			callback: async (a) => applyBool(c, `${channelPath(a.options.channel)}/sends/${a.options.send}/Bypass`, a.options.mode),
		},
		preampSwitch: {
			name: 'Preamp - 48V / Pad / Phase / Low cut',
			options: [
				inputs,
				{
					type: 'dropdown',
					id: 'prop',
					label: 'Switch',
					default: 'Pad',
					choices: [
						{ id: '48V', label: '48V phantom' },
						{ id: 'Pad', label: 'Pad' },
						{ id: 'Phase', label: 'Phase (polarity)' },
						{ id: 'LowCut', label: 'Low cut' },
					],
				},
				modeOption,
			],
			callback: async (a) => applyBool(c, `${channelPath(a.options.channel)}/preamps/0/${a.options.prop}`, a.options.mode),
		},
		preampGainStep: {
			name: 'Preamp - Gain: step (knob)',
			options: [inputs, directionOption(), sizeOption],
			callback: async (a) => {
				const path = `${channelPath(a.options.channel)}/preamps/0/GainTapered`
				const cur = Number(await c.read(path))
				const d = GAIN_STEPS[stepLevel(a.options) - 1] * (a.options.direction === 'down' ? -1 : 1)
				c.set(path, Math.round(clamp((Number.isFinite(cur) ? cur : 0) + d, 0, 1) * 1000) / 1000)
			},
		},
		monitorStep: {
			name: 'Monitor - Level: step (knob)',
			options: [monitor, directionOption(), sizeOption],
			callback: async (a) => {
				const path = `${monitorPath(c, a.options)}/CRMonitorLevel`
				const d = DB_STEPS[stepLevel(a.options) - 1] * (a.options.direction === 'down' ? -1 : 1)
				c.set(path, stepDb(await c.read(path), d, MONITOR_MIN, MONITOR_MAX))
			},
		},
		monitorSet: {
			name: 'Monitor - Level: set',
			options: [monitor, { type: 'number', id: 'db', label: 'Level (dB)', default: -20, min: MONITOR_MIN, max: MONITOR_MAX, step: 0.5 }],
			callback: async (a) => c.set(`${monitorPath(c, a.options)}/CRMonitorLevel`, clamp(Number(a.options.db), MONITOR_MIN, MONITOR_MAX)),
		},
		monitorMute: {
			name: 'Monitor - Mute',
			options: [monitor, modeOption],
			callback: async (a) => applyBool(c, `${monitorPath(c, a.options)}/Mute`, a.options.mode),
		},
		monitorDim: {
			name: 'Monitor - Dim',
			options: [monitor, modeOption],
			callback: async (a) => applyBool(c, `${monitorPath(c, a.options)}/DimOn`, a.options.mode),
		},
		raw: {
			name: 'Advanced - Send raw command',
			description: 'Sent exactly as typed, e.g. "set /devices/0/inputs/0/Mute/value/ true".',
			options: [{ type: 'textinput', id: 'command', label: 'Command', default: 'get /devices', useVariables: true }],
			callback: async (a, ctx) => {
				c.send(await ctx.parseVariablesInString(String(a.options.command)))
			},
		},
		rescan: {
			name: 'Advanced - Re-read channels from UAD Console',
			options: [],
			callback: async () => {
				await c.discover()
			},
		},
	}
}

// ---------- feedbacks ----------

const isOn = (v) => v === true || v === 'true'

export function getFeedbacks(self) {
	const c = self.client
	const red = { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) }
	const yellow = { bgcolor: combineRgb(230, 180, 0), color: combineRgb(0, 0, 0) }
	return {
		muted: {
			type: 'boolean',
			name: 'Channel muted',
			defaultStyle: red,
			options: [channelOption(c, ['inputs', 'auxs'])],
			callback: (fb) => isOn(c.values.get(`${channelPath(fb.options.channel)}/Mute`)),
		},
		soloed: {
			type: 'boolean',
			name: 'Channel soloed',
			defaultStyle: yellow,
			options: [channelOption(c, ['inputs'])],
			callback: (fb) => isOn(c.values.get(`${channelPath(fb.options.channel)}/Solo`)),
		},
		sendMuted: {
			type: 'boolean',
			name: 'Send muted',
			defaultStyle: red,
			options: [channelOption(c, ['inputs']), { type: 'textinput', id: 'send', label: 'Send id (0 = first)', default: '0' }],
			callback: (fb) => isOn(c.values.get(`${channelPath(fb.options.channel)}/sends/${fb.options.send}/Bypass`)),
		},
		preampOn: {
			type: 'boolean',
			name: 'Preamp switch on (48V / Pad / Phase / Low cut)',
			defaultStyle: { bgcolor: combineRgb(0, 120, 220), color: combineRgb(255, 255, 255) },
			options: [
				channelOption(c, ['inputs']),
				{
					type: 'dropdown',
					id: 'prop',
					label: 'Switch',
					default: '48V',
					choices: ['48V', 'Pad', 'Phase', 'LowCut'].map((id) => ({ id, label: id })),
				},
			],
			callback: (fb) => isOn(c.values.get(`${channelPath(fb.options.channel)}/preamps/0/${fb.options.prop}`)),
		},
		monitorMuted: {
			type: 'boolean',
			name: 'Monitor muted',
			defaultStyle: red,
			options: [channelOption(c, ['outputs'], 'Monitor output')],
			callback: (fb) => isOn(c.values.get(`${monitorPath(c, fb.options)}/Mute`)),
		},
		monitorDimmed: {
			type: 'boolean',
			name: 'Monitor dimmed',
			defaultStyle: yellow,
			options: [channelOption(c, ['outputs'], 'Monitor output')],
			callback: (fb) => isOn(c.values.get(`${monitorPath(c, fb.options)}/DimOn`)),
		},
		connected: {
			type: 'boolean',
			name: 'Connected to UAD Console',
			defaultStyle: { bgcolor: combineRgb(0, 140, 0), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => c.connected,
		},
	}
}

// ---------- variables ----------

const GROUP_VAR = { inputs: 'in', auxs: 'aux', outputs: 'mon' }
/** Variable id prefix for a channel, e.g. "in_3" (device 0) or "d1_in_3". */
export const varPrefix = (ch) => `${ch.dev === '0' ? '' : `d${ch.dev}_`}${GROUP_VAR[ch.group]}_${Number(ch.id) + 1}`

export function getVariableDefinitions(self) {
	const defs = [{ variableId: 'connected', name: 'Connected to UAD Console' }]
	for (const ch of allChannels(self.client)) {
		const p = varPrefix(ch)
		const label = `${GROUP_LABEL[ch.group]} ${Number(ch.id) + 1}`
		defs.push({ variableId: `${p}_name`, name: `${label} name` })
		defs.push({ variableId: `${p}_mute`, name: `${label} mute` })
		if (ch.group === 'outputs') {
			defs.push({ variableId: `${p}_level`, name: `${label} monitor level (dB)` })
			defs.push({ variableId: `${p}_dim`, name: `${label} dim` })
		} else {
			defs.push({ variableId: `${p}_level`, name: `${label} fader (dB)` })
		}
		if (ch.group === 'inputs') {
			defs.push({ variableId: `${p}_solo`, name: `${label} solo` })
			defs.push({ variableId: `${p}_pan`, name: `${label} pan (-100..100)` })
		}
	}
	return defs
}

export function getVariableValues(self) {
	const c = self.client
	const values = { connected: c.connected ? 'yes' : 'no' }
	for (const ch of allChannels(c)) {
		const p = varPrefix(ch)
		const base = channelPath(ch.key)
		values[`${p}_name`] = ch.name
		values[`${p}_mute`] = isOn(c.values.get(`${base}/Mute`)) ? 'on' : 'off'
		if (ch.group === 'outputs') {
			values[`${p}_level`] = formatDb(c.values.get(`${base}/CRMonitorLevel`))
			values[`${p}_dim`] = isOn(c.values.get(`${base}/DimOn`)) ? 'on' : 'off'
		} else {
			values[`${p}_level`] = formatDb(c.values.get(`${base}/FaderLevel`))
		}
		if (ch.group === 'inputs') {
			values[`${p}_solo`] = isOn(c.values.get(`${base}/Solo`)) ? 'on' : 'off'
			const pan = Number(c.values.get(`${base}/Pan`))
			values[`${p}_pan`] = Number.isFinite(pan) ? Math.round(pan * 100) : ''
		}
	}
	return values
}

// ---------- presets ----------

export function getPresets(self) {
	const c = self.client
	const label = self.label || 'uad-console'
	const presets = {}
	const white = combineRgb(255, 255, 255)
	const dark = combineRgb(30, 30, 30)
	const red = combineRgb(200, 0, 0)

	for (const ch of allChannels(c)) {
		const p = varPrefix(ch)
		const key = ch.key
		const cat = ch.group === 'outputs' ? 'Monitor' : `${GROUP_LABEL[ch.group]} ${Number(ch.id) + 1}: ${ch.name}`

		if (ch.group === 'outputs') {
			presets[`${p}_knob`] = {
				type: 'button',
				category: cat,
				name: 'Monitor level knob (push = mute)',
				options: { rotaryActions: true },
				style: { text: `MON\\n$(${label}:${p}_level)`, size: '14', color: white, bgcolor: dark },
				steps: [
					{
						down: [{ actionId: 'monitorMute', options: { channel: key, mode: 'toggle' } }],
						up: [],
						rotate_left: [{ actionId: 'monitorStep', options: { channel: key, direction: 'down', size: DEFAULT_STEP_SIZE } }],
						rotate_right: [{ actionId: 'monitorStep', options: { channel: key, direction: 'up', size: DEFAULT_STEP_SIZE } }],
					},
				],
				feedbacks: [{ feedbackId: 'monitorMuted', options: { channel: key }, style: { bgcolor: red, color: white } }],
			}
			presets[`${p}_dim`] = {
				type: 'button',
				category: cat,
				name: 'Dim',
				style: { text: 'DIM', size: '18', color: white, bgcolor: dark },
				steps: [{ down: [{ actionId: 'monitorDim', options: { channel: key, mode: 'toggle' } }], up: [] }],
				feedbacks: [{ feedbackId: 'monitorDimmed', options: { channel: key }, style: { bgcolor: combineRgb(230, 180, 0), color: 0 } }],
			}
			continue
		}

		const muteFb = [{ feedbackId: 'muted', options: { channel: key }, style: { bgcolor: red, color: white } }]
		presets[`${p}_mute`] = {
			type: 'button',
			category: cat,
			name: 'Mute (toggle)',
			style: { text: `$(${label}:${p}_name)\\nMUTE`, size: '14', color: white, bgcolor: dark },
			steps: [{ down: [{ actionId: 'mute', options: { channel: key, mode: 'toggle' } }], up: [] }],
			feedbacks: muteFb,
		}
		presets[`${p}_mute_hold`] = {
			type: 'button',
			category: cat,
			name: 'Mute while held (momentary)',
			style: { text: `$(${label}:${p}_name)\\nHOLD MUTE`, size: '14', color: white, bgcolor: dark },
			steps: [
				{
					down: [{ actionId: 'mute', options: { channel: key, mode: 'on' } }],
					up: [{ actionId: 'mute', options: { channel: key, mode: 'off' } }],
				},
			],
			feedbacks: muteFb,
		}
		presets[`${p}_knob`] = {
			type: 'button',
			category: cat,
			name: 'Fader knob',
			options: { rotaryActions: true },
			style: { text: `$(${label}:${p}_name)\\n$(${label}:${p}_level) dB`, size: '14', color: white, bgcolor: dark },
			steps: [
				{
					down: [],
					up: [],
					rotate_left: [{ actionId: 'levelStep', options: { channel: key, direction: 'down', size: DEFAULT_STEP_SIZE } }],
					rotate_right: [{ actionId: 'levelStep', options: { channel: key, direction: 'up', size: DEFAULT_STEP_SIZE } }],
				},
			],
			feedbacks: muteFb,
		}
		if (ch.group === 'inputs') {
			presets[`${p}_solo`] = {
				type: 'button',
				category: cat,
				name: 'Solo (toggle)',
				style: { text: `$(${label}:${p}_name)\\nSOLO`, size: '14', color: white, bgcolor: dark },
				steps: [{ down: [{ actionId: 'solo', options: { channel: key, mode: 'toggle' } }], up: [] }],
				feedbacks: [{ feedbackId: 'soloed', options: { channel: key }, style: { bgcolor: combineRgb(230, 180, 0), color: 0 } }],
			}
		}
	}
	return presets
}
