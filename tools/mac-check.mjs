// Checks every Mac script in the modules on a real Mac (GitHub's macOS runners, or Will's Mac):
//  1. compiles each AppleScript / JavaScript-for-Automation script with osacompile (syntax, and the
//     apps' scripting terms: Music, Spotify, System Events, Finder), and
//  2. runs the ones that are safe without a person at the Mac (no keystrokes, no permission prompts).
// Run from the repo root: node tools/mac-check.mjs
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const mod = (p) => import(path.join(root, p))

const spotify = await mod('spotify-local/src/spotify.js')
const music = await mod('apple-music-local/src/music.js')
const sys = await mod('system-tools/src/mac-system.js')
const win = await mod('system-tools/src/mac-windows.js')
const info = await mod('system-tools/src/sysinfo.js')
const uc = await mod('echo360-capture/src/uc-keys.js')
const ndi = await mod('ndi-router/src/virtual-input-mac.js')

const tmp = await mkdtemp(path.join(os.tmpdir(), 'mac-check-'))
const hasSpotify = existsSync('/Applications/Spotify.app')
let failed = 0
const ok = (name, extra = '') => console.log(`ok   ${name}${extra ? `  (${extra})` : ''}`)
const bad = (name, e) => {
	failed++
	console.log(`FAIL ${name}\n     ${String(e?.stderr || e?.message || e).trim().split('\n').join('\n     ')}`)
}

// ---------- 1. compile ----------

const AS = 'AppleScript'
const JS = 'JavaScript'
/** [name, language, -e chunks] */
const scripts = [
	['Apple Music: read', AS, [music.MAC_READ]],
	['Apple Music: command', AS, [music.MAC_COMMAND]],
	['Apple Music: playlists', AS, [music.MAC_PLAYLISTS]],
	['Apple Music: artwork', AS, [music.MAC_ARTWORK]],
	['System Tools: sound read', AS, [sys.SOUND_READ]],
	['System Tools: sound set', AS, [sys.SOUND_SET]],
	['System Tools: dark mode', AS, [sys.DARK_MODE_SET]],
	['System Tools: eject disks', AS, [sys.EJECT_ALL]],
	['System Tools: quit app', AS, ['quit app "Some App"']],
	['System Tools: send keys', JS, [sys.SEND_KEYS]],
	['System Tools: type text', JS, [sys.TYPE_TEXT]],
	['System Tools: paste text', JS, [sys.PASTE_TEXT]],
	['System Tools: switch desktop', JS, [sys.SPACE_SWITCH]],
	['System Tools: lock screen', JS, [sys.LOCK_SCREEN]],
	['System Tools: windows', JS, [win.WINDOW_SCRIPT]],
	['Echo360: shortcut', AS, uc.osascriptArgs('1').filter((a) => a !== '-e')],
	['Echo360: shortcut, bring app forward', AS, uc.osascriptArgs('2', { activate: true }).filter((a) => a !== '-e').slice(0, -1)],
	['NDI Router: Virtual Input menu', JS, [ndi.MENU_SCRIPT]],
]
if (hasSpotify) scripts.push(['Spotify: read', AS, [spotify.MAC_READ]], ['Spotify: command', AS, [spotify.MAC_COMMAND]])
else console.log('skip Spotify scripts: Spotify.app is not installed here')

for (const [name, lang, chunks] of scripts) {
	try {
		await exec('osacompile', ['-l', lang, '-o', path.join(tmp, 'x.scpt'), ...chunks.flatMap((c) => ['-e', c])], { timeout: 60000 })
		ok(`compiles: ${name}`)
	} catch (e) {
		bad(`compiles: ${name}`, e)
	}
}

// ---------- 2. run what's safe ----------

const step = async (name, fn) => {
	try {
		ok(name, await fn())
	} catch (e) {
		bad(name, e)
	}
}

await step('Apple Music: read (never opens Music)', async () => {
	const s = music.parseState((await exec('osascript', ['-e', music.MAC_READ], { timeout: 30000 })).stdout)
	return s.running ? `Music is open: ${s.status}` : 'Music closed'
})
if (hasSpotify) {
	await step('Spotify: read (never opens Spotify)', async () => {
		const s = spotify.parseMacState((await exec('osascript', ['-e', spotify.MAC_READ], { timeout: 30000 })).stdout)
		return s.running ? `Spotify is open: ${s.status}` : 'Spotify closed'
	})
}
await step('System Tools: sound read', async () => {
	const s = sys.parseSound((await exec('osascript', ['-e', sys.SOUND_READ], { timeout: 30000 })).stdout)
	return `output ${s.output ?? '–'}, input ${s.input ?? '–'}, muted ${s.muted}`
})
await step('System Tools: screens', async () => {
	const list = await win.windowRequest({ cmd: 'screens' })
	if (!Array.isArray(list)) throw new Error(`not a list: ${JSON.stringify(list)}`)
	for (const s of list) if (!(s.w > 0 && s.h > 0)) throw new Error(`bad screen ${JSON.stringify(s)}`)
	return list.length ? list.map((s) => `${s.name} ${s.full.w}×${s.full.h}`).join(', ') : 'no display attached'
})
await step('System Tools: dark mode read', async () => `dark mode ${await sys.isDarkMode()}`)
await step('System Tools: memory from vm_stat', async () => {
	const pct = info.parseVmStat((await exec('vm_stat')).stdout, os.totalmem())
	if (pct === null) throw new Error("vm_stat output wasn't understood")
	return `${pct}% used`
})
await step('System Tools: battery from pmset', async () => {
	const b = info.parsePmset((await exec('pmset', ['-g', 'batt'])).stdout)
	return b ? `${b.percent}%` : 'no battery'
})
await step('System Tools: disk free', async () => {
	const d = await info.diskFree()
	if (!(d.free > 0)) throw new Error(JSON.stringify(d))
	return info.fmtBytes(d.free)
})
await step('System Tools: keep awake (caffeinate)', async () => {
	const k = new sys.KeepAwake()
	k.start(true)
	await new Promise((r) => setTimeout(r, 500))
	const { stdout } = await exec('pgrep', ['-f', `caffeinate -dims -w ${process.pid}`]).catch(() => ({ stdout: '' }))
	k.stop()
	if (!stdout.trim()) throw new Error('caffeinate did not start')
	return 'started and stopped'
})
await step('System Tools: Mission Control program exists', async () => {
	const found = sys.MISSION_CONTROL_PATHS.find((p) => existsSync(p))
	if (!found) throw new Error(`none of ${sys.MISSION_CONTROL_PATHS.join(', ')}`)
	return found
})
await step('System Tools: shortcuts command exists', async () => {
	if (!existsSync('/usr/bin/shortcuts')) throw new Error('/usr/bin/shortcuts missing')
	return '/usr/bin/shortcuts'
})
await step('Apple Music / Spotify: album art PNG → small JPEG with sips', async () => {
	const { encodePng } = await mod('spotify-local/src/artwork.js')
	const w = 640
	const rgb = new Uint8Array(w * w * 3).map((_, i) => i % 251)
	const png = path.join(tmp, 'cover.png')
	const jpg = path.join(tmp, 'cover.jpg')
	await writeFile(png, Buffer.from(encodePng(rgb, w, w), 'base64'))
	await exec('sips', ['-s', 'format', 'jpeg', '-Z', '300', png, '--out', jpg])
	const bytes = await readFile(jpg)
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG')
	const { decodeArt } = await mod('spotify-local/src/artwork.js')
	const art = decodeArt(bytes)
	if (art.width !== 300) throw new Error(`width ${art.width}`)
	return `${bytes.length} bytes, ${art.width}×${art.height}`
})

console.log(failed ? `\n${failed} check(s) failed` : '\nall Mac checks passed')
process.exit(failed ? 1 : 0)
