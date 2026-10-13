// Actions, feedbacks, variables and presets for the Echo360 Capture module.
import { combineRgb } from '@companion-module/base'
import { STATE_LABELS } from './echo-client.js'
import { UC_DEFAULT_APP } from './uc-keys.js'

export const DEBOUNCE_MS = 1500
export const ERROR_HOLD_MS = 10_000
export const DEFAULT_MINUTES = 60
export const DEFAULT_TITLE = 'Ad hoc capture $(internal:date_y)-$(internal:date_m)-$(internal:date_d) $(internal:time_hm)'
export const UC_CATEGORY = 'Universal Capture (no status)'

/** True when the module is set to Universal Capture keyboard shortcuts (no device, no status). */
export const isUC = (self) => self.config?.device === 'uc'

/** Send a Universal Capture shortcut. Refused (with a message) when the module is in device mode. */
export async function ucKey(self, name) {
	if (!isUC(self)) {
		self.client.refuse('Universal Capture shortcuts: set Device type to "Universal Capture on this Mac" first. Nothing sent')
		return { sent: false, reason: 'mode' }
	}
	return self.uc.send(name, { activate: self.config.ucActivate !== false, appName: self.config.ucApp || UC_DEFAULT_APP })
}

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARK = combineRgb(25, 25, 25)
const GREY = combineRgb(70, 70, 70)
const DIM_TEXT = combineRgb(120, 120, 120)
const RED = combineRgb(200, 0, 0)
const AMBER = combineRgb(230, 150, 0)
const MAGENTA = combineRgb(170, 0, 170)
const GREEN = combineRgb(0, 120, 40)

// ---------- formatting ----------

const pad = (n) => String(n).padStart(2, '0')

/** Seconds as HH:MM:SS ('' when unknown). */
export function hms(sec) {
	if (sec === undefined || !Number.isFinite(sec)) return ''
	const s = Math.max(0, Math.floor(sec))
	return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** Local clock time, 24 hour, with the weekday when it isn't today. */
export function clockTime(ms, now = Date.now()) {
	if (ms === undefined || !Number.isFinite(ms)) return ''
	const d = new Date(ms)
	const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`
	return d.toDateString() === new Date(now).toDateString() ? t : `${d.toLocaleDateString('en-AU', { weekday: 'short' })} ${t}`
}

/** "now", "12m", "1h 05m", "2d 3h". */
export function untilText(sec) {
	if (sec === undefined || !Number.isFinite(sec)) return ''
	if (sec <= 0) return 'now'
	const m = Math.ceil(sec / 60)
	if (m < 60) return `${m}m`
	if (m < 48 * 60) return `${Math.floor(m / 60)}h ${pad(m % 60)}m`
	return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
}

// ---------- guarded commands ----------

/** Ignore a repeat of the same control within 1.5 s (a double tap). Returns true when it's a repeat. */
function debounced(self, key) {
	self.lastPress ??= new Map()
	const now = Date.now()
	const last = self.lastPress.get(key)
	if (last !== undefined && now - last < DEBOUNCE_MS) return true
	self.lastPress.set(key, now)
	return false
}

/** State is usable for a decision only when it's known and recent. */
function freshState(self) {
	const c = self.client
	if (!c.connected || !c.state) return undefined
	const limit = 2 * c.pollMs + (c.timing?.requestTimeoutMs ?? 3000)
	return c.stateAge() > limit ? undefined : c.state
}

/** Run one control: debounce, check the state allows it, send exactly one request (or none). */
async function guarded(self, key, allowed, refusal, send) {
	const c = self.client
	if (debounced(self, key)) return { sent: false, reason: 'debounced' }
	const state = c.connected ? c.state : ''
	if (!state) {
		c.refuse('Not connected to the capture device: nothing sent')
		return { sent: false, reason: 'offline' }
	}
	if (!allowed.includes(state)) {
		c.refuse(`${refusal} (device is ${state}): nothing sent`)
		return { sent: false, reason: 'state' }
	}
	const result = await send()
	return { sent: true, ...result }
}

async function parse(self, context, text) {
	const fn = context?.parseVariablesInString ?? self.parseVariablesInString?.bind(self)
	return fn ? fn(String(text)) : String(text)
}

export async function startAdHoc(self, options = {}, context) {
	const c = self.client
	const cfg = self.config ?? {}
	const test = !!options.test
	return guarded(self, test ? 'start_test' : 'start', ['inactive', 'complete'], 'Already capturing', async () => {
		const profiles = c.system?.profiles ?? []
		const profile = options.profile || cfg.profile || profiles[0]
		if (!profile) {
			c.refuse('No capture profile known yet: nothing sent')
			return { ok: false }
		}
		let minutes = Number(options.minutes) || Number(cfg.minutes) || DEFAULT_MINUTES
		const max = c.system?.maxCaptureMinutes
		minutes = Math.max(1, Math.round(max ? Math.min(minutes, max) : minutes))
		const rawTitle = String(options.title || cfg.title || DEFAULT_TITLE)
		const title = (await parse(self, context, rawTitle)).trim() || 'Ad hoc capture'
		// Order as in the Capture API guide. Values are encoded, separators aren't.
		return c.command(test ? 'confidence_monitor' : 'new_capture', {
			duration: minutes * 60,
			capture_profile_name: profile,
			description: title,
		})
	})
}

export const startScheduledNow = (self) =>
	guarded(self, 'start_scheduled', ['waiting'], 'No scheduled capture is waiting to start', () => self.client.command('record'))

export const pause = (self) => guarded(self, 'pause', ['active'], 'Not recording', () => self.client.command('pause'))

// /capture/record also starts a waiting scheduled capture, so Resume only sends it when paused.
export const resume = (self) => guarded(self, 'resume', ['paused'], 'Not paused', () => self.client.command('record'))

export async function togglePause(self) {
	const c = self.client
	if (debounced(self, 'toggle')) return { sent: false, reason: 'debounced' }
	const state = freshState(self)
	if (!state) {
		c.refuse('Pause/resume: device state is out of date, nothing sent')
		return { sent: false, reason: 'stale' }
	}
	if (state === 'active') return { sent: true, ...(await c.command('pause')) }
	if (state === 'paused') return { sent: true, ...(await c.command('record')) }
	c.refuse(`Pause/resume: nothing to pause (device is ${state}): nothing sent`)
	return { sent: false, reason: 'state' }
}

export const stop = (self) => guarded(self, 'stop', ['active', 'paused'], 'No capture to stop', () => self.client.command('stop'))

export function extend(self, minutes) {
	const m = Math.round(Number(minutes))
	if (!Number.isFinite(m) || m < 1) {
		self.client.refuse('Extend: enter at least 1 minute')
		return Promise.resolve({ sent: false, reason: 'options' })
	}
	return guarded(self, `extend_${m}`, ['active', 'paused'], 'No capture to extend', () =>
		self.client.command('extend', { duration: Math.min(m, 240) * 60, extend: 'Submit Query' }),
	)
}

// ---------- actions ----------

function profileChoices(self) {
	const profiles = self.client.system?.profiles ?? []
	return [{ id: '', label: 'Default (from module settings)' }, ...profiles.map((p) => ({ id: p, label: p }))]
}

export function getActions(self) {
	return {
		start_adhoc: {
			name: 'Start ad hoc capture',
			description: 'Only sent when nothing is capturing, so a double press can never make two recordings.',
			options: [
				{ type: 'textinput', id: 'title', label: 'Title (blank = module default)', default: '', useVariables: true },
				{ type: 'number', id: 'minutes', label: 'Length in minutes (0 = module default)', default: 0, min: 0, max: 600 },
				{ type: 'dropdown', id: 'profile', label: 'Capture profile', default: '', choices: profileChoices(self), allowCustom: true },
				{
					type: 'checkbox',
					id: 'test',
					label: 'Test mode (confidence monitor: nothing is kept or uploaded)',
					default: false,
				},
			],
			callback: async (a, context) => {
				await startAdHoc(self, a.options, context)
			},
		},
		start_scheduled: {
			name: 'Start scheduled capture now',
			description: 'Starts a scheduled capture early. Only sent while one is waiting to start.',
			options: [],
			callback: async () => {
				await startScheduledNow(self)
			},
		},
		pause: { name: 'Pause', options: [], callback: async () => void (await pause(self)) },
		resume: {
			name: 'Resume',
			description: 'Only sent while paused (the same command would otherwise start a waiting scheduled capture).',
			options: [],
			callback: async () => void (await resume(self)),
		},
		toggle_pause: {
			name: 'Pause / resume (toggle)',
			options: [],
			callback: async () => void (await togglePause(self)),
		},
		stop: {
			name: 'Stop capture',
			description: 'Stops and uploads straight away. It can\'t be undone: the presets put this on a 2-second hold.',
			options: [],
			callback: async () => void (await stop(self)),
		},
		extend: {
			name: 'Extend capture',
			description: 'Can\'t run past the start of the next scheduled capture: the device extends as far as it can.',
			options: [
				{
					type: 'dropdown',
					id: 'minutes',
					label: 'Extend by',
					default: 5,
					choices: [
						{ id: 5, label: '5 minutes' },
						{ id: 15, label: '15 minutes' },
						{ id: 'custom', label: 'Custom' },
					],
				},
				{
					type: 'number',
					id: 'custom',
					label: 'Minutes',
					default: 30,
					min: 1,
					max: 240,
					isVisibleExpression: `$(options:minutes) == 'custom'`,
				},
			],
			callback: async (a) => void (await extend(self, a.options.minutes === 'custom' ? a.options.custom : a.options.minutes)),
		},
		refresh: {
			name: 'Refresh status now',
			options: [],
			callback: async () => self.client.pollNow(),
		},
		uc_pause_resume: {
			name: 'Universal Capture: pause/resume (Cmd+6, no status)',
			description: 'A toggle: the module can\'t tell whether Universal Capture is recording or paused.',
			options: [],
			callback: async () => void (await ucKey(self, 'pause_resume')),
		},
		uc_finish: {
			name: 'Universal Capture: finish and upload (Cmd+8, no status)',
			description: 'Ends the recording and uploads it. The presets only send this after a 2-second hold.',
			options: [],
			callback: async () => void (await ucKey(self, 'finish')),
		},
		uc_extend: {
			name: 'Universal Capture: extend (Cmd+1, no status)',
			description: 'Echo360 says this works for live and Universal Capture: Classroom recordings only.',
			options: [],
			callback: async () => void (await ucKey(self, 'extend')),
		},
		uc_open: {
			name: 'Universal Capture: open (Cmd+4)',
			options: [],
			callback: async () => void (await ucKey(self, 'open')),
		},
	}
}

// ---------- feedbacks ----------

const isState = (self, ...states) => self.client.connected && states.includes(self.client.state)

export function getFeedbacks(self) {
	const c = self.client
	return {
		recording: {
			type: 'boolean',
			name: 'Recording',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => isState(self, 'active'),
		},
		paused: {
			type: 'boolean',
			name: 'Paused',
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [{ type: 'checkbox', id: 'blink', label: 'Flash', default: false }],
			callback: (fb) => isState(self, 'paused') && (!fb.options.blink || !!self.blinkOn),
		},
		waiting: {
			type: 'boolean',
			name: 'Starting (scheduled capture waiting)',
			defaultStyle: { bgcolor: combineRgb(120, 60, 0), color: WHITE },
			options: [],
			callback: () => isState(self, 'waiting', 'pending'),
		},
		idle: {
			type: 'boolean',
			name: 'Idle (nothing capturing)',
			defaultStyle: { bgcolor: GREY, color: WHITE },
			options: [],
			callback: () => isState(self, 'inactive', 'complete'),
		},
		error: {
			type: 'boolean',
			name: 'Last command failed (shows for 10 s)',
			defaultStyle: { bgcolor: MAGENTA, color: WHITE },
			options: [],
			callback: () => {
				const e = isUC(self) ? self.uc?.lastError : c.lastError
				return !!e && Date.now() - e.at < ERROR_HOLD_MS
			},
		},
		connected: {
			type: 'boolean',
			name: 'Connected',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => c.connected,
		},
		disconnected: {
			type: 'boolean',
			name: 'Not connected',
			defaultStyle: { bgcolor: BLACK, color: DIM_TEXT, text: 'NO LINK' },
			options: [],
			callback: () => !isUC(self) && !c.connected,
		},
		remaining_below: {
			type: 'boolean',
			name: 'Less than N minutes left',
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [
				{ type: 'number', id: 'minutes', label: 'Minutes', default: 5, min: 1, max: 240 },
				{ type: 'checkbox', id: 'blink', label: 'Flash', default: true },
			],
			callback: (fb) => {
				if (!isState(self, 'active', 'paused')) return false
				const left = c.remainingSeconds()
				return left !== undefined && left < Number(fb.options.minutes) * 60 && (!fb.options.blink || !!self.blinkOn)
			},
		},
		next_within: {
			type: 'boolean',
			name: 'Next scheduled capture within N minutes',
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [{ type: 'number', id: 'minutes', label: 'Minutes', default: 10, min: 1, max: 1440 }],
			callback: (fb) => {
				if (!c.connected || c.next?.start === undefined) return false
				const sec = (c.next.start - c.deviceNow()) / 1000
				return sec <= Number(fb.options.minutes) * 60 && sec > -60
			},
		},
	}
}

// ---------- variables ----------

export function getVariableDefinitions() {
	return [
		{ variableId: 'state', name: 'State (inactive, waiting, active, paused, complete)' },
		{ variableId: 'state_label', name: 'State for a button (REC, PAUSED, STARTING, IDLE, DONE, OFFLINE, or NO STATUS in Universal Capture mode)' },
		{ variableId: 'elapsed', name: 'Time since the capture started (HH:MM:SS)' },
		{ variableId: 'remaining', name: 'Time left (HH:MM:SS)' },
		{ variableId: 'duration_min', name: 'Planned length (minutes)' },
		{ variableId: 'end_time', name: 'Planned end time' },
		{ variableId: 'title', name: 'Current capture title' },
		{ variableId: 'section', name: 'Current capture section' },
		{ variableId: 'presenter', name: 'Current capture presenter' },
		{ variableId: 'profile', name: 'Current capture profile' },
		{ variableId: 'next_title', name: 'Next scheduled capture title' },
		{ variableId: 'next_start', name: 'Next scheduled capture start time' },
		{ variableId: 'next_in', name: 'Time until the next scheduled capture' },
		{ variableId: 'device_name', name: 'Device name' },
		{ variableId: 'serial', name: 'Device serial number' },
		{ variableId: 'version', name: 'Device software version' },
		{ variableId: 'api_version', name: 'Capture API version' },
		{ variableId: 'location', name: 'Device location (from Echo360)' },
		{ variableId: 'room', name: 'Room name (from module settings)' },
		{ variableId: 'last_message', name: 'Last reply from the device, or why nothing was sent' },
	]
}

export function getVariableValues(self, now = Date.now()) {
	const c = self.client
	if (isUC(self)) {
		// Honest: keyboard shortcuts give no feedback, so there's no state or timer to show.
		const blank = Object.fromEntries(getVariableDefinitions().map((d) => [d.variableId, '']))
		return { ...blank, state: 'no_status', state_label: 'NO STATUS', room: self.config?.room ?? '', last_message: self.uc?.lastMessage ?? '' }
	}
	const on = c.connected && !!c.state
	const sys = c.system ?? {}
	const cur = on ? c.current : {}
	const nextStartLocal = on && c.next?.start !== undefined ? c.next.start - c.clockOffset : undefined
	return {
		state: on ? c.state : 'offline',
		state_label: on ? (STATE_LABELS[c.state] ?? c.state.toUpperCase()) : 'OFFLINE',
		elapsed: on ? hms(c.elapsedSeconds(now)) : '',
		remaining: on ? hms(c.remainingSeconds(now)) : '',
		duration_min: on && c.duration ? Math.round(c.duration / 60) : '',
		end_time: on && ['active', 'paused', 'waiting'].includes(c.state) ? clockTime(c.endTimeLocal(), now) : '',
		title: cur.title ?? '',
		section: cur.section ?? '',
		presenter: cur.presenter ?? '',
		profile: cur.profile ?? '',
		next_title: on ? (c.next?.title ?? '') : '',
		next_start: clockTime(nextStartLocal, now),
		next_in: nextStartLocal !== undefined ? untilText((nextStartLocal - now) / 1000) : on ? 'none' : '',
		device_name: sys.name ?? '',
		serial: sys.serial ?? '',
		version: sys.version ?? '',
		api_version: sys.apiVersion ?? '',
		location: sys.location ?? '',
		room: self.config?.room ?? '',
		last_message: c.lastMessage ?? '',
	}
}

// ---------- presets (sized for the D200X's 5 x 3 keys) ----------

export function getPresets(self) {
	const L = self.label || 'echo360-capture'
	const v = (id) => `$(${L}:${id})`
	const cat = 'Lecture capture'
	const offline = { feedbackId: 'disconnected', options: {}, style: { bgcolor: BLACK, color: DIM_TEXT, text: 'NO LINK' } }
	const err = { feedbackId: 'error', options: {}, style: { bgcolor: MAGENTA, color: WHITE } }
	const base = (text, extra = {}) => ({ text, size: 'auto', color: WHITE, bgcolor: DARK, ...extra })

	return {
		rec: {
			type: 'button',
			category: cat,
			name: 'REC: start ad hoc capture, shows state and time',
			style: base(`${v('state_label')}\\n${v('elapsed')}`),
			steps: [{ down: [{ actionId: 'start_adhoc', options: { title: '', minutes: 0, profile: '', test: false } }], up: [] }],
			feedbacks: [
				{ feedbackId: 'idle', options: {}, style: { bgcolor: GREY, color: WHITE, text: `START\\nREC` } },
				{ feedbackId: 'waiting', options: {}, style: { bgcolor: combineRgb(120, 60, 0), color: WHITE } },
				{ feedbackId: 'recording', options: {}, style: { bgcolor: RED, color: WHITE } },
				{ feedbackId: 'paused', options: { blink: true }, style: { bgcolor: AMBER, color: BLACK } },
				err,
				offline,
			],
		},
		pause_resume: {
			type: 'button',
			category: cat,
			name: 'Pause / resume',
			style: base('PAUSE', { color: DIM_TEXT }),
			steps: [{ down: [{ actionId: 'toggle_pause', options: {} }], up: [] }],
			feedbacks: [
				{ feedbackId: 'recording', options: {}, style: { color: WHITE, bgcolor: GREY, text: 'PAUSE' } },
				{ feedbackId: 'paused', options: { blink: false }, style: { bgcolor: AMBER, color: BLACK, text: `PAUSED\\n${v('elapsed')}` } },
				err,
				offline,
			],
		},
		stop_hold: {
			type: 'button',
			category: cat,
			name: 'Stop (hold 2 seconds)',
			style: base('HOLD\\nSTOP', { color: DIM_TEXT }),
			previewStyle: { text: 'HOLD\\nSTOP', color: WHITE, bgcolor: RED },
			steps: [
				{
					down: [],
					up: [],
					2000: { options: { runWhileHeld: true }, actions: [{ actionId: 'stop', options: {} }] },
				},
			],
			feedbacks: [
				{ feedbackId: 'recording', options: {}, style: { bgcolor: RED, color: WHITE } },
				{ feedbackId: 'paused', options: { blink: false }, style: { bgcolor: RED, color: WHITE } },
				err,
				offline,
			],
		},
		extend_5: {
			type: 'button',
			category: cat,
			name: 'Extend +5 minutes',
			style: base(`+5 MIN\\n${v('remaining')}`),
			steps: [{ down: [{ actionId: 'extend', options: { minutes: 5, custom: 30 } }], up: [] }],
			feedbacks: [{ feedbackId: 'remaining_below', options: { minutes: 5, blink: true }, style: { bgcolor: AMBER, color: BLACK } }, err, offline],
		},
		extend_15: {
			type: 'button',
			category: cat,
			name: 'Extend +15 minutes',
			style: base(`+15 MIN\\n${v('remaining')}`),
			steps: [{ down: [{ actionId: 'extend', options: { minutes: 15, custom: 30 } }], up: [] }],
			feedbacks: [{ feedbackId: 'remaining_below', options: { minutes: 5, blink: true }, style: { bgcolor: AMBER, color: BLACK } }, err, offline],
		},
		next: {
			type: 'button',
			category: cat,
			name: 'Next scheduled capture (status only)',
			style: base(`NEXT\\n${v('next_in')}`, { color: DIM_TEXT }),
			steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'next_within', options: { minutes: 10 }, style: { bgcolor: AMBER, color: BLACK } }, offline],
		},
		start_scheduled: {
			type: 'button',
			category: cat,
			name: 'Start scheduled capture now (only while waiting)',
			style: base('START\\nNOW', { color: DIM_TEXT }),
			steps: [{ down: [{ actionId: 'start_scheduled', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'waiting', options: {}, style: { bgcolor: combineRgb(120, 60, 0), color: WHITE } }, offline],
		},
		message: {
			type: 'button',
			category: cat,
			name: 'Last device message',
			style: base(v('last_message'), { size: '7', color: DIM_TEXT }),
			steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
			feedbacks: [err, offline],
		},

		// Universal Capture on this Mac: keystrokes only, deliberately no state colours or timers.
		uc_pause_resume: {
			type: 'button',
			category: UC_CATEGORY,
			name: 'Pause / resume (Cmd+6, no status)',
			style: base('PAUSE/\\nRESUME\\nno status', { bgcolor: DARK }),
			steps: [{ down: [{ actionId: 'uc_pause_resume', options: {} }], up: [] }],
			feedbacks: [err],
		},
		uc_finish_hold: {
			type: 'button',
			category: UC_CATEGORY,
			name: 'Finish and upload (hold 2 seconds, Cmd+8, no status)',
			style: base('HOLD\\nFINISH', { color: DIM_TEXT }),
			previewStyle: { text: 'HOLD\\nFINISH', color: WHITE, bgcolor: RED },
			steps: [
				{
					down: [],
					up: [],
					2000: { options: { runWhileHeld: true }, actions: [{ actionId: 'uc_finish', options: {} }] },
				},
			],
			feedbacks: [err],
		},
		uc_extend: {
			type: 'button',
			category: UC_CATEGORY,
			name: 'Extend (Cmd+1, no status)',
			style: base('EXTEND\\nno status'),
			steps: [{ down: [{ actionId: 'uc_extend', options: {} }], up: [] }],
			feedbacks: [err],
		},
		uc_open: {
			type: 'button',
			category: UC_CATEGORY,
			name: 'Open Universal Capture (Cmd+4)',
			style: base('OPEN\\nUC'),
			steps: [{ down: [{ actionId: 'uc_open', options: {} }], up: [] }],
			feedbacks: [err],
		},
	}
}
