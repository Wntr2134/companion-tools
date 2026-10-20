// Actions. The first five keep the upstream module's ids and options (command, button, wheel,
// encoder, encoder_p) so buttons made with it carry across, with their bugs fixed.
import * as CHOICES from './choices.js'
import { DEFAULT_STEP_SIZE, PERCENT_STEPS, STEP_SIZES } from './console.js'

const ENCODER_CHOICES = CHOICES.ENCODER.map((e, i) => ({ id: i, label: `${e} (${i + 1})` }))
const BUTTON_IDS = new Set(CHOICES.BUTTON.map((b) => Number(b.id)))

export const sizeOption = {
	type: 'dropdown',
	id: 'size',
	label: 'Step size',
	default: DEFAULT_STEP_SIZE,
	choices: STEP_SIZES.map((n, i) => ({
		id: n,
		label: `${n}: ${PERCENT_STEPS[i]} % per click${n === DEFAULT_STEP_SIZE ? ' (default)' : n === 1 ? ' (smoothest)' : ''}`,
	})),
	tooltip: '% per click: 1, 2, 3, 4, 5, 6, 8, 10, 15, 20',
}

export const directionOption = {
	type: 'dropdown',
	id: 'direction',
	label: 'Direction',
	default: 'up',
	choices: [
		{ id: 'up', label: 'Up (rotate right)' },
		{ id: 'down', label: 'Down (rotate left)' },
	],
}

/** Which executor: the selected one, the one after it, or a fixed number. */
export function executorOptions(defaultWhich = 'fixed') {
	return [
		{
			type: 'dropdown',
			id: 'which',
			label: 'Executor',
			default: defaultWhich,
			choices: [
				{ id: 'selected', label: 'Selected executor' },
				{ id: 'next', label: 'Executor after the selected one' },
				{ id: 'fixed', label: 'This executor number' },
			],
		},
		{
			type: 'number',
			id: 'exec',
			label: 'Executor number',
			default: 1,
			min: 1,
			max: 999,
			isVisibleExpression: `$(options:which) == 'fixed'`,
		},
		{
			type: 'number',
			id: 'page',
			label: 'Page (0 = the current page)',
			default: 0,
			min: 0,
			max: 9999,
		},
	]
}

const pressOption = {
	type: 'dropdown',
	id: 'state',
	label: 'Key',
	default: 'press',
	choices: [
		{ id: 'press', label: 'Press (put on key down)' },
		{ id: 'release', label: 'Release (put on key up)' },
	],
}

const viaOption = {
	type: 'dropdown',
	id: 'via',
	label: 'How',
	default: 'telnet',
	choices: [
		{ id: 'telnet', label: 'Command (On on press, Off on release)' },
		{ id: 'button1', label: 'Web Remote: hold executor button 1' },
		{ id: 'button2', label: 'Web Remote: hold executor button 2' },
		{ id: 'button3', label: 'Web Remote: hold executor button 3' },
	],
	tooltip:
		'The Web Remote options press the real executor button, so it does whatever that button is set to on the console. Use the one set to Flash (or Temp). Without the Web Remote it falls back to the command.',
}

const pageKeywordOption = {
	type: 'dropdown',
	id: 'console',
	label: 'Also change the console',
	default: 'FaderPage',
	choices: [
		{ id: 'FaderPage', label: 'Fader page (FaderPage n)' },
		{ id: 'ButtonPage', label: 'Button page (ButtonPage n)' },
		{ id: 'Page', label: 'Page (Page n)' },
		{ id: 'none', label: "No: only this module's page" },
	],
}

const int = (v) => {
	const n = Math.round(Number(v))
	return Number.isFinite(n) ? n : NaN
}

export function getActions(self) {
	const ma = self.ma
	const target = (o) => {
		const t = ma.resolve(o)
		if (!t) self.log('warn', 'Executor number not valid: nothing sent')
		return t
	}
	const execAction = (name, verb, description) => ({
		name,
		description,
		options: executorOptions('selected'),
		callback: async (a) => ma.execCommand(verb, target(a.options)),
	})
	const lua = (code) => ma.command(`LUA '${code}'`)

	return {
		// ----- upstream actions (same ids) -----
		command: {
			name: 'Run custom command',
			description: 'Any grandMA2 command line. Sent once; never repeated if the connection is down.',
			options: [{ type: 'textinput', id: 'command', label: 'Command', default: '', useVariables: true }],
			callback: async (a, ctx) => {
				const text = await ctx.parseVariablesInString(String(a.options.command ?? ''))
				ma.command(text)
			},
		},
		button: {
			name: 'Console key press / release',
			options: [
				{ type: 'dropdown', id: 'button', label: 'Key', default: '11', choices: CHOICES.BUTTON },
				{ type: 'dropdown', id: 'dir', label: 'Direction', default: 'true', choices: CHOICES.DOWN_UP },
			],
			callback: async (a) => {
				const key = int(a.options.button)
				if (!BUTTON_IDS.has(key)) return self.log('warn', `Unknown key ${a.options.button}`)
				lua(`gma.canbus.hardkey(${key}, ${a.options.dir === 'false' || a.options.dir === false ? 'false' : 'true'}, false)`)
			},
		},
		wheel: {
			name: 'Move wheel up / down',
			options: [
				{
					type: 'textinput',
					id: 'steps',
					label: 'Steps to move wheel (+/-)',
					tooltip: 'Negative numbers move down',
					default: '1',
					useVariables: true,
				},
			],
			callback: async (a, ctx) => {
				const steps = int(await ctx.parseVariablesInString(String(a.options.steps ?? '')))
				if (!Number.isFinite(steps) || steps === 0) return self.log('warn', 'Wheel: steps must be a whole number')
				lua(`gma.canbus.wheel(${steps})`)
			},
		},
		encoder: {
			name: 'Rotate console encoder',
			options: [
				{ type: 'checkbox', id: 'encoder_from_variable', label: 'Use variable for encoder', default: false },
				{ type: 'dropdown', id: 'enc', label: 'Encoder', default: 0, choices: ENCODER_CHOICES, isVisibleExpression: '!$(options:encoder_from_variable)' },
				{
					type: 'textinput',
					id: 'encoder_variable',
					label: 'Encoder number (1-8)',
					default: '1',
					useVariables: true,
					isVisibleExpression: '$(options:encoder_from_variable)',
				},
				{ type: 'dropdown', id: 'dir', label: 'Direction', default: '1', choices: CHOICES.DIRECTION },
				{ type: 'number', id: 'steps', label: 'Steps', tooltip: 'How far per click', default: 1, min: 1, max: 100 },
			],
			callback: async (a, ctx) => {
				const enc = await encoderIndex(a.options, ctx)
				if (enc === null) return self.log('warn', 'Encoder number must be 1-8')
				const dir = int(a.options.dir) === -1 ? -1 : 1 // missing direction (old bug) = clockwise
				const steps = Math.min(100, Math.max(1, int(a.options.steps) || 1))
				lua(`gma.canbus.encoder(${enc}, ${dir * steps}, nil)`)
			},
		},
		encoder_p: {
			name: 'Console encoder press / release',
			options: [
				{ type: 'checkbox', id: 'encoder_from_variable', label: 'Use variable for encoder', default: false },
				{ type: 'dropdown', id: 'enc', label: 'Encoder', default: 0, choices: ENCODER_CHOICES, isVisibleExpression: '!$(options:encoder_from_variable)' },
				{
					type: 'textinput',
					id: 'encoder_variable',
					label: 'Encoder number (1-8)',
					default: '1',
					useVariables: true,
					isVisibleExpression: '$(options:encoder_from_variable)',
				},
				{ type: 'dropdown', id: 'dir', label: 'Direction', default: 'true', choices: CHOICES.DOWN_UP },
			],
			callback: async (a, ctx) => {
				const enc = await encoderIndex(a.options, ctx)
				if (enc === null) return self.log('warn', 'Encoder number must be 1-8')
				lua(`gma.canbus.encoder(${enc}, nil, ${a.options.dir === 'false' || a.options.dir === false ? 'false' : 'true'})`)
			},
		},

		// ----- executor keys -----
		exec_go: execAction('Executor: Go+', 'go', 'Sent once. If the connection is down it is dropped, never repeated (a repeated Go would skip a cue).'),
		exec_goback: execAction('Executor: Go-', 'goback'),
		exec_pause: execAction('Executor: Pause', 'pause'),
		exec_off: execAction('Executor: Off', 'off'),
		exec_on: execAction('Executor: On', 'on'),
		exec_toggle: execAction('Executor: Toggle', 'toggle'),
		exec_top: execAction('Executor: Top (back to the first cue)', 'top'),
		exec_goto: {
			name: 'Executor: Goto cue',
			options: [...executorOptions('selected'), { type: 'number', id: 'cue', label: 'Cue', default: 1, min: 0, max: 9999, step: 0.001 }],
			callback: async (a) => ma.gotoCue(target(a.options), a.options.cue),
		},
		exec_flash: {
			name: 'Executor: Flash (momentary)',
			description: 'Put Press on key down and Release on key up.',
			options: [...executorOptions('selected'), pressOption, viaOption],
			callback: async (a) => ma.momentary('flash', target(a.options), a.options.state !== 'release', a.options.via),
		},
		exec_temp: {
			name: 'Executor: Temp (momentary)',
			description: 'Put Press on key down and Release on key up.',
			options: [...executorOptions('selected'), pressOption, viaOption],
			callback: async (a) => ma.momentary('temp', target(a.options), a.options.state !== 'release', a.options.via),
		},
		exec_button: {
			name: 'Executor: hold button 1-3 (Web Remote)',
			description: 'Presses the real executor button, like a finger on the console. Needs the Web Remote. Put Press on key down and Release on key up.',
			options: [
				...executorOptions('selected'),
				{ type: 'dropdown', id: 'button', label: 'Executor button', default: 1, choices: [1, 2, 3].map((n) => ({ id: n, label: `Button ${n}` })) },
				pressOption,
			],
			callback: async (a) => ma.execButton(target(a.options), a.options.button, a.options.state !== 'release'),
		},

		// ----- knobs -----
		exec_fader_step: {
			name: 'Executor: fader step (knob)',
			description: 'One step per click; fast turns count every click. Put Up on Rotate right and Down on Rotate left.',
			options: [...executorOptions('selected'), directionOption, sizeOption],
			callback: async (a) => ma.stepFader(target(a.options), a.options),
		},
		exec_fader_set: {
			name: 'Executor: fader set',
			options: [...executorOptions('selected'), { type: 'number', id: 'level', label: 'Level (%)', default: 100, min: 0, max: 100 }],
			callback: async (a) => ma.setFader(target(a.options), a.options.level),
		},
		exec_fader_toggle: {
			name: 'Executor: fader to 0 / back (knob push)',
			description: 'Takes the fader to 0, or back to where it was (full if unknown).',
			options: executorOptions('selected'),
			callback: async (a) => ma.toggleFader(target(a.options)),
		},
		gm_step: {
			name: 'Grand master: step (knob)',
			options: [directionOption, sizeOption],
			callback: async (a) => ma.stepGrandMaster(a.options),
		},
		gm_set: {
			name: 'Grand master: set',
			options: [{ type: 'number', id: 'level', label: 'Level (%)', default: 100, min: 0, max: 100 }],
			callback: async (a) => ma.setGrandMaster(a.options.level),
		},
		page_step: {
			name: 'Page: next / previous (knob or key)',
			options: [
				{
					...directionOption,
					choices: [
						{ id: 'up', label: 'Next' },
						{ id: 'down', label: 'Previous' },
					],
				},
				pageKeywordOption,
			],
			callback: async (a) => ma.pageStep(a.options.direction, a.options.console),
		},
		page_set: {
			name: 'Page: go to',
			options: [{ type: 'number', id: 'page', label: 'Page', default: 1, min: 1, max: 9999 }, pageKeywordOption],
			callback: async (a) => ma.setPage(a.options.page, a.options.console),
		},

		// ----- selection -----
		select_exec: {
			name: 'Selected executor: choose',
			description: 'The knobs and keys set to "Selected executor" then work on this one.',
			options: [{ type: 'number', id: 'exec', label: 'Executor number', default: 1, min: 1, max: 999 }],
			callback: async (a) => ma.select(a.options.exec),
		},
		select_step: {
			name: 'Selected executor: next / previous (knob or key)',
			description: 'Steps through the executors listed in the connection settings.',
			options: [
				{
					...directionOption,
					choices: [
						{ id: 'up', label: 'Next' },
						{ id: 'down', label: 'Previous' },
					],
				},
			],
			callback: async (a) => ma.selectStep(a.options.direction),
		},
	}
}

async function encoderIndex(options, ctx) {
	if (!options.encoder_from_variable) {
		const n = int(options.enc)
		return n >= 0 && n <= 7 ? n : null
	}
	const n = int(await ctx.parseVariablesInString(String(options.encoder_variable ?? '')))
	return Number.isFinite(n) ? Math.min(7, Math.max(0, n - 1)) : null
}
