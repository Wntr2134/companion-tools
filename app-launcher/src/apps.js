// Finding, launching and quitting desktop apps on macOS and Windows.
// No Companion dependency, so it can be tested on its own.
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const slug = (s) =>
	String(s)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '') || 'app'

/** Give every app a unique, stable id and sort by name. */
export function finaliseList(apps) {
	const sorted = [...apps].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
	const seen = new Set()
	for (const app of sorted) {
		let id = slug(app.name)
		while (seen.has(id)) id += '_'
		seen.add(id)
		app.id = id
	}
	return sorted
}

// ---------- macOS ----------

export function macFolders(includeSystem, home = os.homedir()) {
	const folders = ['/Applications', '/Applications/Utilities', path.join(home, 'Applications')]
	if (includeSystem) folders.push('/System/Applications', '/System/Applications/Utilities')
	return folders
}

/** .app bundles in the given folders, plus one level of sub-folders (e.g. "/Applications/Microsoft Office"). */
export async function scanMac(folders) {
	const apps = []
	const seen = new Set()
	const problems = []
	const visit = async (dir, depth) => {
		let entries
		try {
			entries = await readdir(dir, { withFileTypes: true })
		} catch (e) {
			// A missing folder is normal; anything else (e.g. Companion blocking file access) is reported.
			if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') problems.push(e)
			return
		}
		for (const e of entries) {
			const full = path.join(dir, e.name)
			if (e.name.endsWith('.app')) {
				if (seen.has(full)) continue
				seen.add(full)
				apps.push({ name: e.name.slice(0, -4), path: full })
			} else if (depth > 0 && e.isDirectory() && !e.name.startsWith('.')) {
				await visit(full, depth - 1)
			}
		}
	}
	for (const f of folders) await visit(f, 1)
	if (apps.length === 0 && problems.length) throw problems[0]
	return apps
}

/** Is the app running? `ps -axo comm=` lists each process's executable path. */
export function macRunning(psOutput, appPath) {
	const prefix = appPath.replace(/\/$/, '') + '/Contents/MacOS/'
	return String(psOutput)
		.split('\n')
		.some((line) => line.trim().startsWith(prefix))
}

// ---------- Windows ----------

/**
 * One PowerShell call lists every Start Menu shortcut with its target, as JSON.
 * Only shortcuts that point at an .exe are kept, so uninstallers' web links and help files drop out.
 */
export const WINDOWS_SCAN_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$sh = New-Object -ComObject WScript.Shell
$dirs = @("$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs")
$out = foreach ($d in $dirs) {
  Get-ChildItem -Path $d -Filter *.lnk -Recurse | ForEach-Object {
    $t = $sh.CreateShortcut($_.FullName).TargetPath
    [pscustomobject]@{ name = $_.BaseName; lnk = $_.FullName; target = $t }
  }
}
# Store apps (Calculator, Teams, Settings…) have no .exe shortcut: Get-StartApps lists them by AppID.
$store = @(Get-StartApps | Where-Object { $_.AppID -like '*!*' } | ForEach-Object { [pscustomobject]@{ name = $_.Name; appId = $_.AppID } })
[pscustomobject]@{ shortcuts = @($out); store = $store } | ConvertTo-Json -Compress -Depth 3
`.trim()

const SKIP_WINDOWS = /uninstall|^readme|^help$|release notes|^license/i

export function parseWindowsScan(json) {
	let parsed
	try {
		parsed = JSON.parse(String(json).trim() || '[]')
	} catch {
		return []
	}
	// New shape: { shortcuts: [...], store: [...] }. Older shape: just the shortcuts (array, or one object).
	const isNew = parsed && !Array.isArray(parsed) && ('shortcuts' in parsed || 'store' in parsed)
	let rows = isNew ? parsed.shortcuts ?? [] : parsed
	if (!Array.isArray(rows)) rows = rows ? [rows] : []
	let store = isNew ? parsed.store ?? [] : []
	if (!Array.isArray(store)) store = store ? [store] : []
	const apps = []
	const seen = new Set()
	for (const r of rows) {
		if (!r || typeof r.name !== 'string' || typeof r.lnk !== 'string') continue
		if (typeof r.target !== 'string' || !/\.exe$/i.test(r.target)) continue
		if (SKIP_WINDOWS.test(r.name)) continue
		const key = r.name.toLowerCase()
		if (seen.has(key)) continue // same shortcut in both Start Menus
		seen.add(key)
		apps.push({ name: r.name, path: r.lnk, exe: path.win32.basename(r.target) })
	}
	for (const st of store) {
		if (!st || typeof st.name !== 'string' || typeof st.appId !== 'string' || !st.appId.includes('!')) continue
		const key = st.name.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		// Opened through the Apps folder like the Start Menu does. No .exe, so no running check or quit.
		apps.push({ name: st.name, path: `shell:AppsFolder\\${st.appId}`, store: true })
	}
	return apps
}

/** `tasklist /FO CSV /NH` -> set of lower-case image names ("dantecontroller.exe"). */
export function parseTasklist(csv) {
	const names = new Set()
	for (const line of String(csv).split(/\r?\n/)) {
		const m = /^"([^"]+)"/.exec(line.trim())
		if (m) names.add(m[1].toLowerCase())
	}
	return names
}

// ---------- commands (as [file, args], never through a shell) ----------

export function launchCommand(app, platform = process.platform) {
	if (platform === 'darwin') return ['open', ['-a', app.path]]
	if (platform === 'win32') return ['explorer.exe', [app.path]] // explorer opens the shortcut like a double-click
	throw new Error(`Launching apps isn't supported on ${platform}`)
}

const appleScriptString = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'

/** A plain-English reason for common macOS automation refusals, or ''. */
export function macPermissionHint(text) {
	if (/-1743|not authori[sz]ed to send apple events/i.test(text)) return 'macOS blocked it: allow Companion to control that app in System Settings → Privacy & Security → Automation.'
	if (/-1719|-25211|assistive/i.test(text)) return 'macOS blocked it: allow Companion in System Settings → Privacy & Security → Accessibility.'
	return ''
}

export function quitCommand(app, { force = false } = {}, platform = process.platform) {
	if (platform === 'darwin') {
		if (force) return ['pkill', ['-f', app.path.replace(/\/$/, '') + '/Contents/MacOS/']]
		return ['osascript', ['-e', `quit app ${appleScriptString(app.name)}`]]
	}
	if (platform === 'win32') {
		if (!app.exe) throw new Error(app.store ? `${app.name} is a Store app: Windows doesn't say which program to quit` : `Don't know the program file for ${app.name}`)
		return ['taskkill', force ? ['/IM', app.exe, '/F'] : ['/IM', app.exe]]
	}
	throw new Error(`Quitting apps isn't supported on ${platform}`)
}

// ---------- running things ----------

export function run(file, args, { timeout = 15000 } = {}) {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
			// explorer.exe returns 1 even when it worked
			if (err && !(file === 'explorer.exe' && err.code === 1)) {
				err.stderr = String(stderr ?? '')
				return reject(err)
			}
			resolve(String(stdout ?? ''))
		})
	})
}

export async function scanApps({ platform = process.platform, includeSystem = false, extraFolders = [] } = {}) {
	if (platform === 'darwin') return finaliseList(await scanMac([...macFolders(includeSystem), ...extraFolders]))
	if (platform === 'win32') {
		const json = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCAN_SCRIPT], { timeout: 60000 })
		return finaliseList(parseWindowsScan(json))
	}
	return []
}

/** Ids of the listed apps that are running now. */
export async function runningApps(apps, platform = process.platform) {
	const running = new Set()
	if (platform === 'darwin') {
		const ps = await run('ps', ['-axo', 'comm='])
		for (const a of apps) if (macRunning(ps, a.path)) running.add(a.id)
	} else if (platform === 'win32') {
		const names = parseTasklist(await run('tasklist', ['/FO', 'CSV', '/NH']))
		for (const a of apps) if (a.exe && names.has(a.exe.toLowerCase())) running.add(a.id)
	}
	return running
}
