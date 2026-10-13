// Presets, laid out for the Ulanzi D200X (13 keys + 3 knobs). On the D200X a knob's turn and
// push are separate buttons (row 3 = turn, row 4 = push), so each knob has a turn preset and
// push presets to choose from. The turn presets also carry the push on key down, for surfaces
// where turn and push are the same button (Stream Deck +).
import { COLOURS } from './feedbacks.js'
import { DEFAULT_STEP_SIZE } from './console.js'

const sel = { which: 'selected', exec: 1, page: 0 }
const nxt = { which: 'next', exec: 1, page: 0 }
const fixed = (n) => ({ which: 'fixed', exec: n, page: 0 })

export function getPresets(self) {
	const v = (id) => `$(${self.label || 'grandma2-plus'}:${id})`
	const presets = {}
	const style = (text, size = '14') => ({ text, size, color: COLOURS.white, bgcolor: COLOURS.dark })
	const key = (id, category, name, text, down, up = [], feedbacks = [], size) => {
		presets[id] = { type: 'button', category, name, style: style(text, size), steps: [{ down, up }], feedbacks }
	}
	const knob = (id, category, name, text, left, right, push = []) => {
		presets[id] = {
			type: 'button',
			category,
			name,
			options: { rotaryActions: true },
			style: style(text),
			steps: [{ down: push, up: [], rotate_left: [left], rotate_right: [right] }],
			feedbacks: [],
		}
	}
	const step = (actionId, options, direction) => ({ actionId, options: { ...options, direction, size: DEFAULT_STEP_SIZE } })
	const running = (o) => ({ feedbackId: 'exec_running', options: o, style: { bgcolor: COLOURS.green, color: COLOURS.white } })

	// ----- knobs -----
	const K = 'D200X: knobs'
	knob(
		'knob_sel_fader',
		K,
		'Knob 1 turn: selected executor fader',
		`${v('sel_name')}\\n${v('sel_level')}%`,
		step('exec_fader_step', sel, 'down'),
		step('exec_fader_step', sel, 'up'),
		[{ actionId: 'exec_go', options: sel }],
	)
	presets.knob_sel_fader.feedbacks = [running(sel)]
	key('push_sel_go', K, 'Knob 1 push: Go+ (selected executor)', `GO+\\n${v('sel_next')}`, [{ actionId: 'exec_go', options: sel }], [], [running(sel)])
	key(
		'push_sel_flash',
		K,
		'Knob 1 push: Flash while held (selected executor)',
		`FLASH\\n${v('sel_name')}`,
		[{ actionId: 'exec_flash', options: { ...sel, state: 'press', via: 'telnet' } }],
		[{ actionId: 'exec_flash', options: { ...sel, state: 'release', via: 'telnet' } }],
	)
	key('push_sel_zero', K, 'Knob 1 push: fader to 0 / back (selected executor)', `0 / BACK\\n${v('sel_name')}`, [
		{ actionId: 'exec_fader_toggle', options: sel },
	])
	knob(
		'knob_next_fader',
		K,
		'Knob 2 turn: fader of the executor after the selected one',
		`${v('nxt_name')}\\n${v('nxt_level')}%`,
		step('exec_fader_step', nxt, 'down'),
		step('exec_fader_step', nxt, 'up'),
		[{ actionId: 'select_step', options: { direction: 'up' } }],
	)
	presets.knob_next_fader.feedbacks = [running(nxt)]
	key('push_next_select', K, 'Knob 2 push: select the next executor', `SELECT\\n${v('nxt_name')}`, [{ actionId: 'select_step', options: { direction: 'up' } }])
	knob('knob_gm', K, 'Knob 3 turn: grand master', `GM\\n${v('gm_level')}%`, step('gm_step', {}, 'down'), step('gm_step', {}, 'up'), [
		{ actionId: 'page_step', options: { direction: 'up', console: 'FaderPage' } },
	])
	key('push_page_next', K, 'Knob 3 push: next page', `PAGE +\\n${v('page')}`, [{ actionId: 'page_step', options: { direction: 'up', console: 'FaderPage' } }])
	knob(
		'knob_select',
		K,
		'Knob: choose the selected executor',
		`SELECT\\n${v('sel_name')}`,
		{ actionId: 'select_step', options: { direction: 'down' } },
		{ actionId: 'select_step', options: { direction: 'up' } },
	)
	knob(
		'knob_page',
		K,
		'Knob: page',
		`PAGE\\n${v('page')}`,
		{ actionId: 'page_step', options: { direction: 'down', console: 'FaderPage' } },
		{ actionId: 'page_step', options: { direction: 'up', console: 'FaderPage' } },
	)

	// ----- keys for the selected executor -----
	const S = 'D200X: selected executor keys'
	key('sel_prev', S, 'Previous executor', `◀\\n${v('sel_name')}`, [{ actionId: 'select_step', options: { direction: 'down' } }])
	key('sel_next', S, 'Next executor', `${v('sel_name')}\\n▶`, [{ actionId: 'select_step', options: { direction: 'up' } }])
	key('sel_go', S, 'Go+ (shows the next cue)', `GO+\\n${v('sel_next')}`, [{ actionId: 'exec_go', options: sel }], [], [running(sel)])
	key('sel_goback', S, 'Go-', `GO-\\n${v('sel_prev')}`, [{ actionId: 'exec_goback', options: sel }])
	key('sel_pause', S, 'Pause (lit while running)', `PAUSE\\n${v('sel_cue')}`, [{ actionId: 'exec_pause', options: sel }], [], [running(sel)])
	key(
		'sel_flash',
		S,
		'Flash (while held)',
		'FLASH',
		[{ actionId: 'exec_flash', options: { ...sel, state: 'press', via: 'telnet' } }],
		[{ actionId: 'exec_flash', options: { ...sel, state: 'release', via: 'telnet' } }],
		[],
		'18',
	)
	key(
		'sel_temp',
		S,
		'Temp (while held)',
		'TEMP',
		[{ actionId: 'exec_temp', options: { ...sel, state: 'press', via: 'telnet' } }],
		[{ actionId: 'exec_temp', options: { ...sel, state: 'release', via: 'telnet' } }],
		[],
		'18',
	)
	key('sel_off', S, 'Off', `OFF\\n${v('sel_name')}`, [{ actionId: 'exec_off', options: sel }])
	key('sel_top', S, 'Top (first cue)', 'TOP', [{ actionId: 'exec_top', options: sel }], [], [], '18')
	key('sel_info', S, 'Selected executor: name, level and current cue', `${v('sel_label')} ${v('sel_level')}%\\n${v('sel_cue')}`, [], [], [running(sel)])
	key(
		'status',
		S,
		'Connection status (green = Telnet up)',
		`MA2\\n${v('telnet')}`,
		[],
		[],
		[{ feedbackId: 'connected', options: { link: 'telnet' }, style: { bgcolor: COLOURS.green, color: COLOURS.white } }],
	)

	// ----- quick-select and per-executor keys -----
	for (const n of self.ma.execs) {
		const f = fixed(n)
		const cat = `Executor ${n}`
		key(
			`q_${n}`,
			'Quick select',
			`Select executor ${n}`,
			`${v(`exec_${n}_name`)}\\n${v(`exec_${n}_level`)}%`,
			[{ actionId: 'select_exec', options: { exec: n } }],
			[],
			[running(f), { feedbackId: 'exec_selected', options: { exec: n }, style: { bgcolor: COLOURS.blue, color: COLOURS.white } }],
		)
		key(`go_${n}`, cat, `Go+ executor ${n}`, `GO+ ${v(`exec_${n}_name`)}\\n${v(`exec_${n}_next`)}`, [{ actionId: 'exec_go', options: f }], [], [running(f)])
		key(
			`flash_${n}`,
			cat,
			`Flash executor ${n} while held`,
			`FLASH\\n${v(`exec_${n}_name`)}`,
			[{ actionId: 'exec_flash', options: { ...f, state: 'press', via: 'telnet' } }],
			[{ actionId: 'exec_flash', options: { ...f, state: 'release', via: 'telnet' } }],
		)
		knob(
			`knob_${n}`,
			cat,
			`Fader knob, executor ${n} (push = to 0 / back)`,
			`${v(`exec_${n}_name`)}\\n${v(`exec_${n}_level`)}%`,
			step('exec_fader_step', f, 'down'),
			step('exec_fader_step', f, 'up'),
			[{ actionId: 'exec_fader_toggle', options: f }],
		)
		presets[`knob_${n}`].feedbacks = [running(f)]
	}
	return presets
}
