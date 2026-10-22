// Moving and sizing app windows on a Mac, across screens, without Magnet or any other helper.
// One JavaScript-for-Automation (JXA) script does the work through System Events (needs Companion
// to be allowed under Privacy & Security → Accessibility). Requests go in as JSON in argv, never
// pasted into the script.
import { execFile } from 'node:child_process'

/** Where on a screen a window goes, as fractions of the screen's usable area (menu bar and Dock left out). */
export const POSITIONS = {
	full: { label: 'Fill the screen', short: 'FILL', rect: { x: 0, y: 0, w: 1, h: 1 } },
	left: { label: 'Left half', short: 'LEFT ½', rect: { x: 0, y: 0, w: 0.5, h: 1 } },
	right: { label: 'Right half', short: 'RIGHT ½', rect: { x: 0.5, y: 0, w: 0.5, h: 1 } },
	top: { label: 'Top half', short: 'TOP ½', rect: { x: 0, y: 0, w: 1, h: 0.5 } },
	bottom: { label: 'Bottom half', short: 'BOTTOM ½', rect: { x: 0, y: 0.5, w: 1, h: 0.5 } },
	left_third: { label: 'Left third', short: 'LEFT ⅓', rect: { x: 0, y: 0, w: 1 / 3, h: 1 } },
	centre_third: { label: 'Centre third', short: 'MIDDLE ⅓', rect: { x: 1 / 3, y: 0, w: 1 / 3, h: 1 } },
	right_third: { label: 'Right third', short: 'RIGHT ⅓', rect: { x: 2 / 3, y: 0, w: 1 / 3, h: 1 } },
	left_two_thirds: { label: 'Left two-thirds', short: 'LEFT ⅔', rect: { x: 0, y: 0, w: 2 / 3, h: 1 } },
	right_two_thirds: { label: 'Right two-thirds', short: 'RIGHT ⅔', rect: { x: 1 / 3, y: 0, w: 2 / 3, h: 1 } },
	top_left: { label: 'Top-left quarter', short: 'TOP\\nLEFT', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
	top_right: { label: 'Top-right quarter', short: 'TOP\\nRIGHT', rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
	bottom_left: { label: 'Bottom-left quarter', short: 'BOTTOM\\nLEFT', rect: { x: 0, y: 0.5, w: 0.5, h: 0.5 } },
	bottom_right: { label: 'Bottom-right quarter', short: 'BOTTOM\\nRIGHT', rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
	big_centre: { label: 'Centre, large (80%)', short: 'CENTRE\\nLARGE', rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } },
	centre: { label: 'Centre (keep its size)', short: 'CENTRE', rect: 'centre' },
	keep: { label: 'Same place, other screen (keep its size and spot)', short: 'MOVE', rect: 'keep' },
}

/** Words people type in a layout line, to position ids. */
const POSITION_WORDS = {
	fill: 'full',
	full: 'full',
	max: 'full',
	maximise: 'full',
	maximize: 'full',
	left: 'left',
	right: 'right',
	top: 'top',
	bottom: 'bottom',
	'left third': 'left_third',
	'centre third': 'centre_third',
	'center third': 'centre_third',
	'middle third': 'centre_third',
	'right third': 'right_third',
	'left two thirds': 'left_two_thirds',
	'right two thirds': 'right_two_thirds',
	'top left': 'top_left',
	'top right': 'top_right',
	'bottom left': 'bottom_left',
	'bottom right': 'bottom_right',
	'centre large': 'big_centre',
	'center large': 'big_centre',
	centre: 'centre',
	center: 'centre',
	keep: 'keep',
}

export function positionFromWords(text) {
	const key = String(text ?? '')
		.toLowerCase()
		.replace(/[-_]/g, ' ')
		.replace(/\bhalf\b/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	if (POSITIONS[key.replace(/ /g, '_')]) return key.replace(/ /g, '_')
	return POSITION_WORDS[key] ?? null
}

/**
 * A layout written as lines of "App, screen, position", e.g.
 *   Resolume Arena, 2, fill
 *   Dante Controller, 1, left
 * Blank lines and lines starting with # are skipped. Returns { items, errors }.
 */
export function parseLayout(text) {
	const items = []
	const errors = []
	String(text ?? '')
		.split(/\r?\n/)
		.forEach((raw, i) => {
			const line = raw.trim()
			if (!line || line.startsWith('#')) return
			const parts = line.split(',').map((s) => s.trim())
			if (parts.length < 3) return errors.push(`Line ${i + 1}: needs "app, screen, position"`)
			const position = parts.pop()
			const screen = parts.pop()
			const app = parts.join(',').trim()
			const pos = positionFromWords(position)
			const s = screen.toLowerCase()
			const scr = /^\d+$/.test(s) ? Number(s) : s === 'prev' ? 'previous' : ['same', 'next', 'previous'].includes(s) ? s : null
			if (!app) return errors.push(`Line ${i + 1}: no app name`)
			if (!pos) return errors.push(`Line ${i + 1}: "${position}" isn't a position (try fill, left, right, top left, left third…)`)
			if (scr === null) return errors.push(`Line ${i + 1}: "${screen}" isn't a screen number`)
			items.push({ app, screen: scr, position: pos })
		})
	return { items, errors }
}

/** The JXA script. argv[0] is a JSON request: { cmd: 'screens' | 'place' | 'capture' | 'hide_others' | 'show_all' | 'minimise', ... }. */
export const WINDOW_SCRIPT = String.raw`
ObjC.import('AppKit')
const se = Application('System Events')

function screens() {
	const list = $.NSScreen.screens
	const H = list.objectAtIndex(0).frame.size.height
	const out = []
	for (let i = 0; i < list.count; i++) {
		const s = list.objectAtIndex(i)
		const f = s.frame
		const v = s.visibleFrame
		out.push({
			name: ObjC.unwrap(s.localizedName) || 'Screen',
			x: Math.round(v.origin.x),
			y: Math.round(H - (v.origin.y + v.size.height)),
			w: Math.round(v.size.width),
			h: Math.round(v.size.height),
			full: { x: Math.round(f.origin.x), y: Math.round(H - (f.origin.y + f.size.height)), w: Math.round(f.size.width), h: Math.round(f.size.height) },
		})
	}
	// Screen 1 is the one with the menu bar; the rest are numbered left to right.
	const rest = out.slice(1).sort((a, b) => a.full.x - b.full.x || a.full.y - b.full.y)
	return [out[0]].concat(rest)
}

function bundleIdFor(item) {
	if (item.bundleId) return item.bundleId
	if (item.path) {
		const b = $.NSBundle.bundleWithPath(item.path)
		if (b && !b.isNil()) {
			const id = ObjC.unwrap(b.bundleIdentifier)
			if (id) return id
		}
	}
	return ''
}

function findProcess(item) {
	if (!item.app && !item.path && !item.bundleId) {
		const front = se.processes.whose({ frontmost: true })
		return front.length ? front[0] : null
	}
	const id = bundleIdFor(item)
	let found = id ? se.processes.whose({ bundleIdentifier: id }) : null
	if (!found || !found.length) found = se.processes.whose({ name: item.app })
	return found.length ? found[0] : null
}

function launch(item) {
	const me = Application.currentApplication()
	me.includeStandardAdditions = true
	const id = bundleIdFor(item)
	const q = (s) => "'" + String(s).split("'").join("'\\''") + "'"
	if (id) me.doShellScript('open -b ' + q(id))
	else me.doShellScript('open -a ' + q(item.path || item.app))
}

function frontWindow(p, wait) {
	for (let t = 0; t <= wait * 4; t++) {
		try {
			const ws = p.windows()
			for (const w of ws) {
				let sub = ''
				try { sub = w.subrole() } catch (e) {}
				if (sub && sub !== 'AXStandardWindow' && sub !== 'AXDialog') continue
				return w
			}
		} catch (e) {}
		if (t < wait * 4) delay(0.25)
	}
	return null
}

function attr(w, name) {
	try { return w.attributes.byName(name).value() } catch (e) { return undefined }
}

function frameOf(w) {
	const p = w.position()
	const s = w.size()
	return { x: p[0], y: p[1], w: s[0], h: s[1] }
}

function screenIndexOf(r, list) {
	const cx = r.x + r.w / 2
	const cy = r.y + r.h / 2
	for (let i = 0; i < list.length; i++) {
		const f = list[i].full
		if (cx >= f.x && cx < f.x + f.w && cy >= f.y && cy < f.y + f.h) return i
	}
	return 0
}

function setFrame(w, r) {
	// Size first (so it fits where it's going), then move, then size again (macOS may have
	// limited the size while the window was still on the smaller screen).
	try { w.size = [r.w, r.h] } catch (e) {}
	w.position = [r.x, r.y]
	try { w.size = [r.w, r.h] } catch (e) {}
}

function targetRect(item, cur, list) {
	if (item.abs) return item.abs
	const here = screenIndexOf(cur, list)
	let idx = here
	if (item.screen === 'next') idx = (here + 1) % list.length
	else if (item.screen === 'previous') idx = (here - 1 + list.length) % list.length
	else if (typeof item.screen === 'number') idx = item.screen - 1
	if (idx < 0 || idx >= list.length) throw new Error('there is no screen ' + (idx + 1) + ' (' + list.length + ' connected)')
	const s = list[idx]
	const r = item.rect
	if (r === 'centre') {
		const w = Math.min(cur.w, s.w)
		const h = Math.min(cur.h, s.h)
		return { x: Math.round(s.x + (s.w - w) / 2), y: Math.round(s.y + (s.h - h) / 2), w: w, h: h }
	}
	if (r === 'keep') {
		const from = list[here]
		const w = Math.min(cur.w, s.w)
		const h = Math.min(cur.h, s.h)
		const fx = from.w > cur.w ? (cur.x - from.x) / (from.w - cur.w) : 0
		const fy = from.h > cur.h ? (cur.y - from.y) / (from.h - cur.h) : 0
		const clamp = (v) => Math.max(0, Math.min(1, v))
		return { x: Math.round(s.x + clamp(fx) * (s.w - w)), y: Math.round(s.y + clamp(fy) * (s.h - h)), w: w, h: h }
	}
	return { x: Math.round(s.x + r.x * s.w), y: Math.round(s.y + r.y * s.h), w: Math.round(r.w * s.w), h: Math.round(r.h * s.h) }
}

function place(item, list) {
	let p = findProcess(item)
	if (!p && item.launch) {
		launch(item)
		for (let t = 0; t < 40 && !p; t++) {
			delay(0.25)
			p = findProcess(item)
		}
	}
	if (!p) return { app: item.app || 'front window', error: 'not open' }
	const name = p.name()
	let w = null
	if (item.title) {
		try {
			const named = p.windows.whose({ name: item.title })
			if (named.length) w = named[0]
		} catch (e) {}
	}
	if (!w && typeof item.index === 'number') {
		try { w = p.windows()[item.index] || null } catch (e) {}
	}
	if (!w) w = frontWindow(p, item.launch ? 8 : 0)
	if (!w) return { app: name, error: 'no window to move' }
	if (attr(w, 'AXFullScreen') === true) return { app: name, error: 'is in full screen (green button): take it out of full screen first' }
	if (attr(w, 'AXMinimized') === true) {
		try { w.attributes.byName('AXMinimized').value = false } catch (e) {}
	}
	const r = targetRect(item, frameOf(w), list)
	setFrame(w, r)
	if (item.raise) {
		try { w.actions.byName('AXRaise').perform() } catch (e) {}
	}
	return { app: name, ok: true, x: r.x, y: r.y, w: r.w, h: r.h }
}

function capture() {
	const out = []
	const procs = se.processes.whose({ backgroundOnly: false, visible: true })()
	for (const p of procs) {
		let ws = []
		try { ws = p.windows() } catch (e) { continue }
		const windows = []
		for (let i = 0; i < ws.length && windows.length < 4; i++) {
			const w = ws[i]
			let sub = ''
			try { sub = w.subrole() } catch (e) {}
			if (sub && sub !== 'AXStandardWindow') continue
			if (attr(w, 'AXMinimized') === true || attr(w, 'AXFullScreen') === true) continue
			let title = ''
			try { title = w.name() || '' } catch (e) {}
			const f = frameOf(w)
			windows.push({ title: title, index: i, x: f.x, y: f.y, w: f.w, h: f.h })
		}
		if (!windows.length) continue
		let id = ''
		try { id = p.bundleIdentifier() || '' } catch (e) {}
		out.push({ app: p.name(), bundleId: id, windows: windows })
	}
	return out
}

function run(argv) {
	const req = JSON.parse(argv[0])
	const list = screens()
	let result
	if (req.cmd === 'screens') result = list
	else if (req.cmd === 'place') {
		result = req.items.map(function (item) {
			try { return place(item, list) } catch (e) { return { app: item.app || 'front window', error: String((e && e.message) || e) } }
		})
	} else if (req.cmd === 'capture') result = capture()
	else if (req.cmd === 'hide_others') {
		const keep = findProcess(req.item)
		const keepName = keep ? keep.name() : ''
		const procs = se.processes.whose({ backgroundOnly: false, visible: true })()
		for (const p of procs) {
			try { if (p.name() !== keepName && p.name() !== 'Finder') p.visible = false } catch (e) {}
		}
		if (keep) keep.frontmost = true
		result = { ok: true }
	} else if (req.cmd === 'show_all') {
		const procs = se.processes.whose({ backgroundOnly: false, visible: false })()
		for (const p of procs) {
			try { p.visible = true } catch (e) {}
		}
		result = { ok: true }
	} else if (req.cmd === 'hide') {
		const p = findProcess(req.item)
		if (p) p.visible = false
		result = { ok: !!p }
	} else if (req.cmd === 'minimise') {
		const p = findProcess(req.item)
		const w = p && frontWindow(p, 0)
		if (w) w.attributes.byName('AXMinimized').value = true
		result = { ok: !!w }
	} else throw new Error('unknown command')
	return JSON.stringify(result)
}
`

/** Runs WINDOW_SCRIPT with one request. */
export function windowRequest(request, { exec = execFile, timeout = 30000 } = {}) {
	return new Promise((resolve, reject) => {
		exec('osascript', ['-l', 'JavaScript', '-e', WINDOW_SCRIPT, JSON.stringify(request)], { timeout }, (err, stdout, stderr) => {
			if (err) return reject(new Error(String(stderr || err.message).trim()))
			try {
				resolve(JSON.parse(String(stdout).trim() || 'null'))
			} catch {
				reject(new Error(`Unexpected reply: ${String(stdout).slice(0, 200)}`))
			}
		})
	})
}

/** A request item for one window. `app` is { name, path } from the app list, or null for the front window. */
export function placeItem(app, screen, position, { launch = false } = {}) {
	const pos = POSITIONS[position] ?? POSITIONS.full
	return {
		app: app?.name ?? '',
		path: app?.path ?? '',
		screen: screen === 'same' ? 'same' : screen,
		rect: pos.rect,
		launch,
		raise: true,
	}
}

/** A saved layout (from 'capture') as place items: windows matched by title, then by position in the list. */
export function restoreItems(saved, { launch = false } = {}) {
	const items = []
	for (const a of saved ?? []) {
		for (const w of a.windows ?? []) {
			items.push({ app: a.app, bundleId: a.bundleId, title: w.title, index: w.index, abs: { x: w.x, y: w.y, w: w.w, h: w.h }, launch })
		}
	}
	return items
}

/** One line for the log from the 'place' results. */
export function summarise(results) {
	const bad = (results ?? []).filter((r) => r.error)
	const good = (results ?? []).length - bad.length
	return { good, bad, text: bad.map((r) => `${r.app}: ${r.error}`).join('; ') }
}
