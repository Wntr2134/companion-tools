// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const CATEGORY = 'Wide key viewers'
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

export function getViewerPresets(self) {
	const label = self.label || 'ndi-studio-monitor'
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
		view_monitor: viewer('Showing now + recording', `MONITOR: ${v('source')}\\nPiP: ${v('overlay')}\\n${v('recording')} ${v('rec_time')}`, [
			{ feedbackId: 'recording', options: {}, style: { bgcolor: combineRgb(150, 0, 0), color: WHITE } },
		]),
	}
}
