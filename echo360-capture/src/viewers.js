// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const CATEGORY = 'Wide key viewers'
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

export function getViewerPresets(self) {
	const label = self.label || 'echo360-capture'
	const v = (id) => `$(${label}:${id})`
	const viewer = (name, text, feedbacks = []) => ({
		type: 'button',
		category: CATEGORY,
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: BLACK },
		steps: [{ down: [], up: [] }],
		feedbacks,
	})
	const rec = [
		{ feedbackId: 'recording', options: {}, style: { bgcolor: combineRgb(150, 0, 0), color: WHITE } },
		{ feedbackId: 'paused', options: {}, style: { bgcolor: combineRgb(160, 110, 0), color: BLACK } },
	]
	return {
		view_rec: viewer('Recording: state, time, title', `${v('room')} ${v('state_label')}\\n${v('elapsed')}   ${v('remaining')} left\\n${v('title')}`, rec),
		view_next: viewer('Next class', `NEXT ${v('next_start')} (${v('next_in')})\\n${v('next_title')}`),
	}
}
