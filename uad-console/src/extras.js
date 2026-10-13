// Talkback, "selected channel" cue strip, and meters.
import { combineRgb } from '@companion-module/base'
import { keyPath } from './ua-client.js'
import { allChannels, DB_STEPS, PAN_STEPS, DEFAULT_STEP_SIZE, stepLevel, stepDb, formatDb, varPrefix } from './controls.js'

const isOn = (v) => v === true || v === 'true'
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const white = combineRgb(255, 255, 255)
const dark = combineRgb(30, 30, 30)

// ---------- selection state ----------

/** The channel and send the cue-strip knobs act on. Lives on the instance. */
export function selection(self) {
	if (!self.selected) self.selected = { channel: null, send: null }
	const inputs = allChannels(self.client).filter((c) => c.group === 'inputs' && c.active !== false)
	if (!inputs.some((c) => c.key === self.selected.channel)) self.selected.channel = inputs[0]?.key ?? null
	const ch = allChannels(self.client).find((c) => c.key === self.selected.channel)
	if (ch && !ch.sends.includes(self.selected.send)) self.selected.send = ch.sends[0] ?? null
	return self.selected
}

const sendName = (self, dev, send) => self.client.devices.find((d) => d.id === dev)?.sendNames?.[send] ?? `Send ${Number(send) + 1}`

function selectedPaths(self) {
	const sel = selection(self)
	if (!sel.channel) return null
	const base = keyPath(sel.channel)
	return { sel, base, send: sel.send !== null ? `${base}/sends/${sel.send}` : null }
}

/** Keep live values flowing for whatever is selected (sends aren't subscribed by default). */
export function watchSelection(self) {
	const p = selectedPaths(self)
	if (!p) return
	if (p.send) {
		self.client.subscribe(`${p.send}/Gain`)
		self.client.subscribe(`${p.send}/Bypass`)
		self.client.read(`${p.send}/Gain`).catch(() => null)
		self.client.read(`${p.send}/Bypass`).catch(() => null)
	}
	applyMeters(self)
}

export function applyMeters(self) {
	const mode = self.config?.meters ?? 'selected'
	let keys = []
	if (mode === 'selected') keys = self.selected?.channel ? [self.selected.channel] : []
	else if (mode === 'active') keys = allChannels(self.client).filter((c) => c.group === 'inputs' && c.active !== false).map((c) => c.key)
	self.client.setMeterChannels(keys)
}

// ---------- talkback ----------

function talkbackDevices(self) {
	return self.client.devices.filter((d) => d.talkback)
}

async function setTalkback(self, devId, mode) {
	for (const dev of talkbackDevices(self)) {
		if (devId !== 'all' && dev.id !== devId) continue
		const { path, invert } = dev.talkback
		const now = isOn(await self.client.read(path))
		const talking = invert ? !now : now
		const want = mode === 'on' ? true : mode === 'off' ? false : !talking
		self.client.set(path, invert ? !want : want)
	}
}

export function talkbackActive(self, devId = 'all') {
	return talkbackDevices(self).some((d) => {
		if (devId !== 'all' && d.id !== devId) return false
		const v = isOn(self.client.values.get(d.talkback.path))
		return d.talkback.invert ? !v : v
	})
}

// ---------- meters ----------

const METER_FLOOR = -60
export function meterDb(self, key) {
	const base = keyPath(key)
	const l = Number(self.client.values.get(`${base}/meters/0/MeterLevel`))
	const r = Number(self.client.values.get(`${base}/meters/1/MeterLevel`))
	const vals = [l, r].filter(Number.isFinite)
	return vals.length ? Math.max(...vals) : null
}

export function meterBar(db, width = 8) {
	if (db === null || !Number.isFinite(db)) return '░'.repeat(width)
	const filled = Math.round(clamp((db - METER_FLOOR) / -METER_FLOOR, 0, 1) * width)
	return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// ---------- definitions ----------

const sizeOptionLite = {
	type: 'dropdown',
	id: 'size',
	label: 'Step size',
	default: DEFAULT_STEP_SIZE,
	choices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ id: n, label: n === 1 ? '1 (tiny)' : n === 2 ? '2 (default)' : String(n) })),
}
const dirOption = (up = 'Up', down = 'Down') => ({
	type: 'dropdown',
	id: 'direction',
	label: 'Direction',
	default: 'up',
	choices: [
		{ id: 'up', label: up },
		{ id: 'down', label: down },
	],
})

export function getExtraActions(self) {
	const c = self.client
	const devChoices = [{ id: 'all', label: 'All Apollos' }, ...c.devices.map((d) => ({ id: d.id, label: d.name }))]
	const inputs = allChannels(c).filter((ch) => ch.group === 'inputs')
	const sendIds = [...new Set(inputs.flatMap((ch) => ch.sends))].sort((a, b) => a - b)

	const step = (pathFn, table, min, max) => async (a) => {
		const p = selectedPaths(self)
		if (!p) return
		const path = pathFn(p)
		if (!path) return
		const d = table[stepLevel(a.options) - 1] * (a.options.direction === 'down' ? -1 : 1)
		c.set(path, stepDb(await c.read(path), d, min, max))
	}

	return {
		talkback: {
			name: 'Talkback - Talk',
			description: 'For hold-to-talk use On on press and Off on release (or the "Talkback (hold)" preset).',
			options: [
				{ type: 'dropdown', id: 'device', label: 'Apollo', default: 'all', choices: devChoices },
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'Talk on' },
						{ id: 'off', label: 'Talk off' },
					],
				},
			],
			callback: async (a) => {
				if (!talkbackDevices(self).length) {
					self.log('warn', 'No talkback control found on this Apollo/Console version')
					return
				}
				await setTalkback(self, a.options.device, a.options.mode)
			},
		},
		selectChannel: {
			name: 'Selected channel - Select',
			description: 'Picks the channel the "selected channel" knobs control.',
			options: [
				{
					type: 'dropdown',
					id: 'channel',
					label: 'Channel',
					default: inputs[0]?.key ?? '0/inputs/0',
					choices: inputs.map((ch) => ({ id: ch.key, label: `${ch.multi ? ch.deviceName + ' ' : ''}In ${Number(ch.id) + 1}: ${ch.name}` })),
					allowCustom: true,
				},
			],
			callback: async (a) => {
				selection(self).channel = a.options.channel
				selection(self)
				watchSelection(self)
				self.refreshAll()
			},
		},
		selectChannelStep: {
			name: 'Selected channel - Next / previous',
			options: [dirOption('Next', 'Previous')],
			callback: async (a) => {
				const list = inputs.filter((ch) => ch.active !== false)
				if (!list.length) return
				const i = list.findIndex((ch) => ch.key === selection(self).channel)
				const next = list[(i + (a.options.direction === 'down' ? -1 : 1) + list.length) % list.length]
				selection(self).channel = next.key
				selection(self)
				watchSelection(self)
				self.refreshAll()
			},
		},
		selectSend: {
			name: 'Selected channel - Select send (aux / cue)',
			options: [
				{
					type: 'dropdown',
					id: 'send',
					label: 'Send',
					default: sendIds[0] ?? '0',
					choices: (sendIds.length ? sendIds : ['0']).map((id) => ({ id, label: `Send ${Number(id) + 1}: ${sendName(self, '0', id)}` })),
					allowCustom: true,
				},
			],
			callback: async (a) => {
				selection(self).send = a.options.send
				watchSelection(self)
				self.refreshAll()
			},
		},
		selectedSendStep: {
			name: 'Selected channel - Send level: step (knob)',
			options: [dirOption(), sizeOptionLite],
			callback: step((p) => p.send && `${p.send}/Gain`, DB_STEPS),
		},
		selectedFaderStep: {
			name: 'Selected channel - Fader: step (knob)',
			options: [dirOption(), sizeOptionLite],
			callback: step((p) => `${p.base}/FaderLevel`, DB_STEPS),
		},
		selectedPanStep: {
			name: 'Selected channel - Pan: step (knob)',
			options: [dirOption('Right', 'Left'), sizeOptionLite],
			callback: async (a) => {
				const p = selectedPaths(self)
				if (!p) return
				const cur = Number(await c.read(`${p.base}/Pan`)) || 0
				const d = PAN_STEPS[stepLevel(a.options) - 1] * (a.options.direction === 'down' ? -1 : 1)
				c.set(`${p.base}/Pan`, Math.round(clamp(cur + d, -1, 1) * 100) / 100)
			},
		},
		selectedMute: {
			name: 'Selected channel - Mute / send mute',
			options: [
				{
					type: 'dropdown',
					id: 'what',
					label: 'What',
					default: 'channel',
					choices: [
						{ id: 'channel', label: 'Channel mute' },
						{ id: 'send', label: 'Selected send mute' },
					],
				},
			],
			callback: async (a) => {
				const p = selectedPaths(self)
				if (!p) return
				const path = a.options.what === 'send' ? p.send && `${p.send}/Bypass` : `${p.base}/Mute`
				if (!path) return
				c.set(path, !isOn(await c.read(path)))
			},
		},
	}
}

export function getExtraFeedbacks(self) {
	const c = self.client
	const inputs = allChannels(c).filter((ch) => ch.group === 'inputs')
	return {
		talkbackOn: {
			type: 'boolean',
			name: 'Talkback on',
			defaultStyle: { bgcolor: combineRgb(230, 120, 0), color: white },
			options: [{ type: 'dropdown', id: 'device', label: 'Apollo', default: 'all', choices: [{ id: 'all', label: 'Any' }, ...c.devices.map((d) => ({ id: d.id, label: d.name }))] }],
			callback: (fb) => talkbackActive(self, fb.options.device),
		},
		channelSelected: {
			type: 'boolean',
			name: 'Selected channel is',
			defaultStyle: { bgcolor: combineRgb(0, 90, 200), color: white },
			options: [
				{
					type: 'dropdown',
					id: 'channel',
					label: 'Channel',
					default: inputs[0]?.key ?? '0/inputs/0',
					choices: inputs.map((ch) => ({ id: ch.key, label: `${ch.multi ? ch.deviceName + ' ' : ''}In ${Number(ch.id) + 1}: ${ch.name}` })),
					allowCustom: true,
				},
			],
			callback: (fb) => selection(self).channel === fb.options.channel,
		},
		sendSelected: {
			type: 'boolean',
			name: 'Selected send is',
			defaultStyle: { bgcolor: combineRgb(0, 90, 200), color: white },
			options: [{ type: 'textinput', id: 'send', label: 'Send id (0 = first)', default: '0' }],
			callback: (fb) => String(selection(self).send) === String(fb.options.send),
		},
		meterClip: {
			type: 'boolean',
			name: 'Meter hot (selected channel above -3 dB)',
			defaultStyle: { bgcolor: combineRgb(200, 0, 0), color: white },
			options: [],
			callback: () => {
				const key = selection(self).channel
				const db = key ? meterDb(self, key) : null
				return db !== null && db > -3
			},
		},
	}
}

export function getExtraVariableDefinitions(self) {
	const defs = [
		{ variableId: 'talkback', name: 'Talkback on (any Apollo)' },
		{ variableId: 'talkback_method', name: 'How talkback is switched (for checking)' },
		{ variableId: 'sel_name', name: 'Selected channel name' },
		{ variableId: 'sel_level', name: 'Selected channel fader (dB)' },
		{ variableId: 'sel_mute', name: 'Selected channel mute' },
		{ variableId: 'sel_pan', name: 'Selected channel pan' },
		{ variableId: 'sel_send_name', name: 'Selected send name' },
		{ variableId: 'sel_send_level', name: 'Selected channel send level (dB)' },
		{ variableId: 'sel_send_mute', name: 'Selected send mute' },
		{ variableId: 'sel_meter', name: 'Selected channel meter (dB)' },
		{ variableId: 'sel_meterbar', name: 'Selected channel meter bar' },
	]
	if ((self.config?.meters ?? 'selected') === 'active') {
		for (const ch of allChannels(self.client).filter((c) => c.group === 'inputs' && c.active !== false)) {
			defs.push({ variableId: `${varPrefix(ch)}_meter`, name: `In ${Number(ch.id) + 1} meter (dB)` })
			defs.push({ variableId: `${varPrefix(ch)}_meterbar`, name: `In ${Number(ch.id) + 1} meter bar` })
		}
	}
	return defs
}

export function getExtraVariableValues(self) {
	const c = self.client
	const sel = selection(self)
	const ch = allChannels(c).find((x) => x.key === sel.channel)
	const values = {
		talkback: talkbackActive(self) ? 'on' : 'off',
		talkback_method: c.devices.map((d) => `${d.name}: ${d.talkback?.how ?? 'not found'}`).join('; '),
		sel_name: ch?.name ?? '',
		sel_level: '',
		sel_mute: '',
		sel_pan: '',
		sel_send_name: '',
		sel_send_level: '',
		sel_send_mute: '',
		sel_meter: '',
		sel_meterbar: meterBar(null),
	}
	if (ch) {
		const base = keyPath(ch.key)
		values.sel_level = formatDb(c.values.get(`${base}/FaderLevel`))
		values.sel_mute = isOn(c.values.get(`${base}/Mute`)) ? 'on' : 'off'
		const pan = Number(c.values.get(`${base}/Pan`))
		values.sel_pan = Number.isFinite(pan) ? Math.round(pan * 100) : ''
		if (sel.send !== null) {
			values.sel_send_name = sendName(self, ch.dev, sel.send)
			values.sel_send_level = formatDb(c.values.get(`${base}/sends/${sel.send}/Gain`))
			values.sel_send_mute = isOn(c.values.get(`${base}/sends/${sel.send}/Bypass`)) ? 'on' : 'off'
		}
		const db = meterDb(self, ch.key)
		values.sel_meter = db === null ? '' : db.toFixed(1)
		values.sel_meterbar = meterBar(db)
	}
	if ((self.config?.meters ?? 'selected') === 'active') {
		for (const x of allChannels(c).filter((y) => y.group === 'inputs' && y.active !== false)) {
			const db = meterDb(self, x.key)
			values[`${varPrefix(x)}_meter`] = db === null ? '' : db.toFixed(1)
			values[`${varPrefix(x)}_meterbar`] = meterBar(db)
		}
	}
	return values
}

export function getExtraPresets(self) {
	const c = self.client
	const label = self.label || 'uad-console'
	const presets = {}
	const v = (id) => `$(${label}:${id})`

	presets.talkback_hold = {
		type: 'button',
		category: 'Talkback',
		name: 'Talkback (hold to talk)',
		style: { text: 'TALK', size: '18', color: white, bgcolor: dark },
		steps: [{ down: [{ actionId: 'talkback', options: { device: 'all', mode: 'on' } }], up: [{ actionId: 'talkback', options: { device: 'all', mode: 'off' } }] }],
		feedbacks: [{ feedbackId: 'talkbackOn', options: { device: 'all' }, style: { bgcolor: combineRgb(230, 120, 0), color: white } }],
	}
	presets.talkback_latch = {
		type: 'button',
		category: 'Talkback',
		name: 'Talkback (press on / press off)',
		style: { text: 'TALK\\nLATCH', size: '14', color: white, bgcolor: dark },
		steps: [{ down: [{ actionId: 'talkback', options: { device: 'all', mode: 'toggle' } }], up: [] }],
		feedbacks: [{ feedbackId: 'talkbackOn', options: { device: 'all' }, style: { bgcolor: combineRgb(230, 120, 0), color: white } }],
	}

	// Cue strip: pick a channel and a cue/aux, then the knobs act on that pair.
	const cat = 'Cue strip (selected channel)'
	const knob = (id, name, text, left, right, push) => {
		presets[id] = {
			type: 'button',
			category: cat,
			name,
			options: { rotaryActions: true },
			style: { text, size: '14', color: white, bgcolor: dark },
			steps: [{ down: push ? [push] : [], up: [], rotate_left: [left], rotate_right: [right] }],
			feedbacks: [],
		}
	}
	knob(
		'sel_send_knob',
		'Knob: selected channel → selected cue level',
		`${v('sel_send_name')}\\n${v('sel_send_level')} dB`,
		{ actionId: 'selectedSendStep', options: { direction: 'down', size: DEFAULT_STEP_SIZE } },
		{ actionId: 'selectedSendStep', options: { direction: 'up', size: DEFAULT_STEP_SIZE } }
	)
	knob(
		'sel_fader_knob',
		'Knob: selected channel fader',
		`${v('sel_name')}\\n${v('sel_level')} dB\\n${v('sel_meterbar')}`,
		{ actionId: 'selectedFaderStep', options: { direction: 'down', size: DEFAULT_STEP_SIZE } },
		{ actionId: 'selectedFaderStep', options: { direction: 'up', size: DEFAULT_STEP_SIZE } }
	)
	knob(
		'sel_pick_knob',
		'Knob: choose channel (turn) ',
		`CHANNEL\\n${v('sel_name')}`,
		{ actionId: 'selectChannelStep', options: { direction: 'down' } },
		{ actionId: 'selectChannelStep', options: { direction: 'up' } }
	)
	presets.sel_send_mute = {
		type: 'button',
		category: cat,
		name: 'Mute selected channel in selected cue',
		style: { text: `${v('sel_name')}\\nCUE MUTE ${v('sel_send_mute')}`, size: '14', color: white, bgcolor: dark },
		steps: [{ down: [{ actionId: 'selectedMute', options: { what: 'send' } }], up: [] }],
		feedbacks: [],
	}

	const sendIds = [...new Set(allChannels(c).flatMap((ch) => ch.sends))].sort((a, b) => a - b)
	for (const id of sendIds) {
		presets[`sel_send_${id}`] = {
			type: 'button',
			category: cat,
			name: `Select ${sendName(self, '0', id)}`,
			style: { text: sendName(self, '0', id), size: '14', color: white, bgcolor: dark },
			steps: [{ down: [{ actionId: 'selectSend', options: { send: id } }], up: [] }],
			feedbacks: [{ feedbackId: 'sendSelected', options: { send: id }, style: { bgcolor: combineRgb(0, 90, 200), color: white } }],
		}
	}
	for (const ch of allChannels(c).filter((x) => x.group === 'inputs' && x.active !== false)) {
		presets[`sel_ch_${varPrefix(ch)}`] = {
			type: 'button',
			category: `${cat}: channel buttons`,
			name: `Select ${ch.name}`,
			style: { text: `$(${label}:${varPrefix(ch)}_name)`, size: '14', color: white, bgcolor: dark },
			steps: [{ down: [{ actionId: 'selectChannel', options: { channel: ch.key } }], up: [] }],
			feedbacks: [{ feedbackId: 'channelSelected', options: { channel: ch.key }, style: { bgcolor: combineRgb(0, 90, 200), color: white } }],
		}
	}
	return presets
}
