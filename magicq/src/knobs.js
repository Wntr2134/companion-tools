// Knob, feedback, variable and preset layer for encoders (Ulanzi D200X, Stream Deck +), in the
// same style as the other companion-tools modules: one click = one step (size 1-10), fast turns
// count every click, plain on/off feedbacks, playback variables and a "selected playback".
//
// MagicQ only feeds back playbacks 1-10 over OSC, but the step actions take any playback
// number: above 10 the module works from the level it last sent.
import { combineRgb } from '@companion-module/base'

export const STEP_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
export const DEFAULT_STEP_SIZE = 2
/** Percent per knob click for step sizes 1-10. */
export const PERCENT_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20]
/** Playbacks MagicQ addresses (and feeds back) through its built-in OSC addresses. */
export const FEEDBACK_PLAYBACKS = 10
export const MAX_PLAYBACK = 999

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/** Step size option (1-10) → 1-10, with anything odd falling back to the default. */
export function stepLevel(options) {
	const n = Math.round(Number(options?.size))
	return STEP_SIZES.includes(n) ? n : DEFAULT_STEP_SIZE
}

/** Percent to move for one click, signed by direction. */
export function stepPercent(options) {
	return PERCENT_STEPS[stepLevel(options) - 1] * (options?.direction === 'down' ? -1 : 1)
}

/** Next level after one click: whole percent, clamped 0-100. */
export function stepLevelPercent(current, delta) {
	let base = Number(current)
	if (!Number.isFinite(base)) base = 0
	return clamp(Math.round(base + delta), 0, 100)
}

/** Playback number from an option (number field, text, or a variable already parsed). */
export function playbackNumber(value) {
	const n = Math.round(Number(String(value ?? '').trim()))
	return Number.isFinite(n) && n >= 1 && n <= MAX_PLAYBACK ? n : undefined
}

export function formatLevel(value) {
	const n = Number(value)
	return Number.isFinite(n) ? String(Math.round(n)) : ''
}

// ---------- selection ----------

const selections = new WeakMap()
export function selection(self) {
	let s = selections.get(self)
	if (!s) {
		s = { pb: 1 }
		selections.set(self, s)
	}
	return s
}

// ---------- shared options ----------

const sizeOption = {
	type: 'dropdown',
	id: 'size',
	label: 'Step size',
	default: DEFAULT_STEP_SIZE,
	choices: STEP_SIZES.map((n) => ({
		id: n,
		label:
			`${n}: ${PERCENT_STEPS[n - 1]} % per click` +
			(n === 1 ? ' (finest)' : n === DEFAULT_STEP_SIZE ? ' (default)' : n === 10 ? ' (coarsest)' : ''),
	})),
	tooltip: 'Percent per click: 1, 2, 3, 4, 5, 6, 8, 10, 15, 20',
}

const directionOption = {
	type: 'dropdown',
	id: 'direction',
	label: 'Direction',
	default: 'up',
	choices: [
		{ id: 'up', label: 'Up (rotate right)' },
		{ id: 'down', label: 'Down (rotate left)' },
	],
}

const pbOption = {
	type: 'number',
	id: 'pb',
	label: 'Playback (MagicQ only reports 1-10 back)',
	default: 1,
	min: 1,
	max: MAX_PLAYBACK,
	asInteger: true,
	clampValues: true,
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

// ---------- behaviour ----------

/** One click on a playback fader. Uses the level we track locally, so fast turns add up. */
export function stepPlayback(self, pb, options) {
	if (pb === undefined) return
	const next = stepLevelPercent(self.playbackLevel(pb), stepPercent(options))
	self.setPlaybackLevel(pb, next)
}

function flashPlayback(self, pb, mode) {
	if (pb === undefined) return
	const current = self.playbackFlash(pb)
	const next = mode === 'on' ? 1 : mode === 'off' ? 0 : current ? 0 : 1
	self.sendOSC('/pb/' + pb + '/flash', { type: 'i', value: next })
	self.setPlaybackFlash(pb, next)
}

function selectPlayback(self, pb) {
	if (pb === undefined) return
	selection(self).pb = pb
	self.refreshKnobValues()
}

export function getKnobActions(self) {
	const sel = () => selection(self).pb
	const simple = (suffix) => () => self.sendOSC('/pb/' + sel() + '/' + suffix)
	return {
		knob_pb_step: {
			name: '[Knob] Playback fader step',
			description: 'One fixed step per click. Put Up on Rotate right and Down on Rotate left.',
			options: [pbOption, directionOption, sizeOption],
			callback: (e) => stepPlayback(self, playbackNumber(e.options.pb), e.options),
		},
		sel_select: {
			name: '[Selected] Select playback',
			options: [pbOption],
			callback: (e) => selectPlayback(self, playbackNumber(e.options.pb)),
		},
		sel_next: {
			name: '[Selected] Next / previous playback (knob)',
			options: [
				directionOption,
				{
					type: 'number',
					id: 'max',
					label: 'Highest playback to step through',
					default: FEEDBACK_PLAYBACKS,
					min: 1,
					max: MAX_PLAYBACK,
					asInteger: true,
					clampValues: true,
				},
			],
			callback: (e) => {
				const max = playbackNumber(e.options.max) ?? FEEDBACK_PLAYBACKS
				const delta = e.options.direction === 'down' ? -1 : 1
				const current = clamp(sel(), 1, max)
				selectPlayback(self, ((current - 1 + delta + max) % max) + 1)
			},
		},
		sel_fader_step: {
			name: '[Selected] Playback fader step (knob)',
			options: [directionOption, sizeOption],
			callback: (e) => stepPlayback(self, sel(), e.options),
		},
		sel_go: { name: '[Selected] Go', options: [], callback: simple('go') },
		sel_pause: { name: '[Selected] Pause', options: [], callback: simple('pause') },
		sel_release: { name: '[Selected] Release', options: [], callback: simple('release') },
		sel_flash: {
			name: '[Selected] Flash',
			description: 'For a momentary flash, use On on press and Off on release.',
			options: [modeOption],
			callback: (e) => flashPlayback(self, sel(), e.options.mode),
		},
		dbo_toggle: {
			name: '[Console] DBO toggle',
			description: 'Desk black out on/off. Companion remembers what it last sent.',
			options: [modeOption],
			callback: (e) => {
				const mode = e.options.mode
				const next = mode === 'on' ? 1 : mode === 'off' ? 0 : self.dbo === 1 ? 0 : 1
				self.sendOSC('/dbo', { type: 'i', value: next })
				self.dbo = next
				self.refreshKnobValues()
			},
		},
		swap_toggle: {
			name: '[Console] Add / Swap toggle',
			description: 'Flips between Add and Swap. Companion remembers what it last sent.',
			options: [modeOption],
			callback: (e) => {
				const mode = e.options.mode
				const next = mode === 'on' ? 1 : mode === 'off' ? 0 : self.swapMode === 1 ? 0 : 1
				self.sendOSC('/swap', { type: 'i', value: next })
				self.swapMode = next
				self.refreshKnobValues()
			},
		},
	}
}

// ---------- feedbacks ----------

export const KNOB_FEEDBACK_IDS = [
	'pb_above',
	'pb_full',
	'pb_flash_on',
	'sel_is',
	'sel_above',
	'sel_flash_on',
	'dbo_on',
	'swap_on',
	'console_online',
]

export function getKnobFeedbacks(self) {
	const white = combineRgb(255, 255, 255)
	const green = { bgcolor: combineRgb(0, 140, 0), color: white }
	const amber = { bgcolor: combineRgb(230, 150, 0), color: combineRgb(0, 0, 0) }
	const blue = { bgcolor: combineRgb(0, 90, 200), color: white }
	const red = { bgcolor: combineRgb(200, 0, 0), color: white }
	const thresholdOption = {
		type: 'number',
		id: 'level',
		label: 'Above this level (%)',
		default: 0,
		min: 0,
		max: 100,
		clampValues: true,
	}
	const above = (pb, level) => pb !== undefined && self.playbackLevel(pb) > (Number(level) || 0)
	return {
		pb_above: {
			type: 'boolean',
			name: '[Playback] Fader above level',
			description: 'On when the playback fader is above the level you set (0 = fader up at all).',
			defaultStyle: green,
			options: [pbOption, thresholdOption],
			callback: (fb) => above(playbackNumber(fb.options.pb), fb.options.level),
		},
		pb_full: {
			type: 'boolean',
			name: '[Playback] Fader at full',
			defaultStyle: amber,
			options: [pbOption],
			callback: (fb) => {
				const pb = playbackNumber(fb.options.pb)
				return pb !== undefined && self.playbackLevel(pb) >= 100
			},
		},
		pb_flash_on: {
			type: 'boolean',
			name: '[Playback] Flash on',
			defaultStyle: amber,
			options: [pbOption],
			callback: (fb) => {
				const pb = playbackNumber(fb.options.pb)
				return pb !== undefined && self.playbackFlash(pb) === 1
			},
		},
		sel_is: {
			type: 'boolean',
			name: '[Selected] This playback is selected',
			defaultStyle: blue,
			options: [pbOption],
			callback: (fb) => selection(self).pb === playbackNumber(fb.options.pb),
		},
		sel_above: {
			type: 'boolean',
			name: '[Selected] Selected playback fader above level',
			defaultStyle: green,
			options: [thresholdOption],
			callback: (fb) => above(selection(self).pb, fb.options.level),
		},
		sel_flash_on: {
			type: 'boolean',
			name: '[Selected] Selected playback flash on',
			defaultStyle: amber,
			options: [],
			callback: () => self.playbackFlash(selection(self).pb) === 1,
		},
		dbo_on: {
			type: 'boolean',
			name: '[Console] DBO on (as last sent from Companion)',
			defaultStyle: red,
			options: [],
			callback: () => self.dbo === 1,
		},
		swap_on: {
			type: 'boolean',
			name: '[Console] Swap mode (as last sent from Companion)',
			defaultStyle: amber,
			options: [],
			callback: () => self.swapMode === 1,
		},
		console_online: {
			type: 'boolean',
			name: '[Console] Connected',
			description: 'On while MagicQ is sending feedback. Needs Enable Feedback.',
			defaultStyle: green,
			options: [],
			callback: () => self.isConsoleOnline,
		},
	}
}

// ---------- variables ----------

export function getKnobVariableDefinitions() {
	const defs = {
		connection: { name: 'Connection: connected, waiting, disconnected or send only' },
		sel_pb: { name: 'Selected playback number' },
		sel_level: { name: 'Selected playback fader (%)' },
		sel_flash: { name: 'Selected playback flash (on/off)' },
	}
	for (let n = 1; n <= FEEDBACK_PLAYBACKS; n++) {
		defs[`pb_${n}_level`] = { name: `Playback ${n} fader (%)` }
	}
	return defs
}

export function getKnobVariableValues(self) {
	const pb = selection(self).pb
	const values = {
		connection: self.connectionText(),
		sel_pb: String(pb),
		sel_level: formatLevel(self.playbackLevel(pb)),
		sel_flash: self.playbackFlash(pb) === 1 ? 'on' : 'off',
	}
	for (let n = 1; n <= FEEDBACK_PLAYBACKS; n++) {
		values[`pb_${n}_level`] = formatLevel(self.playbackLevel(n))
	}
	return values
}

// ---------- presets ----------

export function getKnobPresets(self) {
	const label = self.label || 'magicq'
	const v = (id) => `$(${label}:${id})`
	const white = combineRgb(255, 255, 255)
	const black = combineRgb(0, 0, 0)
	const dark = combineRgb(30, 30, 30)
	const blue = combineRgb(0, 90, 200)
	const green = combineRgb(0, 140, 0)
	const amber = combineRgb(230, 150, 0)
	const red = combineRgb(200, 0, 0)
	const presets = {}
	const button = (name, text, steps, feedbacks = [], size = '14') => ({
		type: 'simple',
		name,
		style: { text, size, color: white, bgcolor: dark },
		steps: [{ down: [], up: [], ...steps }],
		feedbacks,
	})
	const knob = (name, text, left, right, push) =>
		button(name, text, { rotate_left: [left], rotate_right: [right], down: push ? [push] : [] })
	const step = (actionId, extra, direction) => ({
		actionId,
		options: { ...extra, direction, size: DEFAULT_STEP_SIZE },
	})

	presets.sel_fader_knob = knob(
		'Knob: selected playback fader (push = Go)',
		`PB ${v('sel_pb')}\\n${v('sel_level')} %`,
		step('sel_fader_step', {}, 'down'),
		step('sel_fader_step', {}, 'up'),
		{ actionId: 'sel_go', options: {} },
	)
	presets.sel_fader_knob.feedbacks = [
		{ feedbackId: 'sel_above', options: { level: 0 }, style: { bgcolor: green, color: white } },
	]
	presets.sel_pick_knob = knob(
		'Knob: choose playback (1-10)',
		`PLAYBACK\\n${v('sel_pb')}`,
		{ actionId: 'sel_next', options: { direction: 'down', max: FEEDBACK_PLAYBACKS } },
		{ actionId: 'sel_next', options: { direction: 'up', max: FEEDBACK_PLAYBACKS } },
	)
	presets.pb1_knob = knob(
		'Knob: playback 1 fader (push = Go)',
		`PB 1\\n${v('pb_1_level')} %`,
		step('knob_pb_step', { pb: 1 }, 'down'),
		step('knob_pb_step', { pb: 1 }, 'up'),
		{ actionId: 'pbGo', options: { pbId: '1' } },
	)
	presets.pb1_knob.feedbacks = [
		{ feedbackId: 'pb_above', options: { pb: 1, level: 0 }, style: { bgcolor: green, color: white } },
	]

	presets.sel_go = button('GO on the selected playback', `GO\\nPB ${v('sel_pb')}`, {
		down: [{ actionId: 'sel_go', options: {} }],
	})
	presets.sel_go.style.bgcolor = combineRgb(0, 100, 0)
	presets.sel_pause = button('PAUSE on the selected playback', `PAUSE\\nPB ${v('sel_pb')}`, {
		down: [{ actionId: 'sel_pause', options: {} }],
	})
	presets.sel_release = button('RELEASE the selected playback', `REL\\nPB ${v('sel_pb')}`, {
		down: [{ actionId: 'sel_release', options: {} }],
	})
	presets.sel_flash = button(
		'FLASH the selected playback while held',
		`FLASH\\nPB ${v('sel_pb')}`,
		{
			down: [{ actionId: 'sel_flash', options: { mode: 'on' } }],
			up: [{ actionId: 'sel_flash', options: { mode: 'off' } }],
		},
		[{ feedbackId: 'sel_flash_on', options: {}, style: { bgcolor: amber, color: black } }],
	)
	presets.dbo = button(
		'DBO (desk black out) toggle',
		'DBO',
		{ down: [{ actionId: 'dbo_toggle', options: { mode: 'toggle' } }] },
		[{ feedbackId: 'dbo_on', options: {}, style: { bgcolor: red, color: white } }],
	)
	presets.swap = button(
		'Add / Swap toggle',
		'SWAP',
		{ down: [{ actionId: 'swap_toggle', options: { mode: 'toggle' } }] },
		[{ feedbackId: 'swap_on', options: {}, style: { bgcolor: amber, color: black } }],
	)
	presets.connected = button('MagicQ connected', 'MagicQ\\n' + v('connection'), {}, [
		{ feedbackId: 'console_online', options: {}, style: { bgcolor: green, color: white } },
	])

	const pbKeys = []
	for (let n = 1; n <= FEEDBACK_PLAYBACKS; n++) {
		const id = `pb_${n}_select`
		presets[id] = button(
			`Select playback ${n} (shows its level)`,
			`PB ${n}\\n${v(`pb_${n}_level`)} %`,
			{ down: [{ actionId: 'sel_select', options: { pb: n } }] },
			[
				{ feedbackId: 'pb_above', options: { pb: n, level: 0 }, style: { bgcolor: green, color: white } },
				{ feedbackId: 'sel_is', options: { pb: n }, style: { bgcolor: blue, color: white } },
			],
		)
		pbKeys.push(id)
	}

	const structure = [
		{
			id: 'knob_encoders',
			name: 'D200X knobs',
			definitions: ['sel_fader_knob', 'sel_pick_knob', 'pb1_knob'],
		},
		{
			id: 'knob_selected',
			name: 'Selected playback keys',
			definitions: ['sel_go', 'sel_pause', 'sel_release', 'sel_flash'],
		},
		{ id: 'knob_select', name: 'Choose playback 1-10', definitions: pbKeys },
		{ id: 'knob_console', name: 'Console', definitions: ['dbo', 'swap', 'connected'] },
	]
	return { structure, presets }
}
