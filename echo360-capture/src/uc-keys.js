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
export function osascriptArgs(key, { activate = false, appName = UC_DEFAULT_APP, returnFocus = true } = {}) {
	if (!/^[0-9]$/.test(String(key))) throw new Error(`Unexpected key ${key}`)
	const keystroke = `tell application "System Events" to keystroke "${key}" using command down`
	if (!activate) return ['-e', keystroke]
	const lines = ['on run argv']
	// Remember the app in front, so it can be put back after the shortcut (the presenter keeps their slides).
	if (returnFocus) lines.push('set prevApp to ""', 'try', 'tell application "System Events" to set prevApp to name of first application process whose frontmost is true', 'end try')
	lines.push('tell application (item 1 of argv) to activate', 'delay 0.3', keystroke)
	if (returnFocus)
		lines.push(
			'delay 0.15',
			'if prevApp is not "" and prevApp is not (item 1 of argv) then',
			'try',
			'tell application "System Events" to set frontmost of process prevApp to true',
			'end try',
			'end if',
		)
	lines.push('end run')
	return [...lines.flatMap((l) => ['-e', l]), String(appName || UC_DEFAULT_APP)]
}

/**
 * Windows: Universal Capture uses Ctrl instead of Cmd. PowerShell sends the keys with WScript.Shell.
 * Inputs come in through environment variables (UC_KEY, UC_APP, UC_ACTIVATE, UC_RETURN), never pasted
 * into the script, so an odd app name can't change what runs.
 */
export const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -Name Win -Namespace UcKeys -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);'
$prev = [UcKeys.Win]::GetForegroundWindow()
$sh = New-Object -ComObject WScript.Shell
if ($env:UC_ACTIVATE -eq '1') {
  $name = $env:UC_APP
  $compact = $name -replace ' ', ''
  $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -like "*$name*" -or $_.ProcessName -like "*$compact*") } | Select-Object -First 1
  if (-not $p) { Write-Output 'ERR:not-running'; exit 0 }
  $null = $sh.AppActivate($p.Id)
  Start-Sleep -Milliseconds 300
}
$sh.SendKeys('^' + $env:UC_KEY)
if ($env:UC_ACTIVATE -eq '1' -and $env:UC_RETURN -eq '1') {
  Start-Sleep -Milliseconds 150
  $null = [UcKeys.Win]::SetForegroundWindow($prev)
}
Write-Output 'OK'
`.trim()

/** powershell.exe arguments and environment for one shortcut on Windows. */
export function powershellArgs(key, { activate = false, appName = UC_DEFAULT_APP, returnFocus = true } = {}) {
	if (!/^[0-9]$/.test(String(key))) throw new Error(`Unexpected key ${key}`)
	return {
		args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT],
		env: { UC_KEY: String(key), UC_APP: String(appName || UC_DEFAULT_APP), UC_ACTIVATE: activate ? '1' : '0', UC_RETURN: returnFocus ? '1' : '0' },
	}
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
	send(name, { activate = false, appName = UC_DEFAULT_APP, returnFocus = true } = {}) {
		const def = UC_KEYS[name]
		if (!def) return Promise.resolve({ sent: false, reason: 'unknown' })
		if (this.platform !== 'darwin' && this.platform !== 'win32') {
			this.#fail(`Universal Capture shortcuts only work when Companion runs on a Mac or Windows PC: ${def.label} not sent`, 'warn')
			return Promise.resolve({ sent: false, reason: 'platform' })
		}
		// Pause/resume is a toggle: a double tap would undo itself, so ignore repeats within 1.5 s.
		const now = Date.now()
		const last = this.lastPress.get(name)
		if (last !== undefined && now - last < UC_DEBOUNCE_MS) return Promise.resolve({ sent: false, reason: 'debounced' })
		this.lastPress.set(name, now)

		const win = this.platform === 'win32'
		const label = win ? def.label.replace('Cmd+', 'Ctrl+') : def.label
		let cmd, args, opts
		if (win) {
			const ps = powershellArgs(def.key, { activate, appName, returnFocus })
			cmd = 'powershell.exe'
			args = ps.args
			opts = { timeout: 8000, windowsHide: true, env: { ...process.env, ...ps.env } }
		} else {
			cmd = 'osascript'
			args = osascriptArgs(def.key, { activate, appName, returnFocus })
			opts = { timeout: 5000 }
		}
		return new Promise((resolve) => {
			this.run(cmd, args, opts, (err, stdout, stderr) => {
				if (!err && String(stdout ?? '').trim() === 'ERR:not-running') {
					this.#fail(`${label} not sent: couldn't find a Universal Capture window (is it open?)`)
					return resolve({ sent: true, ok: false })
				}
				if (err) {
					const why = String(stderr || err.message || '')
					const hint = /-1743|not authori[sz]ed to send apple events/i.test(why)
						? ' (allow Companion to control "System Events": System Settings → Privacy & Security → Automation)'
						: /not allowed|1002|1719|assistive/i.test(why)
							? ' (give Companion Accessibility permission: System Settings → Privacy & Security → Accessibility)'
							: ''
					this.#fail(`${label} failed${hint}: ${why.trim().split('\n')[0]}`)
					resolve({ sent: true, ok: false })
				} else {
					this.lastMessage = `Sent ${label} (no status from Universal Capture)`
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
