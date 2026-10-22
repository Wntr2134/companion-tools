// Talks to the Spotify app on this computer. No Spotify account or web API.
// Mac: Spotify's AppleScript dictionary (full control and now-playing info).
// Windows: media keys, plus the track from Spotify's window title ("Artist - Title").
import { execFile } from 'node:child_process'

// ---------- Mac ----------

/** Reads everything in one go. Never starts Spotify. Fields are tab-separated. */
export const MAC_READ = `
on run
	if application "Spotify" is not running then return "NOTRUNNING"
	tell application "Spotify"
		set out to (player state as string) & tab & (sound volume as string) & tab & (shuffling as string) & tab & (repeating as string) & tab & (player position as string)
		try
			set t to current track
			set out to out & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & ((duration of t) as string) & tab & (id of t) & tab & (artwork url of t)
		end try
		return out
	end tell
end run
`

/**
 * One command. argv: [command, argument]. The argument is never pasted into the script.
 * Commands that would start Spotify only do so when asked to play something.
 */
export const MAC_COMMAND = `
on run argv
	set cmd to item 1 of argv
	set arg to item 2 of argv
	set starters to {"play", "playpause", "uri", "launch"}
	if application "Spotify" is not running and starters does not contain cmd then return "NOTRUNNING"
	tell application "Spotify"
		if cmd is "launch" then
			activate
		else if cmd is "play" then
			play
		else if cmd is "pause" then
			pause
		else if cmd is "playpause" then
			playpause
		else if cmd is "next" then
			next track
		else if cmd is "previous" then
			previous track
		else if cmd is "restart" then
			set player position to 0
		else if cmd is "volume" then
			set v to arg as integer
			if v < 0 then set v to 0
			if v > 100 then set v to 100
			set sound volume to v
		else if cmd is "seek" then
			set player position to (arg as real)
		else if cmd is "seekby" then
			set p to player position + (arg as real)
			if p < 0 then set p to 0
			set player position to p
		else if cmd is "shuffle" then
			set shuffling to (arg is "true")
		else if cmd is "repeat" then
			set repeating to (arg is "true")
		else if cmd is "uri" then
			play track arg
		end if
	end tell
	return "OK"
end run
`

const num = (s) => {
	const n = Number(String(s ?? '').replace(',', '.'))
	return Number.isFinite(n) ? n : null
}

/** Parse MAC_READ's output into a state object. */
export function parseMacState(out) {
	const text = String(out ?? '').replace(/\r?\n$/, '')
	if (text === 'NOTRUNNING' || text === '') return { running: false }
	const f = text.split('\t')
	const state = {
		running: true,
		playing: f[0] === 'playing',
		status: f[0] || 'stopped', // playing | paused | stopped
		volume: num(f[1]),
		shuffle: f[2] === 'true',
		repeat: f[3] === 'true',
		position: num(f[4]),
	}
	if (f.length >= 10) {
		const dur = num(f[8])
		Object.assign(state, {
			track: f[5],
			artist: f[6],
			album: f[7],
			duration: dur === null ? null : dur / 1000, // Spotify reports milliseconds
			uri: f[9],
			artwork: f[10] || '',
		})
	}
	return state
}

// ---------- Windows ----------

const VK = { playpause: 0xb3, next: 0xb0, previous: 0xb1, stop: 0xb2, volup: 0xaf, voldown: 0xae, mute: 0xad }

/** Presses one media key. The key code comes in through an environment variable. */
export const WIN_KEY = `
Add-Type -Name K -Namespace SpotifyKeys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'
$vk = [byte][int]$env:SP_VK
[SpotifyKeys.K]::keybd_event($vk, 0, 0, [System.UIntPtr]::Zero)
[SpotifyKeys.K]::keybd_event($vk, 0, 2, [System.UIntPtr]::Zero)
Write-Output 'OK'
`.trim()

/** Spotify's window title: "Artist - Title" while playing, "Spotify Premium"/"Spotify Free"/"Spotify" when paused. */
export const WIN_READ = `
$p = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
if (-not $p) { if (Get-Process -Name Spotify -ErrorAction SilentlyContinue) { Write-Output 'RUNNING' } else { Write-Output 'NOTRUNNING' } } else { Write-Output ('TITLE:' + $p.MainWindowTitle) }
`.trim()

export function parseWinState(out) {
	const text = String(out ?? '').trim()
	if (text === 'NOTRUNNING' || text === '') return { running: false }
	if (text === 'RUNNING') return { running: true, playing: false, status: 'paused' }
	const title = text.replace(/^TITLE:/, '')
	if (/^Spotify( Premium| Free)?$/i.test(title) || /^Advertisement$/i.test(title)) return { running: true, playing: false, status: 'paused' }
	const i = title.indexOf(' - ')
	return {
		running: true,
		playing: true,
		status: 'playing',
		artist: i > 0 ? title.slice(0, i) : '',
		track: i > 0 ? title.slice(i + 3) : title,
	}
}

// ---------- the client ----------

// play/pause on Windows are worked out from the known state (there's only a toggle key).
const WIN_COMMANDS = new Set(['playpause', 'next', 'previous', 'volup', 'voldown', 'mute', 'launch', 'uri'])

/** What each platform can do (for the UI and the log). */
export const CAN = {
	darwin: new Set(['launch', 'play', 'pause', 'playpause', 'next', 'previous', 'restart', 'volume', 'seek', 'seekby', 'shuffle', 'repeat', 'uri']),
	win32: WIN_COMMANDS,
}

export class Spotify {
	constructor({ platform = process.platform, exec = execFile } = {}) {
		this.platform = platform
		this.exec = exec
	}

	#run(file, args, opts = {}) {
		return new Promise((resolve, reject) => {
			this.exec(file, args, { timeout: 8000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
				if (err) {
					const e = new Error(String(stderr || err.message).trim())
					return reject(e)
				}
				resolve(String(stdout ?? ''))
			})
		})
	}

	async read() {
		if (this.platform === 'darwin') return parseMacState(await this.#run('osascript', ['-e', MAC_READ]))
		if (this.platform === 'win32') return parseWinState(await this.#run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_READ]))
		return { running: false }
	}

	/** Run a command. Returns 'OK' or 'NOTRUNNING'; throws if this platform can't do it. */
	async command(cmd, arg = '') {
		if (!CAN[this.platform]?.has(cmd)) throw new Error(`"${cmd}" isn't available on ${this.platform === 'win32' ? 'Windows' : this.platform}`)
		if (this.platform === 'darwin') return (await this.#run('osascript', ['-e', MAC_COMMAND, cmd, String(arg)])).trim()
		// Windows
		if (cmd === 'launch') {
			await this.#run('explorer.exe', ['spotify:']).catch(() => null) // explorer returns 1 even when it worked
			return 'OK'
		}
		if (cmd === 'uri') {
			if (!/^spotify:[A-Za-z0-9:_-]+$/.test(String(arg))) throw new Error('Not a Spotify link (spotify:…)')
			await this.#run('explorer.exe', [String(arg)]).catch(() => null)
			return 'OK'
		}
		return (await this.#run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_KEY], { env: { ...process.env, SP_VK: String(VK[cmd]) } })).trim()
	}
}

/** Spotify share links (https://open.spotify.com/playlist/ID?si=…) to URIs (spotify:playlist:ID). */
export function toSpotifyUri(text) {
	const s = String(text ?? '').trim()
	if (/^spotify:/.test(s)) return s
	const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/.exec(s)
	return m ? `spotify:${m[1]}:${m[2]}` : ''
}

export function fmtTime(seconds) {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return ''
	const s = Math.max(0, Math.floor(seconds))
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Plain-English macOS permission problems, or ''. */
export function permissionHint(text) {
	if (/-1743|not authori[sz]ed to send apple events/i.test(text))
		return 'macOS blocked it: allow Companion to control Spotify in System Settings → Privacy & Security → Automation.'
	return ''
}
