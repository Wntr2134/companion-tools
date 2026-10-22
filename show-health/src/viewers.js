// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const CATEGORY = 'Wide key viewers'
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

export function getViewerPresets(self) {
	const label = self.label || 'show-health'
	const v = (id) => `$(${label}:${id})`
	const viewer = (name, text, feedbacks = []) => ({
		type: 'button',
		category: CATEGORY,
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: BLACK },
		steps: [{ down: [], up: [] }],
		feedbacks,
	})
	const status = [
		{ feedbackId: 'all_ok', options: {}, style: { bgcolor: combineRgb(0, 70, 30), color: WHITE } },
		{ feedbackId: 'any_down', options: {}, style: { bgcolor: combineRgb(150, 0, 0), color: WHITE } },
	]
	return {
		view_clock: viewer('Clock (time and date)', '$(internal:time_hms)\\n$(internal:date_weekday) $(internal:date_d) $(internal:date_monthname)'),
		view_clock_big: viewer('Clock (HH:MM, big)', '$(internal:time_hm)'),
		view_clock_status: viewer('Clock + show status', `$(internal:time_hm)\\n${v('summary')}`, status),
		view_down: viewer("Show status: what's down", `${v('summary')}\\n${v('down_list')}`, status),
	}
}
