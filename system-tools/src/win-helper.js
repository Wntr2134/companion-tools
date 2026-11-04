// A Windows helper: one PowerShell process that stays running for a module and answers requests, so a
// key press takes milliseconds instead of starting PowerShell each time. C# (if any) is compiled once and
// cached as a DLL in %TEMP% (a folder per version, so an update never loads an old DLL). Requests and
// replies are one JSON object per line; nothing the user typed is ever pasted into a script.
// The same file is in every module that has Windows features (system-tools, spotify-local): keep them
// identical (a test checks). No Companion dependency, so it can be tested on its own.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'

/** Loads the cached DLL (compiling it the first time) and the module's requests script, then answers requests until stdin closes. */
export const HELPER_PS1 = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  if ($env:CT_HELPER_CS) {
    $dll = $env:CT_HELPER_DLL
    # UI Automation (finding browser tabs) lives in WPF's assemblies: load them to reference them by path.
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
    $uia = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location, [System.Windows.Threading.Dispatcher].Assembly.Location)
    function Build {
      Add-Type -Path $env:CT_HELPER_CS -ReferencedAssemblies (@('System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions', 'System.Core') + $uia) -OutputAssembly $dll -OutputType Library
    }
    if (-not (Test-Path $dll)) { Build }
    try { Add-Type -Path $dll } catch { Remove-Item $dll -Force -ErrorAction SilentlyContinue; Build; Add-Type -Path $dll }
  }
  . $env:CT_HELPER_SCRIPT
} catch {
  [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
  exit 1
}
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line.Trim() -eq '') { continue }
  $out = @(Invoke-Request $line)
  [Console]::Out.WriteLine([string]$out[-1])
}
`.trim()

export const helperVersion = (cs, script) => createHash('sha1').update(HELPER_PS1).update(cs ?? '').update(script ?? '').digest('hex').slice(0, 12)

/** Where a helper's files go. */
export const helperDir = (name, version, tmp = os.tmpdir()) => path.join(tmp, 'companion-tools-helpers', `${name}-${version}`)

/** A helper that couldn't start is tried again after this long (keys pressed meanwhile fail straight away). */
export const RETRY_MS = 30000

export class WinHelper {
	/**
	 * name: a short id for its folder; cs: C# to compile (optional); script: PowerShell that defines
	 * `Invoke-Request($line)` (returns one JSON reply line) and may set things up first.
	 */
	constructor({ name, cs = '', script, spawnFn = spawn, dir, timeout = 20000 }) {
		this.name = name
		this.cs = cs
		this.script = script
		this.version = helperVersion(cs, script)
		this.spawnFn = spawnFn
		this.dir = dir ?? helperDir(name, this.version)
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
		const f = { ps1: path.join(this.dir, 'helper.ps1'), script: path.join(this.dir, 'requests.ps1'), cs: '', dll: '' }
		await writeFile(f.ps1, HELPER_PS1)
		await writeFile(f.script, this.script)
		if (this.cs) {
			f.cs = path.join(this.dir, 'helper.cs')
			f.dll = path.join(this.dir, 'helper.dll')
			await writeFile(f.cs, this.cs)
		}
		return f
	}

	start() {
		if (this.closed) return Promise.reject(new Error('the Windows helper is closed'))
		if (this.child) return Promise.resolve()
		if (this.starting) return this.starting
		if (this.failed && Date.now() - this.failed.at < RETRY_MS) return Promise.reject(this.failed.error)
		this.starting = (async () => {
			const f = await this.#files()
			const child = this.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', f.ps1], {
				env: { ...process.env, CT_HELPER_CS: f.cs, CT_HELPER_DLL: f.dll, CT_HELPER_SCRIPT: f.script },
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
