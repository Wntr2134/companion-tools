// Checks System Tools' Windows helper on a real Windows machine (GitHub's Windows runners, or Will's PC):
// compiles the C# with Windows PowerShell 5.1 exactly as the module does, then runs every request that
// is safe without a person at the PC. It opens Notepad to move, capture and type into, and closes it.
// Run from the repo root: node tools/win-check.mjs
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mod = (p) => import(pathToFileURL(path.join(root, p)).href)
const { WinHost, keyRequest, WIN_SHORTCUTS } = await mod('system-tools/src/win-host.js')
const { placeItem, restoreItems } = await mod('system-tools/src/mac-windows.js')
const apps = await mod('system-tools/src/apps.js')

let failed = 0
const ok = (name, extra = '') => console.log(`ok   ${name}${extra ? `  (${extra})` : ''}`)
const bad = (name, e) => {
	failed++
	console.log(`FAIL ${name}\n     ${String(e?.stderr || e?.message || e).trim().split('\n').join('\n     ')}`)
}
const step = async (name, fn) => {
	try {
		ok(name, await fn())
	} catch (e) {
		bad(name, e)
	}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dir = await mkdtemp(path.join(os.tmpdir(), 'st-win-'))
const host = new WinHost({ dir })

await step('helper starts (compiles the C# with Windows PowerShell 5.1)', async () => {
	const t = Date.now()
	if ((await host.request('ping')) !== 'pong') throw new Error('no pong')
	return `${Date.now() - t} ms`
})
await step('helper starts again from the cached DLL', async () => {
	host.stop()
	const t = Date.now()
	await host.request('ping')
	return `${Date.now() - t} ms`
})
await step('Start Menu apps found', async () => {
	const list = await apps.scanApps()
	if (!list.length) throw new Error('no apps')
	return `${list.length} apps, e.g. ${list.slice(0, 4).map((a) => a.name).join(', ')}`
})
let screens = []
await step('screens', async () => {
	screens = await host.request('screens')
	if (!Array.isArray(screens)) throw new Error('not a list')
	return screens.map((s) => `${s.name} work ${s.w}×${s.h}`).join(', ') || 'no screens on this runner'
})
await step('sound read (a runner may have no sound device: then it says so)', async () => JSON.stringify(await host.request('sound')))
await step('state: dark mode, battery', async () => JSON.stringify(await host.request('state')))
await step('taskbar pinned apps', async () => {
	const list = await host.request('taskbar')
	return `${list.length}: ${list.map((t) => t.name).join(', ') || 'none pinned here'}`
})
await step('app icons drawn (Notepad, Explorer)', async () => {
	const items = ['notepad.exe', 'explorer.exe'].map((f) => ({ path: path.join(process.env.SystemRoot ?? 'C:\\Windows', f === 'notepad.exe' ? 'System32' : '', f), out: path.join(dir, `${f}.png`) }))
	const res = await host.request('icons', { items, size: 192 }, { timeout: 120000 })
	const sizes = []
	for (const [i, r] of res.entries()) {
		if (r.error) throw new Error(`${items[i].path}: ${r.error}`)
		const png = await readFile(items[i].out)
		if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
		sizes.push(`${png.readUInt32BE(16)}px ${png.length} bytes`)
	}
	return sizes.join(', ')
})
await step('keep awake on and off', async () => {
	await host.request('keep_awake', { on: true, displays: true })
	await host.request('keep_awake', { on: false, displays: false })
	return 'set and cleared'
})
await step('key requests for the desktop shortcuts are well formed', async () => JSON.stringify(WIN_SHORTCUTS.task_view))

// Windows: open Notepad, move it, read it back, type into it, close it.
if (screens.length) {
	const notepad = { name: 'Notepad', path: 'notepad.exe', exe: 'notepad.exe' }
	await step('window: open Notepad and put it on the left half of screen 1', async () => {
		const [r] = await host.request('place', { items: [placeItem(notepad, 1, 'left', { launch: true })] }, { timeout: 60000 })
		if (r.error) throw new Error(r.error)
		const s = screens[0]
		const want = [s.x, s.y, Math.round(s.w / 2), s.h]
		if (Math.abs(r.x - want[0]) > 2 || Math.abs(r.w - want[2]) > 2) throw new Error(`placed at ${JSON.stringify(r)}, wanted ${want}`)
		return `${r.x},${r.y} ${r.w}×${r.h}`
	})
	let saved
	await step('window: capture finds it where it was put', async () => {
		saved = await host.request('capture')
		const n = saved.find((a) => a.exe === 'notepad.exe')
		if (!n) throw new Error(`Notepad not in ${saved.map((a) => a.exe).join(', ')}`)
		const w = n.windows[0]
		return `${n.app}: ${w.x},${w.y} ${w.w}×${w.h}`
	})
	await step('window: centre, then back to the captured spot', async () => {
		await host.request('place', { items: [placeItem(notepad, 1, 'centre')] })
		const items = restoreItems(saved.filter((a) => a.exe === 'notepad.exe'))
		const [r] = await host.request('place', { items })
		if (r.error) throw new Error(r.error)
		const w = saved.find((a) => a.exe === 'notepad.exe').windows[0]
		if (Math.abs(r.x - w.x) > 2 || Math.abs(r.y - w.y) > 2) throw new Error(`restored to ${r.x},${r.y}, saved ${w.x},${w.y}`)
		return 'restored'
	})
	await step('window: fill maximises', async () => {
		const [r] = await host.request('place', { items: [placeItem(notepad, 1, 'full')] })
		if (r.error) throw new Error(r.error)
		const cap = (await host.request('capture')).find((a) => a.exe === 'notepad.exe')
		if (!cap?.windows[0]?.max) throw new Error('not maximised')
		return 'maximised'
	})
	await step('keys: focus Notepad, type text, Ctrl+A, then a shortcut by character', async () => {
		if (!(await host.request('focus', { item: { app: 'Notepad', exe: 'notepad.exe' } }))) throw new Error('no Notepad window to focus')
		await sleep(300)
		await host.request('type', { text: 'Hello from Companion – ✓' })
		await host.request('keys', keyRequest('a', ['command']))
		await host.request('keys', keyRequest('end'))
		return 'sent'
	})
	await step('window: minimise and hide others / show all', async () => {
		await host.request('minimise', { item: { app: 'Notepad', exe: 'notepad.exe' } })
		await host.request('hide_others', { item: {} })
		await host.request('show_all')
		return 'ok'
	})
	await exec('taskkill', ['/IM', 'notepad.exe', '/F']).catch(() => null)
} else console.log('skip window checks: this runner has no screens')

host.close()

// Spotify's helper: Windows' media controls (WinRT from Windows PowerShell 5.1) and Spotify's own volume.
// There's no Spotify on the runner, so this proves it loads and answers cleanly without it.
const { SpotifyHelper } = await mod('spotify-local/src/win-media.js')
const { Spotify } = await mod('spotify-local/src/spotify.js')
const sp = new SpotifyHelper({ dir: path.join(dir, 'spotify') })
await step('Spotify helper starts (compiles its C#, loads Windows media controls)', async () => {
	const t = Date.now()
	if ((await sp.request('ping')) !== 'pong') throw new Error('no pong')
	return `${Date.now() - t} ms`
})
await step('Spotify: read without Spotify open', async () => {
	const s = await new Spotify({ platform: 'win32', helper: sp }).read()
	if (s.running) throw new Error(`thought Spotify was open: ${JSON.stringify(s)}`)
	return JSON.stringify(s)
})
await step('Spotify: media session list readable (Windows media controls answer)', async () => {
	const r = await sp.request('command', { name: 'next', arg: '' })
	if (r !== 'NOTRUNNING') throw new Error(`expected NOTRUNNING, got ${r}`)
	return r
})
await step('Spotify: volume with no Spotify sound session says so', async () => {
	const r = await sp.request('command', { name: 'volume', arg: '50' })
	if (r !== 'NOSOUND') throw new Error(`expected NOSOUND, got ${r}`)
	return r
})
sp.close()
await rm(dir, { recursive: true, force: true }).catch(() => null)
console.log(failed ? `\n${failed} check(s) failed` : '\nall Windows checks passed')
process.exit(failed ? 1 : 0)
