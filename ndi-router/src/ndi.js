// Talks to the NDI runtime that NDI Tools installs, through koffi (a C bridge for Node).
// Only the finder and routing parts of the NDI SDK are used: no video passes through Companion.
import koffi from 'koffi'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

// ---------- finding the NDI library ----------

/** Where the NDI runtime usually lives. The NDI Tools apps also carry their own copy. */
export function candidateLibraries({ platform = process.platform, env = process.env, exists = existsSync, list = safeList } = {}) {
	const out = []
	const add = (p) => p && !out.includes(p) && out.push(p)
	if (platform === 'win32') {
		const dll = process.arch === 'arm64' ? 'Processing.NDI.Lib.arm64.dll' : 'Processing.NDI.Lib.x64.dll'
		for (const v of ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5']) if (env[v]) add(path.win32.join(env[v], dll))
		const pf = env.ProgramFiles || 'C:\\Program Files'
		const ndiRoot = path.win32.join(pf, 'NDI')
		// e.g. C:\Program Files\NDI\NDI 6 Runtime\v6, C:\Program Files\NDI\NDI 6 Tools\Router
		for (const a of list(ndiRoot)) {
			const dirA = path.win32.join(ndiRoot, a)
			add(path.win32.join(dirA, dll))
			for (const b of list(dirA)) add(path.win32.join(dirA, b, dll))
		}
	} else if (platform === 'darwin') {
		for (const v of ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5']) if (env[v]) add(path.join(env[v], 'libndi.dylib'))
		add('/usr/local/lib/libndi.dylib')
		add('/Library/NDI SDK for Apple/lib/macOS/libndi.dylib')
		add('/Library/NDI SDK for Apple/lib/macOS/libndi_advanced.dylib')
		// Inside the NDI Tools apps: /Applications/NDI Video Monitor.app/Contents/Frameworks/libndi*.dylib
		const appDirs = ['/Applications', '/Applications/NDI Tools']
		for (const dir of appDirs) {
			for (const app of list(dir).filter((n) => /^NDI.*\.app$/i.test(n))) {
				for (const sub of ['Contents/Frameworks', 'Contents/MacOS', 'Contents/Resources']) {
					const d = path.join(dir, app, sub)
					for (const f of list(d).filter((n) => /^libndi.*\.dylib$/i.test(n))) add(path.join(d, f))
				}
			}
		}
	} else {
		add('/usr/lib/libndi.so')
		add('/usr/local/lib/libndi.so')
	}
	return out.filter((p) => exists(p))
}

function safeList(dir) {
	try {
		return readdirSync(dir)
	} catch {
		return []
	}
}

// ---------- the binding ----------

const NDIlib_source_t = koffi.struct('NDIlib_source_t', {
	p_ndi_name: 'const char *',
	p_url_address: 'const char *', // a union with p_ip_address in the SDK; same size
})
const NDIlib_find_create_t = koffi.struct('NDIlib_find_create_t', {
	show_local_sources: 'bool',
	p_groups: 'const char *',
	p_extra_ips: 'const char *',
})
const NDIlib_routing_create_t = koffi.struct('NDIlib_routing_create_t', {
	p_ndi_name: 'const char *',
	p_groups: 'const char *',
})

/**
 * Opens the NDI library at `libPath` and returns a small API:
 * sources(), createRoute(name), and destroy(). Throws with a readable message if it can't.
 */
export function openNdi(libPath, { groups = null, extraIps = null } = {}) {
	const lib = koffi.load(libPath)
	const fn = {
		initialize: lib.func('bool NDIlib_initialize()'),
		destroy: lib.func('void NDIlib_destroy()'),
		findCreate: lib.func('void *NDIlib_find_create_v2(const NDIlib_find_create_t *settings)'),
		findDestroy: lib.func('void NDIlib_find_destroy(void *instance)'),
		findSources: lib.func('const NDIlib_source_t *NDIlib_find_get_current_sources(void *instance, _Out_ uint32_t *count)'),
		routeCreate: lib.func('void *NDIlib_routing_create(const NDIlib_routing_create_t *settings)'),
		routeDestroy: lib.func('void NDIlib_routing_destroy(void *instance)'),
		routeChange: lib.func('bool NDIlib_routing_change(void *instance, const NDIlib_source_t *source)'),
		routeClear: lib.func('bool NDIlib_routing_clear(void *instance)'),
	}
	let connections = null
	try {
		connections = lib.func('int NDIlib_routing_get_no_connections(void *instance, uint32_t timeout)')
	} catch {
		// older runtimes: no "in use" feedback
	}
	let version = ''
	try {
		version = lib.func('const char *NDIlib_version()')() ?? ''
	} catch {
		// not important
	}

	if (!fn.initialize()) throw new Error('NDI would not start (NDIlib_initialize failed: is the CPU supported?)')
	const finder = fn.findCreate({ show_local_sources: true, p_groups: groups || null, p_extra_ips: extraIps || null })
	if (!finder) throw new Error('NDI source finder could not start')

	const routes = new Set()
	// NDI Router passes each source's address along with its name; we do the same once the finder has seen it.
	const urlByName = new Map()
	return {
		version,
		path: libPath,
		/** Names of the NDI sources on the network right now, e.g. "STUDIO-PC (Cam 1)". */
		sources() {
			const count = [0]
			const ptr = fn.findSources(finder, count)
			if (!ptr || !count[0]) return []
			const list = koffi.decode(ptr, NDIlib_source_t, count[0]).filter((s) => typeof s.p_ndi_name === 'string' && s.p_ndi_name)
			for (const s of list) if (s.p_url_address) urlByName.set(s.p_ndi_name, s.p_url_address)
			return list.map((s) => s.p_ndi_name)
		},
		/** The address the finder reported for a source, if any. */
		urlOf(name) {
			return urlByName.get(name) ?? null
		},
		/** A new NDI source called `name` that shows whatever it is pointed at. */
		createRoute(name) {
			const handle = fn.routeCreate({ p_ndi_name: name, p_groups: groups || null })
			if (!handle) throw new Error(`NDI would not create the route "${name}"`)
			routes.add(handle)
			return {
				change: (sourceName) => fn.routeChange(handle, { p_ndi_name: sourceName, p_url_address: urlByName.get(sourceName) ?? null }),
				clear: () => fn.routeClear(handle),
				/** How many receivers (e.g. Virtual Input) are watching it, or null if unknown. */
				connections: () => (connections ? connections(handle, 0) : null),
				destroy: () => {
					if (!routes.delete(handle)) return
					fn.routeDestroy(handle)
				},
			}
		},
		destroy() {
			for (const h of routes) fn.routeDestroy(h)
			routes.clear()
			fn.findDestroy(finder)
			// NDIlib_destroy is left out on purpose: other code in the same process may still use NDI.
		},
	}
}

// ---------- names ----------

/** "STUDIO-PC (Cam 1)" -> { machine: 'STUDIO-PC', name: 'Cam 1' } */
export function splitSourceName(full) {
	const m = /^(.*?) \((.*)\)$/.exec(String(full))
	return m ? { machine: m[1], name: m[2] } : { machine: '', name: String(full) }
}

/** True if `full` is one of our own routes (so it isn't offered as a source: routing a route to itself loops). */
export function isOwnRoute(full, routeNames) {
	const { name } = splitSourceName(full)
	return routeNames.includes(name)
}
