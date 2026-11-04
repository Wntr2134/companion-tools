// "Go to this site's tab": brings the browser to the front on the tab that has the site open, opens it
// in a new tab if no tab has it, and starts the browser if it's closed.
// Mac: the browsers' own scripting (Chrome, Brave, Vivaldi, Edge and other Chromium browsers share
// Chrome's; Safari and Arc have their own), which can see every tab's address. A browser without
// scripting (Firefox) just gets the address opened. Windows: browsers don't tell other apps their tabs' addresses, so
// the Windows helper finds the tab by its title (UI Automation) and otherwise opens the address.
// No Companion dependency, so it can be tested on its own.

/**
 * Browsers System Tools knows, and how to reach their tabs. The list shown is the ones found on this
 * computer (installedBrowsers); any other app name can be typed in.
 * names: how the app is called on a Mac (/Applications) or in the Windows Start Menu.
 */
export const BROWSERS = {
	chrome: { label: 'Google Chrome', mac: 'Google Chrome', exe: 'chrome.exe', names: /^google chrome$/i },
	brave: { label: 'Brave', mac: 'Brave Browser', exe: 'brave.exe', names: /^brave( browser)?$/i },
	vivaldi: { label: 'Vivaldi', mac: 'Vivaldi', exe: 'vivaldi.exe', names: /^vivaldi$/i },
	edge: { label: 'Microsoft Edge', mac: 'Microsoft Edge', exe: 'msedge.exe', names: /^microsoft edge$/i },
	arc: { label: 'Arc', mac: 'Arc', exe: 'arc.exe', names: /^arc$/i },
	opera: { label: 'Opera', mac: 'Opera', exe: 'opera.exe', names: /^opera( browser)?$/i },
	opera_gx: { label: 'Opera GX', mac: 'Opera GX', exe: 'opera.exe', names: /^opera gx( browser)?$/i },
	chromium: { label: 'Chromium', mac: 'Chromium', exe: 'chrome.exe', names: /^chromium$/i },
	firefox: { label: 'Firefox', mac: 'Firefox', exe: 'firefox.exe', names: /^(mozilla )?firefox$/i },
	zen: { label: 'Zen', mac: 'Zen', exe: 'zen.exe', names: /^zen( browser)?$/i },
	safari: { label: 'Safari', mac: 'Safari', exe: '', names: /^safari$/i },
}

/** The known browsers among these apps ([{ name, exe }]), in BROWSERS order: [{ id, label, app }]. */
export function installedBrowsers(apps, platform = process.platform) {
	const out = []
	for (const [id, b] of Object.entries(BROWSERS)) {
		if (platform === 'win32' && !b.exe) continue
		const app = (apps ?? []).find((a) => b.names.test(String(a.name ?? '').trim()))
		if (app) out.push({ id, label: b.label, app })
		// Every Mac has Safari (it isn't always in the app list, which leaves out built-in apps by default)
		else if (id === 'safari' && platform === 'darwin') out.push({ id, label: b.label, app: { name: 'Safari', path: '/Applications/Safari.app' } })
	}
	return out
}

/** A browser by id, or one typed in by app name (anything else people use). */
export function browserFor(id, apps = []) {
	const known = BROWSERS[id] ?? Object.values(BROWSERS).find((b) => b.names.test(String(id ?? '').trim()))
	const name = String(id ?? '').trim()
	const b = known ?? { label: name, mac: name.replace(/\.app$/i, ''), exe: /\.exe$/i.test(name) ? name : `${name.toLowerCase().replace(/\s+/g, '')}.exe`, names: null }
	// Windows: the program file of the copy actually installed (Opera's is opera.exe, a portable one may differ)
	const app = b.names ? apps.find((a) => b.names.test(String(a.name ?? '').trim())) : apps.find((a) => String(a.name ?? '').toLowerCase() === name.toLowerCase())
	return { ...b, exe: app?.exe || b.exe }
}

/** A web address to open, or null: http(s) only, no spaces or quotes (it's handed to a browser). A bare "site.com" gets https://. */
export function cleanUrl(text) {
	let u = String(text ?? '').trim()
	if (!u) return null
	if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = `https://${u}`
	let parsed
	try {
		parsed = new URL(u)
	} catch {
		return null
	}
	if (!/^https?:$/.test(parsed.protocol) || /[\s"'`]/.test(u)) return null
	return parsed.href
}

/** What to look for when "find" is blank: the site's address without www. (example.com). */
export function defaultMatch(url) {
	try {
		return new URL(url).host.replace(/^www\./, '')
	} catch {
		return ''
	}
}

/**
 * JXA. argv: [app name, url, text(s) to find in a tab's address ("a|b" = either), "find" to only look].
 * Prints FOUND or OPENED; with "find", NOTRUNNING or NOTFOUND instead of starting or opening anything.
 * Chrome-family windows have "active tab index" and "minimized"; Safari has "current tab" and "miniaturized".
 */
export const TAB_SCRIPT = String.raw`
function run(argv) {
	const name = argv[0], url = argv[1], findOnly = argv[3] === 'find'
	const matches = String(argv[2] || '').toLowerCase().split('|').filter(function (m) { return m })
	const b = Application(name)
	const safari = name === 'Safari'
	if (findOnly && !b.running()) return 'NOTRUNNING'
	if (!b.running()) {
		b.activate()
		for (let i = 0; i < 40 && b.windows.length === 0; i++) delay(0.25)
		delay(0.5) // let it restore its last tabs
	}
	const ws = b.windows()
	for (const w of ws) {
		let tabs = []
		try { tabs = w.tabs() } catch (e) { continue }
		for (let i = 0; i < tabs.length; i++) {
			let u = ''
			try { u = String(tabs[i].url() || '') } catch (e) {}
			const low = u.toLowerCase()
			if (!matches.some(function (m) { return low.indexOf(m) >= 0 })) continue
			if (safari) w.currentTab = tabs[i]
			else {
				try { w.activeTabIndex = i + 1 } catch (e) { tabs[i].select() } // Arc: tabs have "select"
			}
			try { if (safari ? w.miniaturized() : w.minimized()) { if (safari) w.miniaturized = false; else w.minimized = false } } catch (e) {}
			try { w.index = 1 } catch (e) {}
			b.activate()
			return 'FOUND'
		}
	}
	if (findOnly) return 'NOTFOUND'
	if (b.windows.length === 0) {
		try { safari ? b.Document().make() : b.Window().make() } catch (e) {}
		for (let i = 0; i < 20 && b.windows.length === 0; i++) delay(0.1)
	}
	const w = b.windows[0]
	w.tabs.push(b.Tab({ url: url }))
	const n = w.tabs.length
	if (safari) w.currentTab = w.tabs[n - 1]
	else w.activeTabIndex = n
	try { w.index = 1 } catch (e) {}
	b.activate()
	return 'OPENED'
}
`
