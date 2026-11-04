// The Windows helper's Node side, with a stand-in PowerShell process (the real one runs in CI on Windows:
// tools/win-check.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WinHost, WinKeepAwake, keyRequest, WIN_SHORTCUTS, HOST_SCRIPT } from '../src/win-host.js'
import { HELPER_PS1 } from '../src/win-helper.js'
import { HOST_CS } from '../src/win-host-cs.js'

/** A fake powershell.exe: answers each JSON line with `answer(request)`. */
function fakeSpawn(answer, { ready = '{"ready":true}' } = {}) {
	const spawned = []
	const spawnFn = (file, args, opts) => {
		const child = new EventEmitter()
		child.stdin = new PassThrough()
		child.stdout = new PassThrough()
		child.stderr = new PassThrough()
		child.kill = () => child.emit('exit', null)
		spawned.push({ file, args, opts, child, requests: [] })
		const me = spawned.at(-1)
		setImmediate(() => child.stdout.write(ready + '\n'))
		let buf = ''
		child.stdin.on('data', (d) => {
			buf += d
			let i
			while ((i = buf.indexOf('\n')) >= 0) {
				const req = JSON.parse(buf.slice(0, i))
				buf = buf.slice(i + 1)
				me.requests.push(req)
				const out = answer(req)
				if (out !== undefined) setImmediate(() => child.stdout.write(JSON.stringify({ id: req.id, ...out }) + '\n'))
			}
		})
		return child
	}
	return { spawnFn, spawned }
}

test('helper: one PowerShell process, files written once per version, replies matched by id', async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'st-host-'))
	const { spawnFn, spawned } = fakeSpawn((r) => (r.cmd === 'boom' ? { error: 'no sound output device' } : { result: { echo: r.cmd, n: r.n } }))
	const host = new WinHost({ spawnFn, dir })
	const [a, b] = await Promise.all([host.request('screens', { n: 1 }), host.request('sound', { n: 2 })])
	assert.deepEqual(a, { echo: 'screens', n: 1 })
	assert.deepEqual(b, { echo: 'sound', n: 2 })
	await assert.rejects(host.request('boom'), /no sound output device/)
	assert.equal(spawned.length, 1, 'started once')
	assert.equal(spawned[0].file, 'powershell.exe')
	assert.ok(spawned[0].args.includes('-Sta'), 'STA, for the clipboard')
	assert.equal(spawned[0].opts.windowsHide, true)
	assert.equal(await readFile(spawned[0].opts.env.CT_HELPER_CS, 'utf8'), HOST_CS)
	assert.equal(await readFile(spawned[0].opts.env.CT_HELPER_SCRIPT, 'utf8'), HOST_SCRIPT)
	assert.equal(await readFile(spawned[0].args.at(-1), 'utf8'), HELPER_PS1)
	assert.match(spawned[0].opts.env.CT_HELPER_DLL, /helper\.dll$/)
	host.stop()
})

test('helper: a request that hangs restarts the helper; a crash is reported and the next request restarts it', async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'st-host-'))
	const { spawnFn, spawned } = fakeSpawn((r) => (r.cmd === 'hang' ? undefined : { result: 'ok' }))
	const host = new WinHost({ spawnFn, dir, timeout: 50 })
	let starts = 0
	host.onStart = () => starts++
	await assert.rejects(host.request('hang'), /didn't answer "hang" in time/)
	assert.equal(await host.request('ping'), 'ok')
	assert.equal(spawned.length, 2, 'a fresh helper after the hang')
	spawned[1].child.emit('exit', 1)
	assert.equal(await host.request('ping'), 'ok')
	assert.equal(spawned.length, 3)
	assert.equal(starts, 3)
	host.stop()
})

test("helper: a start that fails says why (e.g. PowerShell blocked)", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'st-host-'))
	const { spawnFn } = fakeSpawn(() => ({ result: 1 }), { ready: '{"error":"Add-Type: compile failed"}' })
	const host = new WinHost({ spawnFn: (...a) => (tries++, spawnFn(...a)), dir })
	let tries = 0
	let told = 0
	host.onFail = () => told++
	await assert.rejects(host.request('ping'), /didn't start: Add-Type: compile failed/)
	await assert.rejects(host.request('sound'), /compile failed/)
	assert.equal(tries, 1, "not retried straight away (a failing helper isn't started every poll)")
	assert.equal(told, 1)
})

test('keys: the Mac key names and modifiers as Windows keys (⌘ = Ctrl, ⌃ = Windows key)', () => {
	assert.deepEqual(keyRequest('c', ['command']), { mods: [0x11], char: 'c' })
	assert.deepEqual(keyRequest('left', ['control', 'command']), { mods: [0x5b, 0x11], vk: 0x25 })
	assert.deepEqual(keyRequest('f5'), { mods: [], vk: 0x74 })
	assert.deepEqual(keyRequest('delete'), { mods: [], vk: 0x08 }, "the Mac's delete is backspace")
	assert.throws(() => keyRequest('nope'), /no key called/)
	assert.deepEqual(WIN_SHORTCUTS.task_view, { mods: [0x5b], vk: 0x09 })
	assert.deepEqual(WIN_SHORTCUTS.show_desktop, { mods: [0x5b], char: 'd' })
})

test('keep awake on Windows: through the helper, and switched back on when the helper restarts', async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'st-host-'))
	const { spawnFn, spawned } = fakeSpawn(() => ({ result: true }))
	const host = new WinHost({ spawnFn, dir })
	const k = new WinKeepAwake(host)
	let changes = 0
	k.onChange = () => changes++
	k.start(false)
	assert.equal(k.on, true)
	await host.request('ping')
	assert.deepEqual(spawned[0].requests[0], { on: true, displays: false, cmd: 'keep_awake', id: 1 })
	spawned[0].child.emit('exit', 1)
	await host.request('ping')
	await new Promise((r) => setImmediate(r))
	assert.ok(spawned[1].requests.some((r) => r.cmd === 'keep_awake' && r.on === true), 'put back after the restart')
	k.stop()
	assert.equal(k.on, false)
	assert.equal(changes, 2)
	host.close()
	await assert.rejects(host.request('ping'), /closed/, 'no restart once closed')
})

test('the C# stays C# 5 (Windows PowerShell 5.1 compiles it) and covers every request the module sends', () => {
	assert.doesNotMatch(HOST_CS, /\$"|\?\.|nameof\(|=> \{?[^}]*;\s*$\n\s*public/m)
	assert.doesNotMatch(HOST_CS, /\bout var\b/)
	for (const cmd of ['screens', 'place', 'capture', 'minimise', 'hide', 'hide_others', 'show_all', 'focus', 'sound', 'sound_set', 'keys', 'type', 'paste', 'keep_awake', 'display_sleep', 'screen_saver', 'dark_mode', 'state', 'eject', 'taskbar', 'icons', 'tab_select', 'browser_open']) {
		assert.ok(HOST_CS.includes(`case "${cmd}":`), `the helper handles "${cmd}"`)
	}
})
