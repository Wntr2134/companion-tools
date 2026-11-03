// The Windows helper: one PowerShell process that stays running and does everything the Mac does with
// AppleScript (windows, screens, sound, keys, keep awake, icons…) through Windows' own APIs. The C# in
// win-host-cs.js is compiled once and cached as a DLL in %TEMP%, so after the first start a request
// takes milliseconds. Requests and replies are one JSON object per line; nothing the user typed is ever
// pasted into a script. No Companion dependency, so it can be tested on its own.
import { HOST_CS } from './win-host-cs.js'
import { WinHelper } from './win-helper.js'

/** The requests script: the C# does the work. */
export const HOST_SCRIPT = String.raw`
[CompanionSystemTools.Host]::Init()
function Invoke-Request($line) { [CompanionSystemTools.Host]::Handle($line) }
`.trim()

export class WinHost extends WinHelper {
	constructor(opts = {}) {
		super({ name: 'system-tools', cs: HOST_CS, script: HOST_SCRIPT, ...opts })
	}
}

// ---------- keys ----------

/** Windows virtual-key codes for the named keys in the key list (the same names as on the Mac). */
export const WIN_KEYS = {
	return: 0x0d,
	tab: 0x09,
	space: 0x20,
	delete: 0x08, // the Mac's delete is backspace
	escape: 0x1b,
	forward_delete: 0x2e,
	home: 0x24,
	end: 0x23,
	page_up: 0x21,
	page_down: 0x22,
	left: 0x25,
	right: 0x27,
	down: 0x28,
	up: 0x26,
	...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i + 1}`, 0x70 + i])),
}

/**
 * The Mac's modifier checkboxes on Windows: ⌘ is Ctrl (so ⌘C copies on both), ⌥ is Alt, ⌃ is the
 * Windows key, ⇧ is Shift.
 */
export const WIN_MODS = { command: 0x11, option: 0x12, control: 0x5b, shift: 0x10 }
export const WIN_MOD_LABELS = { command: 'Ctrl (⌘ on a Mac)', option: 'Alt (⌥)', control: 'Windows key (⌃)', shift: 'Shift' }

/** A shortcut as a "keys" request: { vk } for a named key or { char } for a character, plus modifier codes. */
export function keyRequest(key, mods = []) {
	const k = String(key ?? '')
	const out = { mods: mods.map((m) => WIN_MODS[m]).filter(Boolean) }
	if (WIN_KEYS[k] !== undefined) out.vk = WIN_KEYS[k]
	else if (k.length === 1) out.char = k
	else throw new Error(`no key called "${k}"`)
	return out
}

/** Windows' own shortcuts for the Mac's desktop features. */
export const WIN_SHORTCUTS = {
	task_view: keyRequest('tab', ['control']), // Win+Tab
	show_desktop: keyRequest('d', ['control']), // Win+D
	desktop_left: keyRequest('left', ['control', 'command']), // Win+Ctrl+←
	desktop_right: keyRequest('right', ['control', 'command']), // Win+Ctrl+→
}

// ---------- keep awake ----------

/** Keep awake through the helper (Windows' SetThreadExecutionState), same shape as the Mac's KeepAwake. */
export class WinKeepAwake {
	constructor(host) {
		this.host = host
		this.state = null // { displays } while on
		this.onChange = () => {}
		this.onError = () => {}
		const prev = host.onStart
		// The setting belongs to the helper's process: put it back if the helper restarts.
		host.onStart = () => {
			prev()
			if (this.state) void this.host.request('keep_awake', { on: true, displays: this.state.displays }).catch((e) => this.onError(e))
		}
	}

	get on() {
		return !!this.state
	}

	start(displays = true) {
		this.state = { displays }
		this.host.request('keep_awake', { on: true, displays }).catch((e) => {
			// The helper stopped before answering: it puts keep awake back when it starts again.
			if (/helper stopped/.test(e.message)) return
			this.state = null
			this.onError(e)
			this.onChange()
		})
		this.onChange()
	}

	stop(quiet = false) {
		const was = this.state
		this.state = null
		if (was) void this.host.request('keep_awake', { on: false, displays: false }).catch(() => null)
		if (!quiet) this.onChange()
	}
}
