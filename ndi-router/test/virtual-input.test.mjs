// Run with: node --test test/virtual-input.test.mjs
// Runs the real JXA menu script in a Node sandbox against a pretend System Events.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { MENU_SCRIPT, runMenuScript } from '../src/virtual-input-mac.js'

/** A JXA-like element: callable (returns its list) and indexable ([0]). */
function elements(list) {
	const f = () => list
	list.forEach((v, i) => (f[i] = v))
	return f
}
function menuItem(name, children, log) {
	const item = { name: () => name, click: () => log.push(name) }
	item.menus = elements(children ? [{ menuItems: () => children.map((c) => menuItem(c, null, log)) }] : [])
	return item
}
/** layout: array of strings (flat) or [machine, [sources]] pairs */
function fakeSystemEvents({ running = true, layout = [] }) {
	const log = []
	const items = layout.map((e) => (Array.isArray(e) ? menuItem(e[0], e[1], log) : menuItem(e, null, log)))
	const top = { click: () => log.push('<open>'), menus: elements([{ menuItems: () => items }]) }
	const proc = { menuBars: () => [{ menuBarItems: () => [] }, { menuBarItems: () => [top] }] }
	const se = {
		processes: { whose: () => ({ length: running ? 1 : 0 }), byName: () => proc },
		keyCode: (k) => log.push(`<key ${k}>`),
	}
	return { se, log }
}
function runScript(fake, argv) {
	const ctx = { Application: () => fake.se, delay: () => {}, JSON }
	vm.createContext(ctx)
	vm.runInContext(MENU_SCRIPT, ctx)
	return ctx.run(argv)
}

test('flat menu: clicks the "MACHINE (Source)" item', () => {
	const fake = fakeSystemEvents({ layout: ['None', 'STUDIO-PC (Cam 1)', 'STUDIO-PC (Cam 2)'] })
	assert.equal(runScript(fake, ['NDI Virtual Input', 'select', 'STUDIO-PC (Cam 2)', 'STUDIO-PC', 'Cam 2']), 'OK')
	assert.deepEqual(fake.log, ['<open>', 'STUDIO-PC (Cam 2)'])
})

test('menu grouped by machine: opens the machine, clicks the source', () => {
	const fake = fakeSystemEvents({ layout: ['None', ['LAPTOP', ['Screen']], ['STUDIO-PC', ['Cam 1', 'Cam 2']]] })
	assert.equal(runScript(fake, ['NDI Virtual Input', 'select', 'STUDIO-PC (Cam 1)', 'STUDIO-PC', 'Cam 1']), 'OK')
	assert.deepEqual(fake.log, ['<open>', 'STUDIO-PC', 'Cam 1'])
})

test('missing source closes the menu and says so; app not running is reported', () => {
	const fake = fakeSystemEvents({ layout: ['STUDIO-PC (Cam 1)'] })
	assert.equal(runScript(fake, ['NDI Virtual Input', 'select', 'OTHER (Cam 9)', 'OTHER', 'Cam 9']), 'ERR:not-found')
	assert.deepEqual(fake.log, ['<open>', '<key 53>'])
	assert.equal(runScript(fakeSystemEvents({ running: false }), ['NDI Virtual Input', 'select', 'a', 'b', 'c']), 'ERR:not-running')
})

test('list mode shows every entry, including inside machine submenus', () => {
	const fake = fakeSystemEvents({ layout: ['None', ['STUDIO-PC', ['Cam 1', 'Cam 2']]] })
	assert.deepEqual(JSON.parse(runScript(fake, ['NDI Virtual Input', 'list', '', '', ''])), ['None', 'STUDIO-PC > Cam 1', 'STUDIO-PC > Cam 2'])
})

test('osascript errors become plain-English messages', async () => {
	const fakeExec = (out, err, stderr) => (file, args, opts, cb) => cb(err, out, stderr)
	await assert.rejects(
		runMenuScript({ processName: 'x', mode: 'select' }, fakeExec('', new Error('fail'), 'execution error: System Events got an error: osascript is not allowed assistive access. (-25211)')),
		/Accessibility/,
	)
	await assert.rejects(runMenuScript({ processName: 'x', mode: 'select' }, fakeExec('ERR:not-running\n', null, '')), /not running/)
	assert.equal(await runMenuScript({ processName: 'x', mode: 'select' }, fakeExec('OK\n', null, '')), 'OK')
	let seen
	await runMenuScript({ processName: 'NDI Virtual Input', mode: 'select', full: 'A (B)', machine: 'A', short: 'B' }, (f, args, o, cb) => {
		seen = [f, args.slice(0, 2), args.slice(4)]
		cb(null, 'OK', '')
	})
	assert.deepEqual(seen, ['osascript', ['-l', 'JavaScript'], ['NDI Virtual Input', 'select', 'A (B)', 'A', 'B']])
})
