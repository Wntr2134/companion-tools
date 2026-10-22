// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

/** { section, presets } for the API 2 preset structure. */
export function getViewerPresets(self: { label?: string }): { section: any; presets: Record<string, any> } {
	const label = self.label || 'digico'
	const v = (id: string): string => `$(${label}:${id})`
	const viewer = (name: string, text: string): any => ({
		type: 'simple',
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
		steps: [{ down: [], up: [] }],
		feedbacks: [],
	})
	const presets: Record<string, any> = {
		view_snap: viewer(
			'Snapshot: current and next',
			`SNAP ${v('snap_current_num')}  ${v('snap_current_name')}\\nNEXT ${v('snap_next_name')}`,
		),
		view_sel: viewer('Selected channel', `${v('sel_name')}\\n${v('sel_level')}`),
		view_console: viewer('Console', `${v('console_name')}\\n${v('connected')}`),
	}
	return { section: { id: 'viewers', name: 'Wide key viewers', definitions: Object.keys(presets) }, presets }
}
