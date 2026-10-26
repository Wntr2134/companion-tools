// Run with: node --test test/system.test.mjs
// The window script runs here against a fake macOS (screens, System Events, windows), so the maths
// and matching are tested without a Mac. The rest checks parsing and the presets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { POSITIONS, parseLayout, positionFromWords, WINDOW_SCRIPT, placeItem, restoreItems, summarise, windowRequest } from '../src/mac-windows.js'
import { parseSound, shortcutLabel, parseShortcutList, KeepAwake, MAGNET, SEND_KEYS, KEY_CODES, macPermissionHint } from '../src/mac-system.js'
import { cpuPercent, parseVmStat, parsePmset, mainIp, fmtUptime, fmtBytes } from '../src/sysinfo.js'

// ---------- a fake Mac for the window script ----------

function fakeMac({ screens, apps }) {
	// screens in Cocoa coordinates (origin bottom-left of the main screen)
	const nsScreens = screens.map((s) => ({
		frame: { origin: { x: s.x, y: s.y }, size: { width: s.w, height: s.h } },
		visibleFrame: { origin: { x: s.x, y: s.y }, size: { width: s.w, height: s.h - (s.menu ? 25 : 0) } },
		localizedName: s.name,
	}))
	const makeWindow = (w) => {
		const win = {
			_pos: [w.x, w.y],
			_size: [w.w, w.h],
			_attrs: { AXFullScreen: !!w.fullScreen, AXMinimized: !!w.minimised },
			raised: 0,
			name: () => w.title ?? '',
			subrole: () => 'AXStandardWindow',
			attributes: {
				byName: (n) => ({
					value: Object.assign(() => win._attrs[n], {}),
					set value(v) {
						win._attrs[n] = v
					},
				}),
			},
			actions: { byName: () => ({ perform: () => win.raised++ }) },
		}
		Object.defineProperty(win, 'position', { get: () => () => win._pos, set: (v) => (win._pos = v) })
		Object.defineProperty(win, 'size', { get: () => () => win._size, set: (v) => (win._size = v) })
		// attributes.byName(n).value = x needs a settable object: rebuild it so the setter works
		win.attributes.byName = (n) => {
			const o = {}
			Object.defineProperty(o, 'value', { get: () => () => win._attrs[n], set: (v) => (win._attrs[n] = v) })
			return o
		}
		return win
	}
	const procs = apps.map((a) => {
		const wins = a.windows.map(makeWindow)
		const windows = Object.assign(() => wins, {
			whose: ({ name }) => {
				const found = wins.filter((w) => w.name() === name)
				return Object.assign(found, {})
			},
		})
		return { a, wins, name: () => a.name, bundleIdentifier: () => a.bundleId, windows, visible: true, frontmost: !!a.front, backgroundOnly: false }
	})
	const whose = (filter) => {
		const found = procs.filter((p) =>
			Object.entries(filter).every(([k, v]) => {
				if (k === 'name') return p.a.name === v
				if (k === 'bundleIdentifier') return p.a.bundleId === v
				if (k === 'frontmost') return p.frontmost === v
				if (k === 'visible') return p.visible === v
				if (k === 'backgroundOnly') return p.backgroundOnly === v
				return false
			}),
		)
		const fn = () => found
		Object.defineProperty(fn, 'length', { value: found.length })
		found.forEach((p, i) => (fn[i] = p))
		return fn
	}
	const se = { processes: { whose } }
	const ctx = {
		ObjC: { import: () => {}, unwrap: (x) => x },
		$: {
			NSScreen: { screens: { count: nsScreens.length, objectAtIndex: (i) => nsScreens[i] } },
			NSBundle: { bundleWithPath: (p) => ({ isNil: () => false, bundleIdentifier: apps.find((a) => a.path === p)?.bundleId ?? '' }) },
		},
		Application: Object.assign((name) => (name === 'System Events' ? se : {}), { currentApplication: () => ({ doShellScript: () => '' }) }),
		delay: () => {},
		JSON,
		Math,
		String,
	}
	vm.createContext(ctx)
	vm.runInContext(WINDOW_SCRIPT, ctx)
	return { call: (req) => JSON.parse(vm.runInContext(`run([${JSON.stringify(JSON.stringify(req))}])`, ctx)), procs }
}

// Main screen 1920×1080 with the menu bar; screen 2 (2560×1440) to the right, lined up at the top;
// screen 3 to the left. In Cocoa coordinates screen 2 sits at y = 1080 - 1440 = -360.
const SCREENS = [
	{ name: 'Built-in', x: 0, y: 0, w: 1920, h: 1080, menu: true },
	{ name: 'DELL', x: 1920, y: -360, w: 2560, h: 1440 },
	{ name: 'LG', x: -1280, y: 0, w: 1280, h: 1024 },
]
const APPS = [
	{ name: 'Resolume Arena', bundleId: 'com.resolume.arena', path: '/Applications/Resolume Arena/Arena.app', windows: [{ title: 'Arena', x: 100, y: 100, w: 800, h: 600 }] },
	{ name: 'Safari', bundleId: 'com.apple.Safari', path: '/Applications/Safari.app', front: true, windows: [{ title: 'Start', x: 200, y: 200, w: 1000, h: 700 }, { title: 'Docs', x: 300, y: 300, w: 900, h: 600 }] },
	{ name: 'Keynote', bundleId: 'com.apple.iWork.Keynote', path: '/Applications/Keynote.app', windows: [{ title: 'Show', x: 0, y: 0, w: 1920, h: 1080, fullScreen: true }] },
]

test('screens: menu-bar screen first, the rest left to right, in top-left coordinates', () => {
	const mac = fakeMac({ screens: SCREENS, apps: APPS })
	const s = mac.call({ cmd: 'screens' })
	assert.deepEqual(
		s.map((x) => x.name),
		['Built-in', 'LG', 'DELL'],
	)
	assert.deepEqual([s[0].y, s[0].h], [25, 1055], 'menu bar left out of the usable area')
	assert.deepEqual([s[2].full.x, s[2].full.y], [1920, 0], 'DELL lined up at the top')
})

test('place: an app on screen 3, left half; the front window to the next screen, same spot', () => {
	const mac = fakeMac({ screens: SCREENS, apps: APPS })
	const [r] = mac.call({ cmd: 'place', items: [placeItem({ name: 'Resolume Arena', path: '/Applications/Resolume Arena/Arena.app' }, 3, 'left')] })
	assert.equal(r.ok, true)
	assert.deepEqual([r.x, r.y, r.w, r.h], [1920, 0, 1280, 1440])
	assert.deepEqual([...mac.procs[0].wins[0]._pos], [1920, 0])
	assert.deepEqual([...mac.procs[0].wins[0]._size], [1280, 1440])

	const [n] = mac.call({ cmd: 'place', items: [placeItem(null, 'next', 'keep')] })
	assert.equal(n.app, 'Safari', 'no app = the front app')
	// Safari's window is on screen 1 (Built-in); "next" in screen order is LG, to the left
	assert.ok(n.x < 0, 'moved onto the LG screen')
	assert.deepEqual([n.w, n.h], [1000, 700], 'kept its size')
})

test('place: thirds and centre maths, and the problems people hit', () => {
	const mac = fakeMac({ screens: SCREENS, apps: APPS })
	const [t] = mac.call({ cmd: 'place', items: [placeItem({ name: 'Safari' }, 1, 'right_third')] })
	assert.deepEqual([t.x, t.y, t.w, t.h], [1280, 25, 640, 1055])
	const [c] = mac.call({ cmd: 'place', items: [placeItem({ name: 'Safari' }, 1, 'centre')] })
	assert.deepEqual([c.w, c.h], [640, 1055], 'centre keeps the current size')
	assert.equal(c.x, 640)
	const results = mac.call({
		cmd: 'place',
		items: [placeItem({ name: 'Keynote' }, 1, 'left'), placeItem({ name: 'Zoom' }, 1, 'left'), placeItem({ name: 'Safari' }, 7, 'left')],
	})
	assert.match(results[0].error, /full screen/)
	assert.equal(results[1].error, 'not open')
	assert.match(results[2].error, /no screen 7/)
	const s = summarise(results)
	assert.equal(s.good, 0)
	assert.match(s.text, /Keynote: is in full screen/)
})

test('layouts: capture where windows are, put them back by title', () => {
	const mac = fakeMac({ screens: SCREENS, apps: APPS })
	const saved = mac.call({ cmd: 'capture' })
	assert.deepEqual(
		saved.map((a) => a.app),
		['Resolume Arena', 'Safari'],
		'full-screen windows are skipped',
	)
	assert.equal(saved[1].windows.length, 2)
	// move things, then restore
	mac.call({ cmd: 'place', items: [placeItem({ name: 'Safari' }, 2, 'full')] })
	const back = mac.call({ cmd: 'place', items: restoreItems(saved) })
	assert.ok(back.every((r) => r.ok))
	assert.deepEqual([...mac.procs[1].wins[0]._pos], [200, 200])
	assert.deepEqual([...mac.procs[1].wins[1]._pos], [300, 300])
})

test('hide others keeps the chosen app; show all brings them back', () => {
	const mac = fakeMac({ screens: SCREENS, apps: APPS })
	mac.call({ cmd: 'hide_others', item: { app: 'Resolume Arena' } })
	assert.deepEqual(
		mac.procs.map((p) => p.visible),
		[true, false, false],
	)
	assert.equal(mac.procs[0].frontmost, true)
	mac.call({ cmd: 'show_all' })
	assert.ok(mac.procs.every((p) => p.visible))
})

test('windowRequest passes the request as argv, never in the script', async () => {
	let seen
	const exec = (file, args, opts, cb) => {
		seen = { file, args }
		setImmediate(() => cb(null, '[{"app":"x","ok":true}]', ''))
	}
	const out = await windowRequest({ cmd: 'place', items: [{ app: "Bob's \"app\"" }] }, { exec })
	assert.equal(seen.file, 'osascript')
	assert.deepEqual(seen.args.slice(0, 3), ['-l', 'JavaScript', '-e'])
	assert.equal(seen.args[3], WINDOW_SCRIPT)
	assert.equal(JSON.parse(seen.args[4]).items[0].app, "Bob's \"app\"")
	assert.equal(out[0].ok, true)
})

test('written layouts: app, screen, position per line', () => {
	const { items, errors } = parseLayout('# show\nResolume Arena, 2, fill\nDante Controller, 1, left half\nBig, Co, Inc, 1, top left\nZoom, next, right\nBad line\nX, 1, sideways\nY, two, left')
	assert.deepEqual(items, [
		{ app: 'Resolume Arena', screen: 2, position: 'full' },
		{ app: 'Dante Controller', screen: 1, position: 'left' },
		{ app: 'Big, Co, Inc', screen: 1, position: 'top_left' },
		{ app: 'Zoom', screen: 'next', position: 'right' },
	])
	assert.equal(errors.length, 3)
	assert.equal(positionFromWords('Right two-thirds'), 'right_two_thirds')
	assert.equal(positionFromWords('maximise'), 'full')
	for (const [id, p] of Object.entries(POSITIONS)) {
		assert.ok(p.short.split('\\n').every((l) => l.length <= 9), `${id} label fits a key`)
		if (typeof p.rect === 'object') assert.ok(p.rect.x + p.rect.w <= 1.0001 && p.rect.y + p.rect.h <= 1.0001)
	}
})

// ---------- system ----------

test('sound, shortcuts list, key labels and Magnet', () => {
	assert.deepEqual(parseSound('35\t70\tfalse\n'), { output: 35, input: 70, muted: false })
	assert.deepEqual(parseSound('missing value\t50\ttrue'), { output: null, input: 50, muted: true })
	assert.deepEqual(parseShortcutList('Walk-in\nFocus: Show\n\nWalk-in\nalarm\n'), ['alarm', 'Focus: Show', 'Walk-in'])
	assert.equal(shortcutLabel('right', ['command', 'control', 'option']), '⌃⌥⌘→')
	assert.equal(shortcutLabel('4', ['shift', 'command']), '⇧⌘4')
	for (const m of Object.values(MAGNET)) assert.ok(KEY_CODES[m.key] !== undefined || m.key.length === 1, m.label)
	assert.match(SEND_KEYS, /function run\(argv\)/)
	assert.match(macPermissionHint('System Events got an error: osascript is not allowed to send keystrokes. (-1002)'), /Accessibility/)
	assert.match(macPermissionHint('Not authorized to send Apple events to Finder. (-1743)'), /Automation/)
})

test('keep awake: caffeinate tied to this process, stopped on demand', () => {
	const spawned = []
	const fake = (file, args) => {
		const child = { file, args, killed: false, handlers: {}, on(ev, fn) { this.handlers[ev] = fn }, kill() { this.killed = true; this.handlers.exit?.() } }
		spawned.push(child)
		return child
	}
	let changes = 0
	const k = new KeepAwake({ spawnFn: fake, pid: 4242 })
	k.onChange = () => changes++
	k.start(true)
	assert.equal(k.on, true)
	assert.deepEqual([spawned[0].file, ...spawned[0].args], ['caffeinate', '-dims', '-w', '4242'])
	k.start(true)
	assert.equal(spawned.length, 1, 'already on: nothing new')
	k.start(false)
	assert.equal(spawned[0].killed, true)
	assert.deepEqual(spawned[1].args, ['-ims', '-w', '4242'], 'displays allowed to sleep')
	k.stop()
	assert.equal(k.on, false)
	assert.ok(changes >= 3)
})

test('system info: CPU, memory as Activity Monitor counts it, battery, IP, uptime', () => {
	const t = (user, idle) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } })
	assert.equal(cpuPercent([t(100, 900)], [t(150, 950)]), 50)
	const vm = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            200000.
Pages wired down:                        100000.
Pages purgeable:                          10000.
Anonymous pages:                         300000.
Pages occupied by compressor:             50000.`
	// (300000 - 10000 + 100000 + 50000) × 16384 = 7.2 GB of 16 GB
	assert.equal(parseVmStat(vm, 16 * 1024 ** 3), 42)
	assert.deepEqual(parsePmset("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t87%; charging; 0:40 remaining present: true"), { percent: 87, charging: true, onPower: true })
	assert.equal(parsePmset("Now drawing from 'AC Power'"), null, 'desktop Mac: no battery')
	assert.equal(mainIp({ lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], utun3: [{ family: 'IPv4', address: '10.8.0.2', internal: false }], en0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }] }), '192.168.1.20')
	assert.equal(fmtUptime(3 * 86400 + 5 * 3600), '3d 5h')
	assert.equal(fmtUptime(125 * 60), '2h 5m')
	assert.equal(fmtBytes(245e9), '245 GB')
	assert.equal(fmtBytes(1.5e12), '1.5 TB')
})

test('wide key viewers: display only, short enough for a normal key too', async () => {
	const { getViewerPresets } = await import('../src/viewers.js')
	const presets = getViewerPresets({ label: 'x' })
	for (const p of Object.values(presets)) {
		assert.equal(p.category, 'Wide key viewers')
		assert.deepEqual(p.steps, [{ down: [], up: [] }])
		assert.equal(p.style.size, 'auto')
		assert.ok(p.style.text.split('\\n').length <= 3)
		for (const fb of p.feedbacks) assert.ok(fb.style, 'on/off feedbacks carry a style')
	}
})

test('every on/off feedback in a preset carries a style (without one, Companion 5.1 blanks the key)', async () => {
	const { readFile } = await import('node:fs/promises')
	const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8')
	for (const m of src.matchAll(/\{ feedbackId: '(\w+)', options: \{[^}]*\}( \})?/g)) {
		if (['app_icon', 'dock_icon'].includes(m[1])) continue // advanced: draw their own picture
		assert.ok(!m[2], `preset feedback "${m[1]}" has no style`)
	}
})

test('restoreItems turns a saved layout into absolute placements', () => {
	const items = restoreItems([{ app: 'Safari', bundleId: 'com.apple.Safari', windows: [{ title: 'A', index: 0, x: 1, y: 2, w: 3, h: 4 }] }], { launch: true })
	assert.deepEqual(items, [{ app: 'Safari', bundleId: 'com.apple.Safari', title: 'A', index: 0, abs: { x: 1, y: 2, w: 3, h: 4 }, launch: true }])
})

test('Your Dock: the Dock apps in order, Finder first, spacers and files left out', async () => {
	const { parseDock, fileUrlToPath, FINDER } = await import('../src/dock.js')
	const tile = (label, url) => `
		<dict>
			<key>tile-data</key>
			<dict>
				<key>file-data</key>
				<dict>
					<key>_CFURLString</key>
					<string>${url}</string>
					<key>_CFURLStringType</key>
					<integer>15</integer>
				</dict>
				<key>file-label</key>
				<string>${label}</string>
			</dict>
			<key>tile-type</key>
			<string>file-tile</string>
		</dict>`
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>autohide</key>
	<true/>
	<key>persistent-apps</key>
	<array>${tile('Vivaldi', 'file:///Applications/Vivaldi.app/')}
		<dict>
			<key>tile-data</key>
			<dict/>
			<key>tile-type</key>
			<string>spacer-tile</string>
		</dict>${tile('Dante Controller', 'file:///Applications/Dante%20Controller.app/')}${tile('R&amp;D Notes', 'file:///Applications/R&amp;D%20Notes.app/')}${tile('Vivaldi', 'file:///Applications/Vivaldi.app/')}
	</array>
	<key>persistent-others</key>
	<array>${tile('Downloads', 'file:///Users/will/Downloads/')}
	</array>
</dict>
</plist>`
	assert.deepEqual(parseDock(xml), [
		FINDER,
		{ name: 'Vivaldi', path: '/Applications/Vivaldi.app' },
		{ name: 'Dante Controller', path: '/Applications/Dante Controller.app' },
		{ name: 'R&D Notes', path: '/Applications/R&D Notes.app' },
	])
	assert.deepEqual(parseDock(''), [FINDER])
	assert.equal(fileUrlToPath('file:///System/Applications/Music.app/'), '/System/Applications/Music.app')
	assert.equal(fileUrlToPath('https://example.com'), '')
})

test('Bluetooth: paired devices from blueutil or the built-in script; addresses passed as arguments', async () => {
	const { Bluetooth, parseBlueutil, normAddress, BT_SCRIPT } = await import('../src/bluetooth.js')
	assert.deepEqual(parseBlueutil('[{"address":"AA-BB-CC-DD-EE-01","name":"AirPods Pro","connected":true},{"address":"aa-bb-cc-dd-ee-02","name":"","connected":false}]'), [
		{ address: 'AA-BB-CC-DD-EE-01', name: 'AirPods Pro', connected: true },
		{ address: 'aa-bb-cc-dd-ee-02', name: 'aa-bb-cc-dd-ee-02', connected: false },
	])
	assert.equal(normAddress('AA:BB:CC:DD:EE:01'), 'aa-bb-cc-dd-ee-01')

	const calls = []
	const exec = (reply) => (file, args, opts, cb) => {
		calls.push([file, ...args])
		setImmediate(() => cb(null, reply, ''))
	}
	const viaUtil = new Bluetooth({ exec: exec('[{"address":"AA-BB-CC-DD-EE-01","name":"Speaker","connected":false}]'), blueutil: '/opt/homebrew/bin/blueutil' })
	assert.deepEqual(await viaUtil.list(), [{ address: 'aa-bb-cc-dd-ee-01', name: 'Speaker', connected: false }])
	await viaUtil.set('AA:BB:CC:DD:EE:01', true)
	assert.deepEqual(calls.at(-1), ['/opt/homebrew/bin/blueutil', '--connect', 'aa-bb-cc-dd-ee-01'])

	const builtIn = new Bluetooth({ exec: exec('{"ok":false,"code":-536870212}'), blueutil: undefined })
	await assert.rejects(builtIn.set('aa-bb-cc-dd-ee-01', true), /general error, 0xe00002bc.*is the device on/)
	assert.deepEqual(calls.at(-1).slice(0, 3), ['osascript', '-l', 'JavaScript'])
	assert.equal(calls.at(-1)[4], BT_SCRIPT)
	assert.deepEqual(calls.at(-1).slice(5), ['connect', 'aa-bb-cc-dd-ee-01'])
})

test('Bluetooth: connect calls the method (JXA hands back a function for openConnection) and checks it connected', async () => {
	const { BT_SCRIPT, btCode } = await import('../src/bluetooth.js')
	assert.match(BT_SCRIPT, /m\(\$\(\)\)/)
	assert.match(BT_SCRIPT, /isConnected/)
	assert.match(BT_SCRIPT, /ran: code !== undefined/)
	// a code JXA couldn't read as a number: judged on whether it connected
	const { Bluetooth } = await import('../src/bluetooth.js')
	const bt = new Bluetooth({ exec: (f, a, o, cb) => cb(null, '{"ok":false,"ran":true,"code":"[id nil]","connected":false}', ''), blueutil: undefined })
	await assert.rejects(bt.set('aa-bb-cc-dd-ee-01', true), /it didn't connect: is the device on/)
	assert.equal(btCode(0xe00002d6 | 0), 'timed out, 0xe00002d6')
	assert.equal(btCode(5), 'code 0x5')
	assert.match(btCode('undefined'), /no result/)
})

test('app icons: cached per app version, made in one batch, short names for under the icon', async () => {
	const { IconCache, iconFile, shortName, ICON_SCRIPT } = await import('../src/icons.js')
	const { mkdtemp, mkdir, writeFile, utimes } = await import('node:fs/promises')
	const os = await import('node:os')
	const path = await import('node:path')
	const names = { 'Microsoft Excel': 'Excel', 'Google Chrome': 'Chrome', 'Brave Browser': 'Brave', 'Spark Mail': 'Spark', 'Audio Hijack': 'Hijack', 'Docker Desktop': 'Docker', 'Pro Tools': 'Pro Tools', 'Calendar': 'Calendar', 'Dante Virtual Soundcard': 'Dante DVS', 'Resolume Arena': 'Resolume', 'Photoshop': 'Photoshop', 'Bitfocus Companion': 'Companion' }
	for (const [full, short] of Object.entries(names)) assert.equal(shortName(full), short, full)
	for (const full of Object.keys(names)) assert.ok(shortName(full).length <= 9, `${full} fits one line`)
	assert.notEqual(iconFile('/A.app', 1000, '/c'), iconFile('/A.app', 2000, '/c'), 'a new app version gets a new icon')

	const root = await mkdtemp(path.join(os.tmpdir(), 'icons-'))
	const app = path.join(root, 'Dante Controller.app')
	await mkdir(app)
	const runs = []
	const exec = (file, args, opts, cb) => {
		runs.push(args)
		const req = JSON.parse(args.at(-1))
		Promise.all(req.items.map((i) => writeFile(i.out, Buffer.from('png!')))).then(() => cb(null, '[]', ''))
	}
	const cache = new IconCache({ exec, dir: path.join(root, 'cache') })
	assert.equal(await cache.ensure([app, app, path.join(root, 'Gone.app')]), 1)
	assert.equal(cache.get(app), Buffer.from('png!').toString('base64'))
	assert.equal(runs.length, 1)
	assert.equal(runs[0][3], ICON_SCRIPT, 'paths go in as JSON, never into the script')

	const again = new IconCache({ exec, dir: path.join(root, 'cache') })
	await again.ensure([app])
	assert.equal(runs.length, 1, 'cached on disk: nothing redrawn')
	await utimes(app, new Date(), new Date(Date.now() + 60000))
	await again.ensure([app])
	assert.equal(runs.length, 2, 'app updated: icon redrawn')
})

test('auto-update: newest installed release per module, only ours unless asked, via the REST API', async () => {
	const { planUpdates, compareVersions, scanInstalled, companionRoot, CompanionApi } = await import('../src/updater.js')
	const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
	const os = await import('node:os')
	const path = await import('node:path')
	assert.ok(compareVersions('2.10.0', '2.9.9') > 0)
	assert.ok(compareVersions('2.3.0-beta.1', '2.3.0') < 0)
	assert.equal(companionRoot('darwin', {}, '/Users/will'), '/Users/will/Library/Application Support/companion')
	assert.equal(companionRoot('win32', { APPDATA: 'C:\\Users\\will\\AppData\\Roaming' }, 'x'), path.join('C:\\Users\\will\\AppData\\Roaming', 'companion'))

	const root = await mkdtemp(path.join(os.tmpdir(), 'mods-'))
	const add = async (dir, id, version, repository = 'git+https://github.com/Wntr2134/companion-tools.git') => {
		await mkdir(path.join(root, dir, 'companion'), { recursive: true })
		await writeFile(path.join(root, dir, 'companion', 'manifest.json'), JSON.stringify({ id, version, repository }))
	}
	await add('spotify-local-1.3.0', 'spotify-local', '1.3.0')
	await add('spotify-local-1.3.1', 'spotify-local', '1.3.1')
	await add('spotify-local-1.4.0-beta.1', 'spotify-local', '1.4.0-beta.1')
	await add('system-tools-2.2.0', 'system-tools', '2.2.0')
	await add('bmd-atem-3.1.0', 'bmd-atem', '3.1.0', 'git+https://github.com/bitfocus/companion-module-bmd-atem.git')
	await add('bmd-atem-3.2.0', 'bmd-atem', '3.2.0', 'git+https://github.com/bitfocus/companion-module-bmd-atem.git')
	const installed = await scanInstalled(root)
	const connections = [
		{ id: 'a', label: 'Spotify__local_', moduleId: 'spotify-local', moduleVersionId: '1.3.0' },
		{ id: 'b', label: 'System_Tools', moduleId: 'system-tools', moduleVersionId: '2.2.0' },
		{ id: 'c', label: 'atem', moduleId: 'bmd-atem', moduleVersionId: '3.1.0' },
		{ id: 'd', label: 'dev one', moduleId: 'spotify-local', moduleVersionId: 'dev' },
	]
	assert.deepEqual(planUpdates(connections, installed), [{ id: 'a', label: 'Spotify__local_', moduleId: 'spotify-local', from: '1.3.0', to: '1.3.1' }], 'newest release, ours only, dev left alone')
	assert.equal(planUpdates(connections, installed, { onlyOurs: false }).length, 2)

	const calls = []
	const fetchFn = async (url, opts) => {
		calls.push([opts.method, url, opts.headers.Authorization, opts.body])
		if (opts.method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify({ data: connections }) }
		return { ok: false, status: 403, text: async () => '{}' }
	}
	const api = new CompanionApi({ port: 8000, key: 'k1', fetchFn })
	assert.equal((await api.connections()).length, 4)
	assert.deepEqual(calls[0].slice(0, 3), ['GET', 'http://127.0.0.1:8000/api/v2/connections/v1/', 'Bearer k1'])
	await assert.rejects(api.setVersion('a', '1.3.1'), /403: no reason given/)
	const { explainApiError } = await import('../src/updater.js')
	assert.match(explainApiError(403, 'API_DISABLED', 'REST API is disabled'), /switched off/, '403 can mean the API is off, not the key')
	assert.match(explainApiError(403, 'FORBIDDEN', "Insufficient scope: requires 'connections' and 'write'"), /scopes/)
	assert.match(explainApiError(401, 'UNAUTHORIZED', 'Invalid API token'), /refused/)
	assert.deepEqual(calls[1], ['PATCH', 'http://127.0.0.1:8000/api/v2/connections/v1/a', 'Bearer k1', '{"versionId":"1.3.1"}'])
})
