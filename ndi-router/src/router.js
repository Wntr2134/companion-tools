// Route bookkeeping, kept separate from Companion so it can be tested with a fake NDI library.
import { EventEmitter } from 'node:events'
import { isOwnRoute } from './ndi.js'

/** Route names from the settings text: one per line, trimmed, no duplicates, max 16. */
export function parseRouteNames(text) {
	const out = []
	for (const line of String(text ?? '').split(/\r?\n/)) {
		const name = line.trim().replace(/[()]/g, '')
		if (name && !out.includes(name)) out.push(name)
	}
	return out.slice(0, 16)
}

/**
 * Keeps the NDI routes, what each one shows, the list of sources and how many receivers watch each route.
 * Events: 'sources' (list changed), 'routes' (a target or receiver count changed).
 */
export class Router extends EventEmitter {
	constructor(ndi, routeNames, saved = {}) {
		super()
		this.ndi = ndi
		this.names = routeNames
		this.routes = new Map() // name -> { handle, target, connections }
		this.sourceList = []
		for (const name of routeNames) {
			const handle = ndi.createRoute(name)
			const target = typeof saved[name] === 'string' && saved[name] ? saved[name] : ''
			if (target) handle.change(target) // bring back what it showed before Companion restarted
			this.routes.set(name, { handle, target, connections: null })
		}
	}

	route(name, source) {
		const r = this.routes.get(name)
		if (!r || !source) return false
		if (isOwnRoute(source, this.names)) return false // would loop
		const ok = r.handle.change(source)
		if (ok) {
			r.target = source
			this.emit('routes')
		}
		return ok
	}

	clear(name) {
		const r = this.routes.get(name)
		if (!r) return false
		r.handle.clear()
		r.target = ''
		this.emit('routes')
		return true
	}

	targetOf(name) {
		return this.routes.get(name)?.target ?? ''
	}

	/** { routeName: sourceName } for saving. */
	snapshot() {
		const out = {}
		for (const [name, r] of this.routes) if (r.target) out[name] = r.target
		return out
	}

	poll() {
		const list = this.ndi
			.sources()
			.filter((s) => !isOwnRoute(s, this.names))
			.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
		if (list.length !== this.sourceList.length || list.some((s, i) => s !== this.sourceList[i])) {
			this.sourceList = list
			this.emit('sources')
		}
		let changed = false
		for (const r of this.routes.values()) {
			const c = r.handle.connections()
			if (c !== r.connections) {
				r.connections = c
				changed = true
			}
		}
		if (changed) this.emit('routes')
	}

	destroy() {
		for (const r of this.routes.values()) r.handle.destroy()
		this.routes.clear()
		this.ndi.destroy()
	}
}
