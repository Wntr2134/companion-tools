// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const CATEGORY = 'Wide key viewers'
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

export function getViewerPresets(self) {
	const label = self.label || 'uad-console'
	const v = (id) => `$(${label}:${id})`
	const viewer = (name, text, feedbacks = []) => ({
		type: 'button',
		category: CATEGORY,
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
		steps: [{ down: [], up: [] }],
		feedbacks,
	})
	return {
		view_monitor: viewer('Monitor level', `MONITOR\\n${v('mon_1_level')} dB`),
		view_selected: viewer('Selected channel + meter', `${v('sel_name')}\\n${v('sel_level')} dB\\n${v('sel_meterbar')}`),
		view_both: viewer('Monitor + selected channel', `MON ${v('mon_1_level')} dB\\n${v('sel_name')}  ${v('sel_level')} dB`),
	}
}
