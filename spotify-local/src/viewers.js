// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const CATEGORY = 'Wide key viewers'
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

export function getViewerPresets(self) {
	const label = self.label || 'spotify-local'
	const v = (id) => `$(${label}:${id})`
	const viewer = (name, text, feedbacks = []) => ({
		type: 'button',
		category: CATEGORY,
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: BLACK },
		steps: [{ down: [], up: [] }],
		feedbacks,
	})
	const playing = [{ feedbackId: 'playing', options: {}, style: { bgcolor: combineRgb(0, 70, 30), color: WHITE } }]
	return {
		view_now: viewer('Now playing (track, artist, time)', `${v('track')}\\n${v('artist')}\\n${v('time')}`, playing),
		view_clock: viewer('Clock + now playing', `$(internal:time_hm)  ${v('play_icon')}\\n${v('track')}\\n${v('artist')}`, playing),
		view_vol: viewer('Track + volume + time left', `${v('track')}\\nVOL ${v('volume')}%   ${v('remaining')}`, playing),
	}
}
