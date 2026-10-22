// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const CATEGORY = 'Wide key viewers'
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

export function getViewerPresets(self) {
	const label = self.label || 'grandma2-plus'
	const v = (id) => `$(${label}:${id})`
	const viewer = (name, text, feedbacks = []) => ({
		type: 'button',
		category: CATEGORY,
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: BLACK },
		steps: [{ down: [], up: [] }],
		feedbacks,
	})
	return {
		view_exec: viewer('Selected executor: cue and next', `${v('sel_label')} ${v('sel_name')}\\n${v('sel_cue')}\\nNEXT ${v('sel_next')}`),
		view_level: viewer('Selected executor + level', `${v('sel_label')} ${v('sel_name')}\\n${v('sel_level')}%`),
	}
}
