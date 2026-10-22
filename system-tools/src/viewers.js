// "Wide key viewers": display-only presets made for the D200X's double-width key (row 2, col 3),
// that still read on a normal 72 px key (short lines, auto text size). No actions: they just show.
// System Tools' clock is a good "nothing else to show" key, and its variables can be the idle lines
// of the Spotify and Apple Music viewers.
import { combineRgb } from '@companion-module/base'

const CATEGORY = 'Wide key viewers'
const WHITE = combineRgb(255, 255, 255)

export function getViewerPresets(self) {
	const label = self.label || 'system-tools'
	const v = (id) => `$(${label}:${id})`
	const viewer = (name, text, feedbacks = []) => ({
		type: 'button',
		category: CATEGORY,
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: combineRgb(24, 26, 30), show_topbar: false, alignment: 'left:center' },
		steps: [{ down: [], up: [] }],
		feedbacks,
	})
	return {
		view_clock: viewer('Clock and date', `${v('clock')}\\n${v('date')}`),
		view_clock_system: viewer('Clock + CPU and memory', `${v('clock')}  ${v('date_short')}\\n${v('cpu_memory')}`),
		view_system: viewer('CPU, memory, disk and battery', `${v('cpu_memory')}\\n${v('disk_battery')}`),
		view_network: viewer('IP address and uptime', `${v('ip')}\\nUp ${v('uptime')}`),
		view_sound: viewer('Volume and keep awake', `VOL ${v('volume')}  ${v('muted')}\\nAwake: ${v('keep_awake')}`, [
			{ feedbackId: 'keep_awake', options: {}, style: { bgcolor: combineRgb(120, 80, 0) } },
		]),
	}
}
