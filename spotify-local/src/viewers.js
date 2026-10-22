// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const CATEGORY = 'Wide key viewers'
const WHITE = combineRgb(255, 255, 255)

export function getViewerPresets(self) {
	const label = self.label || 'spotify-local'
	const v = (id) => `$(${label}:${id})`
	const viewer = (name, text, feedbacks = []) => ({
		type: 'button',
		category: CATEGORY,
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: combineRgb(18, 18, 18), show_topbar: false, alignment: 'left:center' },
		steps: [{ down: [], up: [] }],
		feedbacks,
	})
	// Album art behind the text, with a green progress bar (see artwork.js).
	const card = [{ feedbackId: 'now_playing_art', options: {} }]
	return {
		view_now: viewer('Now playing: album art, track, artist', `${v('track')}\\n${v('artist')}`, card),
		view_time: viewer('Now playing + time', `${v('track')}\\n${v('artist')}  ·  ${v('time')}`, card),
		view_clock: viewer('Clock + now playing', `$(internal:time_hm)\\n${v('track')}\\n${v('artist')}`, card),
	}
}
