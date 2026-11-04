// "Go to this site's tab": brings the browser to the front on the tab that has the site open, opens it
// in a new tab if no tab has it, and starts the browser if it's closed.
// Mac: the browsers' own scripting (Chrome, Brave, Vivaldi and Edge share Chrome's; Safari has its own),
// which can see every tab's address. Windows: browsers don't tell other apps their tabs' addresses, so
// the Windows helper finds the tab by its title (UI Automation) and otherwise opens the address.
// No Companion dependency, so it can be tested on its own.

/** The browsers on offer: the Mac app name and the Windows program. */
export const BROWSERS = {
	chrome: { label: 'Google Chrome', mac: 'Google Chrome', exe: 'chrome.exe' },
	brave: { label: 'Brave', mac: 'Brave Browser', exe: 'brave.exe' },
	vivaldi: { label: 'Vivaldi', mac: 'Vivaldi', exe: 'vivaldi.exe' },
	edge: { label: 'Microsoft Edge', mac: 'Microsoft Edge', exe: 'msedge.exe' },
	safari: { label: 'Safari (Mac)', mac: 'Safari', exe: '' },
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

/** What to look for when "find" is blank: the site's address without www. (ballroom.riderly.com.au). */
export function defaultMatch(url) {
	try {
		return new URL(url).host.replace(/^www\./, '')
	} catch {
		return ''
	}
}

/**
 * JXA. argv: [app name, url, text to find in a tab's address]. Prints FOUND or OPENED.
 * Chrome-family windows have "active tab index" and "minimized"; Safari has "current tab" and "miniaturized".
 */
export const TAB_SCRIPT = String.raw`
function run(argv) {
	const name = argv[0], url = argv[1], match = String(argv[2] || '').toLowerCase()
	const b = Application(name)
	const safari = name === 'Safari'
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
			if (!match || u.toLowerCase().indexOf(match) < 0) continue
			if (safari) w.currentTab = tabs[i]
			else w.activeTabIndex = i + 1
			try { if (safari ? w.miniaturized() : w.minimized()) { if (safari) w.miniaturized = false; else w.minimized = false } } catch (e) {}
			try { w.index = 1 } catch (e) {}
			b.activate()
			return 'FOUND'
		}
	}
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
