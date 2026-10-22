// Talks to Apple's Music app on this Mac through its AppleScript dictionary. No Apple account or web API.
import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Reads everything in one go. Never starts Music. Fields are tab-separated. */
export const MAC_READ = `
on run
	if application "Music" is not running then return "NOTRUNNING"
	tell application "Music"
		set out to (player state as string) & tab & (sound volume as string) & tab & (shuffle enabled as string) & tab & (song repeat as string) & tab
		try
			set out to out & (player position as string)
		end try
		try
			set t to current track
			set fav to ""
			try
				set fav to (favorited of t) as string
			on error
				try
					set fav to (loved of t) as string
				end try
			end try
			set out to out & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & ((duration of t) as string) & tab & (persistent ID of t) & tab & fav
			try
				set s to current stream title
				if s is not missing value and s is not "" then set out to out & tab & s
			end try
		end try
		return out
	end tell
end run
`

/**
 * One command. argv: [command, argument]. The argument is never pasted into the script.
 * Only commands that play something (or "launch") start Music.
 */
export const MAC_COMMAND = `
on run argv
	set cmd to item 1 of argv
	set arg to item 2 of argv
	set starters to {"play", "playpause", "playlist", "launch"}
	if application "Music" is not running and starters does not contain cmd then return "NOTRUNNING"
	tell application "Music"
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
		else if cmd is "back" then
			back track
		else if cmd is "restart" then
			set player position to 0
		else if cmd is "volume" then
			set v to arg as integer
			if v < 0 then set v to 0
			if v > 100 then set v to 100
			set sound volume to v
		else if cmd is "seekby" then
			set p to player position + (arg as real)
			if p < 0 then set p to 0
			set player position to p
		else if cmd is "shuffle" then
			set shuffle enabled to (arg is "true")
		else if cmd is "repeat" then
			if arg is "one" then
				set song repeat to one
			else if arg is "all" then
				set song repeat to all
			else
				set song repeat to off
			end if
		else if cmd is "favourite" then
			try
				set favorited of current track to (arg is "true")
			on error
				set loved of current track to (arg is "true")
			end try
		else if cmd is "playlist" then
			play (first playlist whose name is arg)
		end if
	end tell
	return "OK"
end run
`

/** The user's playlists, one name per line. */
export const MAC_PLAYLISTS = `
on run
	if application "Music" is not running then return "NOTRUNNING"
	tell application "Music"
		set AppleScript's text item delimiters to linefeed
		set out to (name of user playlists) as string
		set AppleScript's text item delimiters to ""
		return out
	end tell
end run
`

/** Saves the current track's cover (PNG or JPEG, as Music stores it) to argv[1]. */
export const MAC_ARTWORK = `
on run argv
	set outPath to item 1 of argv
	if application "Music" is not running then return "NOTRUNNING"
	tell application "Music"
		try
			set d to raw data of artwork 1 of current track
		on error
			return "NOART"
		end try
	end tell
	set f to open for access (POSIX file outPath) with write permission
	try
		set eof f to 0
		write d to f
		close access f
	on error e
		close access f
		error e
	end try
	return "OK"
end run
`

const num = (s) => {
	const n = Number(String(s ?? '').replace(',', '.'))
	return Number.isFinite(n) ? n : null
}

/** Parse MAC_READ's output into a state object. */
export function parseState(out) {
	const text = String(out ?? '').replace(/\r?\n$/, '')
	if (text === 'NOTRUNNING' || text === '') return { running: false }
	const f = text.split('\t')
	const status = f[0] || 'stopped' // playing | paused | stopped | fast forwarding | rewinding
	const state = {
		running: true,
		playing: status === 'playing',
		status,
		volume: num(f[1]),
		shuffle: f[2] === 'true',
		repeat: ['one', 'all'].includes(f[3]) ? f[3] : 'off',
		position: num(f[4]),
	}
	if (f.length >= 11) {
		Object.assign(state, {
			track: f[5],
			artist: f[6],
			album: f[7],
			duration: num(f[8]) || null, // seconds (0 for radio streams)
			id: f[9],
			favourite: f[10] === 'true',
		})
		// Radio: the station is the "track"; the song playing on it is the stream title.
		if (f[11]) {
			state.artist = state.track
			state.track = f[11]
		}
	}
	return state
}

export function parsePlaylists(out) {
	const text = String(out ?? '').trim()
	if (text === 'NOTRUNNING' || text === '') return []
	return [...new Set(text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))]
}

export const COMMANDS = new Set(['launch', 'play', 'pause', 'playpause', 'next', 'previous', 'back', 'restart', 'volume', 'seekby', 'shuffle', 'repeat', 'favourite', 'playlist'])

export class Music {
	constructor({ exec = execFile, artPath = join(tmpdir(), `companion-apple-music-${process.pid}`) } = {}) {
		this.exec = exec
		this.artPath = artPath
	}

	#run(file, args) {
		return new Promise((resolve, reject) => {
			this.exec(file, args, { timeout: 8000 }, (err, stdout, stderr) => {
				if (err) return reject(new Error(String(stderr || err.message).trim()))
				resolve(String(stdout ?? ''))
			})
		})
	}

	async read() {
		return parseState(await this.#run('osascript', ['-e', MAC_READ]))
	}

	async playlists() {
		return parsePlaylists(await this.#run('osascript', ['-e', MAC_PLAYLISTS]))
	}

	/** Run a command. Returns 'OK' or 'NOTRUNNING'. */
	async command(cmd, arg = '') {
		if (!COMMANDS.has(cmd)) throw new Error(`Unknown command "${cmd}"`)
		return (await this.#run('osascript', ['-e', MAC_COMMAND, cmd, String(arg)])).trim()
	}

	/** The current track's cover as JPEG bytes (at most 300 px), or throws if it has none. */
	async artwork() {
		const raw = `${this.artPath}.art`
		const jpg = `${this.artPath}.jpg`
		try {
			const r = (await this.#run('osascript', ['-e', MAC_ARTWORK, raw])).trim()
			if (r !== 'OK') throw new Error('no artwork')
			// Music stores covers as PNG or JPEG; sips (built into macOS) makes a small JPEG either way.
			await this.#run('sips', ['-s', 'format', 'jpeg', '-Z', '300', raw, '--out', jpg])
			return new Uint8Array(await readFile(jpg))
		} finally {
			await rm(raw, { force: true }).catch(() => null)
			await rm(jpg, { force: true }).catch(() => null)
		}
	}
}

export function fmtTime(seconds) {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return ''
	const s = Math.max(0, Math.floor(seconds))
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Plain-English macOS permission problems, or ''. */
export function permissionHint(text) {
	if (/-1743|not authori[sz]ed to send apple events/i.test(text))
		return 'macOS blocked it: allow Companion to control Music in System Settings → Privacy & Security → Automation.'
	return ''
}
