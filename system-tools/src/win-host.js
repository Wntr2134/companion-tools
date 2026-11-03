// The Windows helper: one PowerShell process that stays running and does everything the Mac does with
// AppleScript (windows, screens, sound, keys, keep awake, icons…) through Windows' own APIs. The C# in
// win-host-cs.js is compiled once and cached as a DLL in %TEMP%, so after the first start a request
// takes milliseconds. Requests and replies are one JSON object per line; nothing the user typed is ever
// pasted into a script. No Companion dependency, so it can be tested on its own.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { HOST_CS } from './win-host-cs.js'

/** Loads the cached DLL (compiling it the first time), then answers requests until stdin closes. */
export const HOST_PS1 = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$dll = $env:ST_HOST_DLL
function Build {
  Add-Type -Path $env:ST_HOST_CS -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions, System.Core -OutputAssembly $dll -OutputType Library
}
try {
  if (-not (Test-Path $dll)) { Build }
  try { Add-Type -Path $dll } catch { Remove-Item $dll -Force -ErrorAction SilentlyContinue; Build; Add-Type -Path $dll }
  [CompanionSystemTools.Host]::Init()
} catch {
  [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
  exit 1
}
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line.Trim() -eq '') { continue }
  [Console]::Out.WriteLine([CompanionSystemTools.Host]::Handle($line))
}
`.trim()

export const HOST_VERSION = createHash('sha1').update(HOST_CS).update(HOST_PS1).digest('hex').slice(0, 12)

/** Where the helper's files go: a folder per version, so an update never loads an old DLL. */
export const hostDir = (tmp = os.tmpdir()) => path.join(tmp, 'companion-system-tools', HOST_VERSION)

/** A helper that couldn't start is tried again after this long (keys pressed meanwhile fail straight away). */
export const RETRY_MS = 30000

export class WinHost {
	constructor({ spawnFn = spawn, dir = hostDir(), timeout = 20000 } = {}) {
		this.spawnFn = spawnFn
		this.dir = dir
		this.timeout = timeout
		this.child = null
		this.starting = null
		this.pending = new Map()
		this.nextId = 1
		this.onStart = () => {} // called after every (re)start, e.g. to switch keep awake back on
		this.onFail = () => {} // called when the helper can't start (once per try)
		this.failed = null // { error, at }: a failed start isn't retried for RETRY_MS
	}

	async #files() {
		await mkdir(this.dir, { recursive: true })
		const cs = path.join(this.dir, 'host.cs')
		const ps1 = path.join(this.dir, 'host.ps1')
		await writeFile(cs, HOST_CS)
		await writeFile(ps1, HOST_PS1)
		return { cs, ps1, dll: path.join(this.dir, 'host.dll') }
	}

	start() {
		if (this.closed) return Promise.reject(new Error('the Windows helper is closed'))
		if (this.child) return Promise.resolve()
		if (this.starting) return this.starting
		if (this.failed && Date.now() - this.failed.at < RETRY_MS) return Promise.reject(this.failed.error)
		this.starting = (async () => {
			const f = await this.#files()
			const child = this.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', f.ps1], {
				env: { ...process.env, ST_HOST_CS: f.cs, ST_HOST_DLL: f.dll },
				windowsHide: true,
				stdio: ['pipe', 'pipe', 'pipe'],
			})
			let stderr = ''
			child.stderr?.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
			const lines = createInterface({ input: child.stdout })
			await new Promise((resolve, reject) => {
				// The first start compiles the C# (a few seconds); after that it's cached.
				const t = setTimeout(() => reject(new Error('the Windows helper took too long to start')), 60000)
				const first = (line) => {
					clearTimeout(t)
					let msg
					try {
						msg = JSON.parse(line)
					} catch {
						return reject(new Error(`the Windows helper said: ${line.slice(0, 300)}`))
					}
					if (msg.ready) return resolve()
					reject(new Error(`the Windows helper didn't start: ${msg.error ?? line}`))
				}
				lines.once('line', first)
				child.once('error', (e) => {
					clearTimeout(t)
					reject(e)
				})
				child.once('exit', (code) => {
					clearTimeout(t)
					reject(new Error(`the Windows helper stopped (${code}): ${stderr.trim().split('\n').slice(-3).join(' ')}`))
				})
			})
			lines.on('line', (line) => this.#reply(line))
			child.on('exit', () => {
				if (this.child !== child) return
				this.child = null
				for (const p of this.pending.values()) {
					clearTimeout(p.timer)
					p.reject(new Error('the Windows helper stopped'))
				}
				this.pending.clear()
			})
			this.child = child
			this.failed = null
			this.onStart()
		})().catch((e) => {
			this.failed = { error: e, at: Date.now() }
			this.onFail(e)
			throw e
		})
		return this.starting.finally(() => (this.starting = null))
	}

	#reply(line) {
		let msg
		try {
			msg = JSON.parse(line)
		} catch {
			return
		}
		const p = this.pending.get(msg.id)
		if (!p) return
		this.pending.delete(msg.id)
		clearTimeout(p.timer)
		if (msg.error !== undefined) p.reject(new Error(msg.error))
		else p.resolve(msg.result)
	}

	/** One request: { cmd, ...data }. Resolves with the result, rejects with Windows' reason. */
	async request(cmd, data = {}, { timeout = this.timeout } = {}) {
		await this.start()
		const child = this.child
		if (!child) throw new Error('the Windows helper stopped')
		const id = this.nextId++
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id)
				reject(new Error(`the Windows helper didn't answer "${cmd}" in time`))
				// A stuck helper would hold up every key: start a fresh one next time.
				this.stop()
			}, timeout)
			this.pending.set(id, { resolve, reject, timer })
			child.stdin.write(JSON.stringify({ ...data, cmd, id }) + '\n')
		})
	}

	/** For good (the connection is being removed): no restarts after this. */
	close() {
		this.closed = true
		this.stop()
	}

	stop() {
		const child = this.child
		this.child = null
		if (!child) return
		for (const p of this.pending.values()) {
			clearTimeout(p.timer)
			p.reject(new Error('the Windows helper stopped'))
		}
		this.pending.clear()
		try {
			child.stdin.end()
			child.kill()
		} catch {
			// already gone
		}
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
