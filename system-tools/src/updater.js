// Keeps connections on the newest installed version of their module, so importing a new bundle is all it
// takes: no picking the new version on every connection. Companion's own "update policy" only follows
// modules from its store, so this uses Companion's REST API (Settings → REST API, with a key that has
// the "connections" and "write" scopes) to switch versions, and reads which versions are installed from
// Companion's modules folder. Only versions that are newer and not pre-releases are picked, and dev /
// built-in versions are left alone.
// No Companion dependency, so it can be tested on its own.
import { readdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Companion's config folder, where imported modules are kept (modules/<id>-<version>/). */
export function companionRoot(platform = process.platform, env = process.env, home = os.homedir()) {
	if (env.COMPANION_CONFIG_BASEDIR) return env.COMPANION_CONFIG_BASEDIR
	if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'companion')
	if (platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'companion')
	return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'companion')
}

/** Compares "1.2.10" and "1.2.9" the way semver does (numbers, then pre-releases before releases). */
export function compareVersions(a, b) {
	const parse = (v) => {
		const [main, pre = ''] = String(v).split('-')
		return { nums: main.split('.').map((n) => Number(n) || 0), pre }
	}
	const x = parse(a)
	const y = parse(b)
	for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
	if (x.pre === y.pre) return 0
	if (!x.pre) return 1
	if (!y.pre) return -1
	return x.pre < y.pre ? -1 : 1
}

/** Installed modules: Map moduleId -> { versions: [...], repository }. */
export async function scanInstalled(modulesDir) {
	const out = new Map()
	let dirs = []
	try {
		dirs = await readdir(modulesDir, { withFileTypes: true })
	} catch {
		return out
	}
	for (const d of dirs) {
		if (!d.isDirectory()) continue
		try {
			const m = JSON.parse(await readFile(path.join(modulesDir, d.name, 'companion', 'manifest.json'), 'utf8'))
			if (!m.id || !m.version) continue
			const entry = out.get(m.id) ?? { versions: [], repository: String(m.repository ?? '') }
			entry.versions.push(String(m.version))
			out.set(m.id, entry)
		} catch {
			// not a module folder
		}
	}
	return out
}

const OURS = /wntr2134\/companion-tools/i

/**
 * Which connections to move, and to what: [{ id, label, moduleId, from, to }].
 * connections: Companion's REST list. onlyOurs: just the companion-tools modules.
 */
export function planUpdates(connections, installed, { onlyOurs = true } = {}) {
	const plan = []
	for (const c of connections ?? []) {
		const from = c.moduleVersionId
		if (!from || from === 'dev' || from === 'builtin') continue
		const mod = installed.get(c.moduleId)
		if (!mod) continue
		if (onlyOurs && !OURS.test(mod.repository)) continue
		const releases = mod.versions.filter((v) => !v.includes('-'))
		const newest = releases.sort(compareVersions).at(-1)
		if (newest && compareVersions(newest, from) > 0) plan.push({ id: c.id, label: c.label, moduleId: c.moduleId, from, to: newest })
	}
	return plan
}

/** Talks to Companion's REST API on this computer. */
export class CompanionApi {
	constructor({ port, key, fetchFn = fetch }) {
		this.base = `http://127.0.0.1:${port}/api/v2/connections/v1`
		this.key = key
		this.fetch = fetchFn
	}

	async #call(method, url, body) {
		const res = await this.fetch(url, {
			method,
			headers: { Authorization: `Bearer ${this.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(10000),
		})
		const text = await res.text()
		if (!res.ok) {
			let why = text
			try {
				why = JSON.parse(text)?.error?.message ?? text
			} catch {
				// not JSON
			}
			if (res.status === 401) why = 'the API key was refused: check it in this connection\'s settings'
			if (res.status === 403) why = 'the API key needs the "connections" and "write" scopes'
			if (res.status === 404 || res.status === 503) why = "Companion's REST API is switched off: Settings → REST API"
			throw new Error(`${res.status}: ${why}`)
		}
		return text ? JSON.parse(text) : {}
	}

	async connections() {
		return (await this.#call('GET', `${this.base}/`)).data ?? []
	}

	async setVersion(connectionId, versionId) {
		return this.#call('PATCH', `${this.base}/${encodeURIComponent(connectionId)}`, { versionId })
	}
}
