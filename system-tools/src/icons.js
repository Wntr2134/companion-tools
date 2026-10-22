// App icons for app keys (Mac). macOS draws each app's icon (NSWorkspace iconForFile, so it works for
// every app, including ones that only ship an asset catalogue) into a PNG with the icon in the top part
// of the key, leaving room for the app's name underneath. PNGs are cached on disk and only redrawn when
// the app changes (a new version), so a rescan costs nothing once they're made.
// No Companion dependency, so it can be tested on its own.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const ICON_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Companion Tools', 'icons')
export const ICON_SIZE = 192 // px; the D200X keys are 196 px

/**
 * argv[0]: JSON { size, items: [{ path, out }] }. Draws each app's icon centred in the top ~72% of a
 * size×size transparent PNG. Prints JSON results.
 */
export const ICON_SCRIPT = String.raw`
ObjC.import('AppKit')
function run(argv) {
	const req = JSON.parse(argv[0])
	const S = req.size
	const s = Math.round(S * 0.7)
	const ws = $.NSWorkspace.sharedWorkspace
	const out = []
	for (const item of req.items) {
		try {
			const icon = ws.iconForFile(item.path)
			const canvas = $.NSImage.alloc.initWithSize($.NSMakeSize(S, S))
			canvas.lockFocus
			// Cocoa's origin is bottom-left: this puts the icon at the top, centred.
			icon.drawInRectFromRectOperationFraction($.NSMakeRect((S - s) / 2, S - s - Math.round(S * 0.04), s, s), $.NSZeroRect, 2, 1.0)
			canvas.unlockFocus
			const rep = $.NSBitmapImageRep.imageRepWithData(canvas.TIFFRepresentation)
			const png = rep.representationUsingTypeProperties(4, $())
			if (!png.writeToFileAtomically(item.out, true)) throw new Error('could not write ' + item.out)
			out.push({ path: item.path, ok: true })
		} catch (e) {
			out.push({ path: item.path, error: String((e && e.message) || e) })
		}
	}
	return JSON.stringify(out)
}
`

/** The cache file for an app: changes when the app is updated (its bundle's modified time). */
export function iconFile(appPath, mtimeMs, dir = ICON_DIR) {
	const key = createHash('sha1').update(`${appPath}|${Math.round(mtimeMs)}|v1`).digest('hex').slice(0, 20)
	return path.join(dir, `${key}.png`)
}

// Names people know by the second word, not the first.
const KNOWN = { 'audio hijack': 'Hijack', 'visual studio code': 'VS Code', 'final cut pro': 'Final Cut', 'logic pro': 'Logic', 'system settings': 'Settings', 'system preferences': 'Settings', 'activity monitor': 'Activity', 'dante virtual soundcard': 'Dante DVS', 'dante controller': 'Dante', 'universal capture': 'Echo360' }
const VENDORS = /^(Microsoft|Google|Adobe|Apple|Bitfocus|Rogue Amoeba|Affinity|JetBrains|Mozilla)\s+/i
const SUFFIXES = /\s+(Browser|Desktop|for Mac|App|Mail|Client|Player|Studio)$/i

/**
 * A name that fits on one line under an icon (about 9 characters on a 72 px key): known short forms,
 * then without the maker ("Google Chrome" → "Chrome") or a generic last word ("Brave Browser" → "Brave"),
 * then the first word, then cut.
 */
export function shortName(name, max = 9) {
	let n = String(name ?? '')
		.replace(/\.app$/i, '')
		.trim()
	if (KNOWN[n.toLowerCase()]) return KNOWN[n.toLowerCase()]
	if (n.length <= max) return n
	n = n.replace(VENDORS, '')
	if (n.length > max) n = n.replace(SUFFIXES, '')
	if (n.length > max && n.includes(' ')) n = n.split(/\s+/)[0]
	return n.length > max ? `${n.slice(0, max - 1)}…` : n
}

export class IconCache {
	constructor({ exec = execFile, dir = ICON_DIR, size = ICON_SIZE } = {}) {
		this.exec = exec
		this.dir = dir
		this.size = size
		this.png64 = new Map() // app path -> base64 PNG
	}

	/** The icon for an app path, if it's been made. */
	get(appPath) {
		return this.png64.get(appPath)
	}

	/** Makes (or loads from disk) icons for these app paths. Returns how many are ready. */
	async ensure(appPaths) {
		await mkdir(this.dir, { recursive: true })
		const missing = []
		for (const p of new Set(appPaths)) {
			let file
			try {
				file = iconFile(p, (await stat(p)).mtimeMs, this.dir)
			} catch {
				continue // the app has gone
			}
			try {
				this.png64.set(p, (await readFile(file)).toString('base64'))
			} catch {
				missing.push({ path: p, out: file })
			}
		}
		// One script run for all the new ones, in batches so a huge Applications folder can't time out.
		for (let i = 0; i < missing.length; i += 60) {
			const batch = missing.slice(i, i + 60)
			await new Promise((resolve) => {
				this.exec('osascript', ['-l', 'JavaScript', '-e', ICON_SCRIPT, JSON.stringify({ size: this.size, items: batch })], { timeout: 120000 }, () => resolve())
			})
			for (const m of batch) {
				try {
					this.png64.set(m.path, (await readFile(m.out)).toString('base64'))
				} catch {
					// no icon for this one: the key just shows the name
				}
			}
		}
		return this.png64.size
	}
}
