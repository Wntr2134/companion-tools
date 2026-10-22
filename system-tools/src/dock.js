// The apps in the Mac's Dock, in Dock order, so "Your Dock" keys are the user's own favourite apps with
// no setting up. Read from the Dock's own settings (`defaults export com.apple.dock -`), which needs no
// permission. Finder is always first in the Dock but isn't stored there, so it's added.
// No Companion dependency, so it can be tested on its own.
import { execFile } from 'node:child_process'

export const DOCK_SLOTS = 16
export const FINDER = { name: 'Finder', path: '/System/Library/CoreServices/Finder.app' }

const unescapeXml = (s) =>
	s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&amp;/g, '&')

/** file:///Applications/Dante%20Controller.app/ -> /Applications/Dante Controller.app */
export function fileUrlToPath(url) {
	const m = /^file:\/\/(?:localhost)?(\/.*)$/.exec(String(url ?? ''))
	if (!m) return ''
	try {
		return decodeURIComponent(m[1]).replace(/\/$/, '')
	} catch {
		return ''
	}
}

/**
 * The Dock's apps from its exported settings (XML property list): [{ name, path }], Finder first.
 * Spacers, folders and files (the right-hand side of the Dock) are left out.
 */
export function parseDock(xml) {
	const text = String(xml ?? '')
	const start = text.indexOf('<key>persistent-apps</key>')
	if (start < 0) return [FINDER]
	// The persistent-apps array ends where the next top-level key starts.
	const rest = text.slice(start + '<key>persistent-apps</key>'.length)
	const next = rest.search(/\n\t<key>/)
	const section = next >= 0 ? rest.slice(0, next) : rest
	const apps = [FINDER]
	const seen = new Set([FINDER.path])
	// Each tile is a <dict> with a "tile-data" dict holding file-label and file-data → _CFURLString.
	for (const tile of section.split(/<key>tile-data<\/key>/).slice(1)) {
		const label = /<key>file-label<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(tile)?.[1]
		const url = /<key>_CFURLString<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(tile)?.[1]
		if (!label || !url) continue
		const p = fileUrlToPath(unescapeXml(url))
		if (!p.endsWith('.app') || seen.has(p)) continue
		seen.add(p)
		apps.push({ name: unescapeXml(label), path: p })
	}
	return apps.slice(0, DOCK_SLOTS)
}

export function readDock(exec = execFile) {
	return new Promise((resolve, reject) => {
		exec('defaults', ['export', 'com.apple.dock', '-'], { timeout: 10000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
			if (err) return reject(err)
			resolve(parseDock(String(stdout)))
		})
	})
}
