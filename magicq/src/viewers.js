// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

/** { section, presets } for the API 2 preset structure. */
export function getViewerPresets(self) {
	const label = self.label || 'magicq'
	const v = (id) => `$(${label}:${id})`
	const viewer = (name, text) => ({
		type: 'simple',
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: BLACK },
		steps: [{ down: [], up: [] }],
		feedbacks: [],
	})
	const presets = {
		view_sel: viewer('Selected playback + level', `PLAYBACK ${v('sel_pb')}\\n${v('sel_level')}`),
		view_conn: viewer('MagicQ connection', `MAGICQ\\n${v('connection')}`),
	}
	return { section: { id: 'viewers', name: 'Wide key viewers', definitions: Object.keys(presets) }, presets }
}
