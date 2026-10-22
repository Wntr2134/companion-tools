// Mac system controls: sound, keep awake, displays, lock, disks, dark mode, keyboard shortcuts,
// text, desktops and the Shortcuts app. Everything runs as [file, args] (no shell), and anything the
// user typed reaches scripts through argv, never pasted into the script.
import { execFile, spawn } from 'node:child_process'

export function run(file, args, { timeout = 15000, exec = execFile } = {}) {
	return new Promise((resolve, reject) => {
		exec(file, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) {
				err.stderr = String(stderr ?? '')
				return reject(err)
			}
			resolve(String(stdout ?? ''))
		})
	})
}

// ---------- sound ----------

/** Output volume, input volume and mute, tab-separated. Output volume is "missing value" for devices macOS can't set (e.g. HDMI, some interfaces). */
export const SOUND_READ = `set v to get volume settings
return ((output volume of v) as string) & tab & ((input volume of v) as string) & tab & ((output muted of v) as string)`

export function parseSound(out) {
	const [o, i, m] = String(out ?? '').trim().split('\t')
	const num = (s) => (/^\d+$/.test(s ?? '') ? Number(s) : null)
	return { output: num(o), input: num(i), muted: m === 'true' }
}

/** argv: [what, value]. what = output | input | mute. */
export const SOUND_SET = `on run argv
	set what to item 1 of argv
	set val to item 2 of argv
	if what is "output" then
		set volume output volume (val as integer)
	else if what is "input" then
		set volume input volume (val as integer)
	else if what is "mute" then
		set volume output muted (val is "true")
	end if
	return "OK"
end run`

// ---------- appearance ----------

/** `defaults read -g AppleInterfaceStyle` prints "Dark" in dark mode and fails in light mode. Needs no permission. */
export async function isDarkMode(runner = run) {
	try {
		return (await runner('defaults', ['read', '-g', 'AppleInterfaceStyle'])).trim() === 'Dark'
	} catch {
		return false
	}
}

/** argv: ["on" | "off" | "toggle"] */
export const DARK_MODE_SET = `on run argv
	set m to item 1 of argv
	tell application "System Events" to tell appearance preferences
		if m is "on" then
			set dark mode to true
		else if m is "off" then
			set dark mode to false
		else
			set dark mode to not dark mode
		end if
	end tell
	return "OK"
end run`

// ---------- disks ----------

export const EJECT_ALL = `tell application "Finder"
	set n to count of (every disk whose ejectable is true)
	eject (every disk whose ejectable is true)
end tell
return n as string`

// ---------- keys ----------

/** macOS key codes for keys that aren't plain characters. */
export const KEY_CODES = {
	return: 36,
	tab: 48,
	space: 49,
	delete: 51,
	escape: 53,
	forward_delete: 117,
	home: 115,
	end: 119,
	page_up: 116,
	page_down: 121,
	left: 123,
	right: 124,
	down: 125,
	up: 126,
	f1: 122,
	f2: 120,
	f3: 99,
	f4: 118,
	f5: 96,
	f6: 97,
	f7: 98,
	f8: 100,
	f9: 101,
	f10: 109,
	f11: 103,
	f12: 111,
	f13: 105,
	f14: 107,
	f15: 113,
	f16: 106,
	f17: 64,
	f18: 79,
	f19: 80,
	f20: 90,
}

export const KEY_LABELS = {
	return: 'Return ↩',
	tab: 'Tab ⇥',
	space: 'Space',
	delete: 'Delete ⌫',
	escape: 'Escape',
	forward_delete: 'Forward delete ⌦',
	home: 'Home',
	end: 'End',
	page_up: 'Page up',
	page_down: 'Page down',
	left: 'Left arrow ←',
	right: 'Right arrow →',
	down: 'Down arrow ↓',
	up: 'Up arrow ↑',
}

export const MODIFIERS = ['command', 'option', 'control', 'shift']
const MOD_SYMBOL = { control: '⌃', option: '⌥', shift: '⇧', command: '⌘' }

/** "⌃⌥⌘→" style label for a shortcut. */
export function shortcutLabel(key, mods = []) {
	const order = ['control', 'option', 'shift', 'command']
	const k = KEY_LABELS[key]?.split(' ').pop() ?? (key.startsWith('f') && KEY_CODES[key] ? key.toUpperCase() : key.toUpperCase())
	return order.filter((m) => mods.includes(m)).map((m) => MOD_SYMBOL[m]).join('') + (k === '' ? key : k)
}

/**
 * Sends one keyboard shortcut. argv: [key, modifiers (comma list), app to bring forward first ('' = none)].
 * A key that's in the key-code list goes by code; anything else is typed as a character.
 */
export const SEND_KEYS = `function run(argv) {
	const [key, mods, app] = argv
	const codes = ${JSON.stringify(KEY_CODES)}
	const se = Application('System Events')
	if (app) {
		Application(app).activate()
		delay(0.3)
	}
	const using = mods ? mods.split(',').filter(Boolean).map((m) => m + ' down') : []
	if (codes[key] !== undefined) se.keyCode(codes[key], { using })
	else se.keystroke(key, { using })
	return 'OK'
}`

/** Types text as keystrokes. argv: [text, app ('' = whatever is in front)]. */
export const TYPE_TEXT = `function run(argv) {
	const [text, app] = argv
	const se = Application('System Events')
	if (app) {
		Application(app).activate()
		delay(0.3)
	}
	se.keystroke(text)
	return 'OK'
}`

/** Pastes text through the clipboard. argv: [text, app, restore ("true" puts the old clipboard text back)]. */
export const PASTE_TEXT = `function run(argv) {
	const [text, app, restore] = argv
	const me = Application.currentApplication()
	me.includeStandardAdditions = true
	let before = null
	if (restore === 'true') {
		try { before = me.theClipboard() } catch (e) {}
	}
	me.setTheClipboardTo(text)
	const se = Application('System Events')
	if (app) {
		Application(app).activate()
		delay(0.3)
	}
	se.keystroke('v', { using: ['command down'] })
	if (restore === 'true' && typeof before === 'string') {
		delay(0.5)
		me.setTheClipboardTo(before)
	}
	return 'OK'
}`

/** Switch desktop (Space) left or right: Mission Control's ⌃← / ⌃→. argv: ["left" | "right"] */
export const SPACE_SWITCH = `function run(argv) {
	Application('System Events').keyCode(argv[0] === 'left' ? 123 : 124, { using: ['control down'] })
	return 'OK'
}`

/** Lock the screen: ⌃⌘Q, the same as  menu → Lock Screen. */
export const LOCK_SCREEN = `function run() {
	Application('System Events').keystroke('q', { using: ['control down', 'command down'] })
	return 'OK'
}`

// Mission Control's own program takes 1 = show desktop, 2 = app windows (App Exposé); none = Mission Control.
export const MISSION_CONTROL_PATHS = ['/System/Applications/Mission Control.app/Contents/MacOS/Mission Control', '/Applications/Mission Control.app/Contents/MacOS/Mission Control']

// ---------- Magnet ----------

/** Magnet's default shortcuts (Magnet → Settings → Keyboard shortcuts). Only works with Magnet installed and these left as they are. */
export const MAGNET = {
	left: { label: 'Left half', key: 'left', mods: ['control', 'option'] },
	right: { label: 'Right half', key: 'right', mods: ['control', 'option'] },
	top: { label: 'Top half', key: 'up', mods: ['control', 'option'] },
	bottom: { label: 'Bottom half', key: 'down', mods: ['control', 'option'] },
	maximise: { label: 'Maximise', key: 'return', mods: ['control', 'option'] },
	centre: { label: 'Centre', key: 'c', mods: ['control', 'option'] },
	restore: { label: 'Restore', key: 'delete', mods: ['control', 'option'] },
	next_display: { label: 'Next display', key: 'right', mods: ['control', 'option', 'command'] },
	previous_display: { label: 'Previous display', key: 'left', mods: ['control', 'option', 'command'] },
	left_third: { label: 'Left third', key: 'd', mods: ['control', 'option'] },
	centre_third: { label: 'Centre third', key: 'f', mods: ['control', 'option'] },
	right_third: { label: 'Right third', key: 'g', mods: ['control', 'option'] },
	left_two_thirds: { label: 'Left two-thirds', key: 'e', mods: ['control', 'option'] },
	right_two_thirds: { label: 'Right two-thirds', key: 't', mods: ['control', 'option'] },
}

// ---------- Shortcuts app ----------

export function parseShortcutList(out) {
	return [
		...new Set(
			String(out ?? '')
				.split(/\r?\n/)
				.map((s) => s.trim())
				.filter(Boolean),
		),
	].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

// ---------- keep awake ----------

/**
 * Keeps the Mac (and optionally the displays) awake with macOS's own `caffeinate`, tied to this
 * module's process so it stops if Companion closes.
 */
export class KeepAwake {
	constructor({ spawnFn = spawn, pid = process.pid } = {}) {
		this.spawnFn = spawnFn
		this.pid = pid
		this.child = null
		this.displays = false
		this.onChange = () => {}
	}

	get on() {
		return !!this.child
	}

	start(displays = true) {
		if (this.child && this.displays === displays) return
		this.stop(true)
		// -i: no idle sleep, -m: no disk sleep, -s: no system sleep on power, -d: no display sleep
		const args = [displays ? '-dims' : '-ims', '-w', String(this.pid)]
		const child = this.spawnFn('caffeinate', args, { stdio: 'ignore' })
		this.child = child
		this.displays = displays
		child.on?.('exit', () => {
			if (this.child === child) {
				this.child = null
				this.onChange()
			}
		})
		child.on?.('error', () => {
			if (this.child === child) {
				this.child = null
				this.onChange()
			}
		})
		this.onChange()
	}

	stop(quiet = false) {
		const child = this.child
		this.child = null
		if (child) child.kill?.()
		if (!quiet) this.onChange()
	}
}

export function macPermissionHint(text) {
	if (/-1743|not authori[sz]ed to send apple events/i.test(text)) return 'macOS blocked it: allow Companion to control that app in System Settings → Privacy & Security → Automation.'
	if (/-1719|-25211|-25204|assistive|not allowed to send keystrokes|accessibility/i.test(text)) return 'macOS blocked it: allow Companion in System Settings → Privacy & Security → Accessibility (remove it and add it again after a Companion update).'
	return ''
}
