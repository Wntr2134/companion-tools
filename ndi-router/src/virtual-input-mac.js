// Mac only: switch NDI Virtual Input's source by using the source drop-down at the bottom of its
// window, as a person would. NDI Virtual Input has no API, so this drives it through System Events
// (needs Accessibility permission for Companion). Runs as JavaScript for Automation via osascript.
//
// The drop-down lists "None", then one entry per computer; each computer has a submenu of its
// sources (e.g. Theatrette > Channel 1). The drop-down's value is the full NDI name of what's
// showing, e.g. "WILLS-MACBOOK-PRO-4.LOCAL (Companion 1)".
import { execFile } from 'node:child_process'

/**
 * argv: [processName, mode ('select' | 'read' | 'list'), fullName, machine, shortName]
 * Returns 'OK:<value>' after select, '<value>' for read, a JSON list for list, or 'ERR:<code>[:detail]'.
 */
export const MENU_SCRIPT = `
function run(argv) {
	var procName = argv[0], mode = argv[1], full = argv[2], machine = argv[3], short = argv[4]
	var se = Application('System Events')
	var safe = function (f, d) { try { var v = f(); return v === null || v === undefined ? d : v } catch (e) { return d } }
	var same = function (a, b) { return String(a).toLowerCase() === String(b).toLowerCase() }
	if (se.processes.whose({ name: procName }).length === 0) return 'ERR:not-running'
	var proc = se.processes.byName(procName)
	var wins = safe(function () { return proc.windows() }, [])
	if (!wins.length) return 'ERR:no-window'

	// The source drop-down can sit anywhere in the window (groups, split views…): search every element.
	var KINDS = ['AXPopUpButton', 'AXMenuButton', 'AXComboBox']
	var popup = null, seen = {}
	for (var w = 0; w < wins.length && !popup; w++) {
		var all = safe(function () { return wins[w].entireContents() }, [])
		var hits = []
		for (var e = 0; e < all.length; e++) {
			var role = safe(function () { return all[e].role() }, '')
			if (role) seen[role] = (seen[role] || 0) + 1
			if (KINDS.indexOf(role) >= 0) hits.push(all[e])
		}
		// Prefer the one showing an NDI name like "MACHINE (Source)"; otherwise the last one (it's at the bottom).
		for (var h = 0; h < hits.length && !popup; h++) {
			var hv = String(safe(function () { return hits[h].value() }, ''))
			if (hv.indexOf(' (') > 0 && hv.charAt(hv.length - 1) === ')') popup = hits[h]
		}
		if (!popup && hits.length) popup = hits[hits.length - 1]
	}
	if (!popup) {
		var summary = []
		for (var r in seen) summary.push(r + ' x' + seen[r])
		return 'ERR:no-dropdown:' + summary.join(', ')
	}
	var current = function () { return safe(function () { return popup.value() }, '') }
	if (mode === 'read') return current()

	// First try to set the drop-down's value directly: nothing appears on screen if the app allows it.
	if (mode === 'select' && full) {
		try {
			popup.value = full
			delay(0.15)
			if (same(current(), full)) return 'OK:' + current()
		} catch (e) {}
	}

	var close = function () { se.keyCode(53) }
	var title = function (i) { return safe(function () { return i.name() }, '') }
	var subOf = function (i) { return safe(function () { var m = i.menus(); return m.length ? m[0] : null }, null) }

	popup.click()
	delay(0.3)
	var items = safe(function () { return popup.menus[0].menuItems() }, [])
	if (!items.length) { close(); return 'ERR:no-dropdown' }

	if (mode === 'list') {
		var out = []
		for (var a = 0; a < items.length; a++) {
			var t = title(items[a])
			var sub = subOf(items[a])
			if (sub) {
				items[a].click()
				delay(0.2)
				var kids = safe(function () { return sub.menuItems() }, [])
				for (var b = 0; b < kids.length; b++) out.push(t + ' > ' + title(kids[b]))
				close()
				popup.click()
				delay(0.3)
				items = safe(function () { return popup.menus[0].menuItems() }, items)
			} else if (t) out.push(t)
		}
		close()
		return JSON.stringify(out)
	}

	// "None" or a flat "MACHINE (Source)" entry
	for (var i = 0; i < items.length; i++) {
		var name = title(items[i])
		if (same(name, full) || (!full && same(name, 'None'))) {
			items[i].click()
			delay(0.2)
			return 'OK:' + current()
		}
	}
	// Computer > source
	for (var j = 0; j < items.length; j++) {
		var submenu = subOf(items[j])
		if (submenu && same(title(items[j]), machine)) {
			items[j].click()
			delay(0.25)
			var children = safe(function () { return submenu.menuItems() }, [])
			for (var k = 0; k < children.length; k++) {
				var ct = title(children[k])
				if (same(ct, short) || same(ct, full)) {
					children[k].click()
					delay(0.2)
					return 'OK:' + current()
				}
			}
		}
	}
	close()
	return 'ERR:not-found'
}
`

const FRIENDLY = {
	'not-running': 'NDI Virtual Input is not running. Open it first.',
	'no-window': "NDI Virtual Input's window is closed. Open it (it can sit behind other windows or be minimised to the side, but not closed).",
	'no-dropdown': "Couldn't find the source drop-down in NDI Virtual Input's window. Elements found:",
	'not-found': "That source isn't in NDI Virtual Input's drop-down (use the \"list\" action to see what is).",
}

/** Run the script. Resolves the script's answer; rejects with a readable message. */
export function runMenuScript({ processName, mode, full = '', machine = '', short = '' }, exec = execFile) {
	return new Promise((resolve, reject) => {
		exec(
			'osascript',
			['-l', 'JavaScript', '-e', MENU_SCRIPT, processName, mode, full, machine, short],
			{ timeout: 8000 },
			(err, stdout, stderr) => {
				const out = String(stdout ?? '').trim()
				if (err) {
					const text = String(stderr || err.message)
					if (/-1743|not authori[sz]ed to send apple events/i.test(text))
						return reject(new Error('macOS blocked it: allow Companion to control "System Events" in System Settings → Privacy & Security → Automation.'))
					if (/assistive|accessibility|not allowed|-1719|-25211/i.test(text))
						return reject(new Error('macOS blocked it: allow Companion in System Settings → Privacy & Security → Accessibility, then try again.'))
					return reject(new Error(text.trim() || 'osascript failed'))
				}
				if (out.startsWith('ERR:')) {
					const [code, ...detail] = out.slice(4).split(':')
					return reject(new Error((FRIENDLY[code] ?? out) + (detail.length ? ` ${detail.join(':')}` : '')))
				}
				resolve(out.startsWith('OK:') ? out.slice(3) : out)
			},
		)
	})
}
