// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
import { combineRgb } from '@companion-module/base'

const CATEGORY = 'Wide key viewers'
const WHITE = combineRgb(255, 255, 255)

export function getViewerPresets(self) {
	const label = self.label || 'apple-music-local'
	const v = (id) => `$(${label}:${id})`
	const viewer = (name, text, feedbacks = []) => ({
		type: 'button',
		category: CATEGORY,
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: combineRgb(20, 20, 22), show_topbar: false, alignment: 'left:center' },
		steps: [{ down: [], up: [] }],
		feedbacks,
	})
	// Album art behind the text, with a red progress bar (see artwork.js).
	const card = [{ feedbackId: 'now_playing_art', options: { shape: 'wide' } }]
	return {
		view_now: viewer('Now playing: album art, track, artist', `${v('card_line1')}\\n${v('card_line2')}`, card),
		view_time: viewer('Now playing + time', `${v('card_line1')}\\n${v('card_line2_time')}`, card),
		view_clock: viewer('Clock + now playing', `${v('clock')}\\n${v('card_track_or_date')}\\n${v('card_artist')}`, card),
	}
}

/** Defaults for what the viewers show when nothing is playing (editable in the connection's settings). */
export const IDLE_DEFAULTS = {
	idle1: '$(internal:time_hm)',
	idle2: '$(internal:date_weekday) $(internal:date_d) $(internal:date_monthname)',
}

/**
 * The text the viewers show. While a track is loaded (playing or paused): the track. When the app is
 * closed or stopped: the idle lines (a clock and date unless changed), so the key never goes blank.
 */
export function cardLines(state, idle) {
	const hasTrack = !!(state.running && state.track)
	if (hasTrack) {
		return {
			card_line1: state.track,
			card_line2: state.artist ?? '',
			card_line2_time: state.time ? `${state.artist ?? ''}  ·  ${state.time}` : state.artist ?? '',
			card_track_or_date: state.track,
			card_artist: state.artist ?? '',
		}
	}
	return {
		card_line1: idle.line1,
		card_line2: idle.line2,
		card_line2_time: idle.line2,
		card_track_or_date: idle.line2,
		card_artist: '',
	}
}
