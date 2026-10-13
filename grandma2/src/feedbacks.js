// On/off feedbacks. Running and level come from the Web Remote; without it, level is what this
// module last sent and running is never on.
import { combineRgb } from '@companion-module/base'
import { executorOptions } from './actions.js'

export const COLOURS = {
	white: combineRgb(255, 255, 255),
	black: combineRgb(0, 0, 0),
	dark: combineRgb(30, 30, 30),
	green: combineRgb(0, 150, 0),
	amber: combineRgb(230, 150, 0),
	blue: combineRgb(0, 90, 200),
	red: combineRgb(200, 0, 0),
}

export function getFeedbacks(self) {
	const ma = self.ma
	const info = (o) => {
		const t = ma.resolve(o)
		return t ? ma.info(t.exec, t.page) : null
	}
	return {
		exec_running: {
			type: 'boolean',
			name: 'Executor running',
			description: 'Needs the Web Remote.',
			defaultStyle: { bgcolor: COLOURS.green, color: COLOURS.white },
			options: executorOptions('selected'),
			callback: (fb) => Boolean(info(fb.options)?.running),
		},
		exec_level_above: {
			type: 'boolean',
			name: 'Executor fader above a level',
			defaultStyle: { bgcolor: COLOURS.amber, color: COLOURS.black },
			options: [...executorOptions('selected'), { type: 'number', id: 'level', label: 'Above (%)', default: 0, min: 0, max: 100 }],
			callback: (fb) => {
				const l = Number(info(fb.options)?.level)
				return Number.isFinite(l) && l > Number(fb.options.level ?? 0)
			},
		},
		exec_full: {
			type: 'boolean',
			name: 'Executor fader at full',
			defaultStyle: { bgcolor: COLOURS.amber, color: COLOURS.black },
			options: executorOptions('selected'),
			callback: (fb) => Number(info(fb.options)?.level) >= 99.95,
		},
		exec_selected: {
			type: 'boolean',
			name: 'Executor is the selected one',
			defaultStyle: { bgcolor: COLOURS.blue, color: COLOURS.white },
			options: [{ type: 'number', id: 'exec', label: 'Executor number', default: 1, min: 1, max: 999 }],
			callback: (fb) => ma.selected === Math.round(Number(fb.options.exec)),
		},
		connected: {
			type: 'boolean',
			name: 'Connected',
			defaultStyle: { bgcolor: COLOURS.green, color: COLOURS.white },
			options: [
				{
					type: 'dropdown',
					id: 'link',
					label: 'Link',
					default: 'telnet',
					choices: [
						{ id: 'telnet', label: 'Telnet (commands)' },
						{ id: 'webremote', label: 'Web Remote (readback)' },
						{ id: 'both', label: 'Both' },
					],
				},
			],
			callback: (fb) => {
				const l = fb.options.link
				if (l === 'webremote') return ma.wr.ok
				if (l === 'both') return ma.telnet.ok && ma.wr.ok
				return ma.telnet.ok
			},
		},
	}
}
