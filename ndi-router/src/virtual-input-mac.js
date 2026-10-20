// Mac only: switch NDI Virtual Input's source by clicking its menu-bar menu, as a person would.
// NDI Virtual Input has no API, so this drives the menu through System Events (needs Accessibility
// permission for Companion). Runs as JavaScript for Automation via osascript.
import { execFile } from 'node:child_process'

/**
 * The JXA script. argv: [processName, mode ('select' | 'list'), fullName, machine, shortName]
 * Returns 'OK', a JSON list of menu titles (list mode), or 'ERR:<reason>'.
 * Handles both menu layouts: a flat list of "MACHINE (Source)" items, or a submenu per machine.
 */
export const MENU_SCRIPT = `
function run(argv) {
	var procName = argv[0], mode = argv[1], full = argv[2], machine = argv[3], short = argv[4]
	var se = Application('System Events')
	if (se.processes.whose({ name: procName }).length === 0) return 'ERR:not-running'
	var proc = se.processes.byName(procName)
	var bars = proc.menuBars()
	if (!bars.length) return 'ERR:no-menu'
	var barItems = bars[bars.length - 1].menuBarItems()
	if (!barItems.length) return 'ERR:no-menu'
	var top = barItems[0]
	top.click()
	delay(0.25)
	var close = function () { se.keyCode(53) }
	var title = function (i) { try { return i.name() || '' } catch (e) { return '' } }
	var subOf = function (i) { try { var m = i.menus(); return m.length ? m[0] : null } catch (e) { return null } }
	var items = top.menus[0].menuItems()

	if (mode === 'list') {
		var out = []
		for (var a = 0; a < items.length; a++) {
			var t = title(items[a])
			var sub = subOf(items[a])
			if (sub) {
				items[a].click()
				delay(0.15)
				var kids = sub.menuItems()
				for (var b = 0; b < kids.length; b++) out.push(t + ' > ' + title(kids[b]))
			} else out.push(t)
		}
		close()
		return JSON.stringify(out)
	}

	for (var i = 0; i < items.length; i++) {
		var name = title(items[i])
		if (name === full || (!machine && name === short)) { items[i].click(); return 'OK' }
	}
	for (var j = 0; j < items.length; j++) {
		var nm = title(items[j])
		var submenu = subOf(items[j])
		if (submenu && (nm === machine || nm === full)) {
			items[j].click()
			delay(0.15)
			var children = submenu.menuItems()
			for (var k = 0; k < children.length; k++) {
				var ct = title(children[k])
				if (ct === short || ct === full) { children[k].click(); return 'OK' }
			}
		}
	}
	for (var x = 0; x < items.length; x++) {
		if (title(items[x]) === short) { items[x].click(); return 'OK' }
	}
	close()
	return 'ERR:not-found'
}
`

const FRIENDLY = {
	'not-running': 'NDI Virtual Input is not running. Open it first.',
	'no-menu': "Couldn't find NDI Virtual Input's menu-bar icon.",
	'not-found': "That source isn't in NDI Virtual Input's menu (use the \"list\" action to see what is).",
}

/** Run the script. Resolves 'OK' or the list; rejects with a readable message. */
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
					if (/assistive|accessibility|not allowed|-1719|-25211/i.test(text))
						return reject(new Error('macOS blocked it: allow Companion in System Settings → Privacy & Security → Accessibility, then try again.'))
					return reject(new Error(text.trim() || 'osascript failed'))
				}
				if (out.startsWith('ERR:')) return reject(new Error(FRIENDLY[out.slice(4)] ?? out))
				resolve(out)
			},
		)
	})
}
