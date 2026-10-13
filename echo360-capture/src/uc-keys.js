// Universal Capture (the software) has no control API, only keyboard shortcuts. This sends them with
// osascript on the Mac running Companion. They are toggles, so we never know the real state: buttons
// in this mode say NO STATUS rather than showing a made-up recording timer.
import { execFile } from 'node:child_process'

export const UC_DEFAULT_APP = 'Universal Capture'
export const UC_DEBOUNCE_MS = 1500

/** Cmd+number shortcuts from Echo360's "Control a Universal Capture Recording" guide (top-row keys). */
export const UC_KEYS = {
	pause_resume: { key: '6', label: 'Pause/resume (Cmd+6)' },
	finish: { key: '8', label: 'Finish and upload (Cmd+8)' },
	extend: { key: '1', label: 'Extend (Cmd+1)' },
	open: { key: '4', label: 'Open Universal Capture (Cmd+4)' },
}

/**
 * osascript arguments for one shortcut. The key is one of our fixed digits. The app name is never
 * pasted into the script: it's passed as an argument and read with `item 1 of argv`.
 */
export function osascriptArgs(key, { activate = false, appName = UC_DEFAULT_APP } = {}) {
	if (!/^[0-9]$/.test(String(key))) throw new Error(`Unexpected key ${key}`)
	const keystroke = `tell application "System Events" to keystroke "${key}" using command down`
	if (!activate) return ['-e', keystroke]
	return [
		'-e',
		'on run argv',
		'-e',
		'tell application (item 1 of argv) to activate',
		'-e',
		'delay 0.3',
		'-e',
		keystroke,
		'-e',
		'end run',
		String(appName || UC_DEFAULT_APP),
	]
}

export class UCKeys {
	/** run: execFile-compatible function (injected in tests). log(level, msg). */
	constructor({ run = execFile, platform = process.platform, log = () => {} } = {}) {
		this.run = run
		this.platform = platform
		this.log = log
		this.lastPress = new Map()
		this.lastMessage = ''
		this.lastError = undefined // { text, at }
	}

	/** Send one shortcut by action name. Resolves { sent, ok?, reason? }. Never retried. */
	send(name, { activate = false, appName = UC_DEFAULT_APP } = {}) {
		const def = UC_KEYS[name]
		if (!def) return Promise.resolve({ sent: false, reason: 'unknown' })
		if (this.platform !== 'darwin') {
			this.#fail(`Universal Capture shortcuts only work when Companion runs on a Mac: ${def.label} not sent`, 'warn')
			return Promise.resolve({ sent: false, reason: 'platform' })
		}
		// Pause/resume is a toggle: a double tap would undo itself, so ignore repeats within 1.5 s.
		const now = Date.now()
		const last = this.lastPress.get(name)
		if (last !== undefined && now - last < UC_DEBOUNCE_MS) return Promise.resolve({ sent: false, reason: 'debounced' })
		this.lastPress.set(name, now)

		const args = osascriptArgs(def.key, { activate, appName })
		return new Promise((resolve) => {
			this.run('osascript', args, { timeout: 5000 }, (err, _stdout, stderr) => {
				if (err) {
					const why = String(stderr || err.message || '')
					const hint = /not allowed|1002|1719|assistive/i.test(why)
						? ' (give Companion Accessibility permission: System Settings → Privacy & Security → Accessibility)'
						: ''
					this.#fail(`${def.label} failed${hint}: ${why.trim().split('\n')[0]}`)
					resolve({ sent: true, ok: false })
				} else {
					this.lastMessage = `Sent ${def.label} (no status from Universal Capture)`
					this.log('info', this.lastMessage)
					resolve({ sent: true, ok: true })
				}
			})
		})
	}

	#fail(text, level = 'warn') {
		this.lastMessage = text
		this.lastError = { text, at: Date.now() }
		this.log(level, text)
	}
}
