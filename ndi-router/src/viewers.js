// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const CATEGORY = 'Wide key viewers'
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

export function getViewerPresets(self) {
	const label = self.label || 'ndi-router'
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
		view_routes: viewer('Routes: what each shows', `${v('route_1_name')}: ${v('route_1_source')}\\n${v('route_2_name')}: ${v('route_2_source')}`),
		view_vi: viewer('NDI Virtual Input (Mac)', `VIRTUAL INPUT\\n${v('vi_source')}`),
	}
}
