// Run with: node --test test/virtual-input.test.mjs
// Runs the real JXA script in a Node sandbox against a pretend System Events that copies
// NDI Virtual Input's window: a drop-down with None, then a submenu per computer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { MENU_SCRIPT, runMenuScript } from '../src/virtual-input-mac.js'

/** A JXA-like element list: callable (returns the list) and indexable ([0]). */
function elements(list) {
	const f = () => list
	list.forEach((v, i) => (f[i] = v))
	return f
}

/**
 * layout: entries are 'None' / 'MACHINE (Source)' (flat) or [machine, [sources]].
 * settable: whether setting popup.value works (silent path).
 */
function fakeVirtualInput({ running = true, window = true, layout = [], value = '', settable = false, inGroup = false, noDropdown = false, extraPopup = false, menuButton = false, silent = false }) {
	const log = []
	const state = { value }
	const item = (name, kids, machine) => {
		const it = {
			name: () => name,
			click: () => {
				log.push(name)
				if (!kids) state.value = name === 'None' ? '' : machine ? `${machine} (${name})` : name
			},
		}
		it.menus = elements(kids ? [{ menuItems: () => kids.map((k) => item(k, null, name)) }] : [])
		return it
	}
	const items = layout.map((e) => (Array.isArray(e) ? item(e[0], e[1]) : item(e)))
	const popup = {
		role: () => (menuButton ? 'AXMenuButton' : 'AXPopUpButton'),
		title: () => (menuButton && !silent ? state.value : null),
		name: () => null,
		description: () => null,
		click: () => log.push('<open>'),
		menus: elements([{ menuItems: () => items }]),
	}
	Object.defineProperty(popup, 'value', {
		get: () => () => (menuButton ? null : state.value),
		set: (v) => {
			if (!settable) throw new Error("Can't set value")
			log.push(`<set ${v}>`)
			state.value = v
		},
	})
	const others = [{ role: () => 'AXSplitGroup' }, { role: () => 'AXGroup' }, { role: () => 'AXImage' }]
	const decoy = { role: () => 'AXPopUpButton', value: () => 'Full screen' }
	const list = noDropdown ? others : inGroup ? [...others, popup] : [popup, ...others]
	const win = { entireContents: () => (extraPopup ? [...list, decoy] : list) }
	const proc = { windows: () => (window ? [win] : []) }
	const se = { processes: { whose: () => ({ length: running ? 1 : 0 }), byName: () => proc }, keyCode: (k) => log.push(`<key ${k}>`) }
	return { se, log, state }
}
function run(fake, argv) {
	const ctx = { Application: () => fake.se, delay: () => {}, JSON }
	vm.createContext(ctx)
	vm.runInContext(MENU_SCRIPT, ctx)
	return ctx.run(argv)
}
const LAYOUT = ['None', ['Auditorium Bio Booth', ['Cam 1']], ['Theatrette', ['Channel 1', 'Channel 2']], ['WILLS-MACBOOK-PRO-4.LOCAL', ['Companion 1']]]

test('picks Computer > Source in the drop-down (like Theatrette > Channel 1)', () => {
	const fake = fakeVirtualInput({ layout: LAYOUT, value: 'WILLS-MACBOOK-PRO-4.LOCAL (Companion 1)' })
	assert.equal(run(fake, ['NDI Virtual Input', 'select', 'THEATRETTE (Channel 1)', 'THEATRETTE', 'Channel 1']), 'OK:Theatrette (Channel 1)')
	assert.deepEqual(fake.log, ['<open>', 'Theatrette', 'Channel 1'], 'computer names match regardless of case')
})

test('silent path: sets the value directly when the app allows it, nothing opens', () => {
	const fake = fakeVirtualInput({ layout: LAYOUT, settable: true })
	assert.equal(run(fake, ['NDI Virtual Input', 'select', 'Theatrette (Channel 2)', 'Theatrette', 'Channel 2']), 'OK:Theatrette (Channel 2)')
	assert.deepEqual(fake.log, ['<set Theatrette (Channel 2)>'])
})

test('with several drop-downs, picks the one showing an NDI name', () => {
	const fake = fakeVirtualInput({ layout: LAYOUT, value: 'Theatrette (Channel 1)', extraPopup: true })
	assert.equal(run(fake, ['NDI Virtual Input', 'read', '', '', '']), 'Theatrette (Channel 1)')
})

test('None, and a drop-down deep inside the window', () => {
	const fake = fakeVirtualInput({ layout: LAYOUT, value: 'Theatrette (Channel 1)', inGroup: true })
	assert.equal(run(fake, ['NDI Virtual Input', 'select', '', '', '']), 'OK:')
	assert.deepEqual(fake.log, ['<open>', 'None'])
})

test("menu button (what Virtual Input really uses): value is empty, the title says what's showing", () => {
	const fake = fakeVirtualInput({ layout: LAYOUT, value: 'Theatrette (Channel 1)', menuButton: true })
	assert.equal(run(fake, ['NDI Virtual Input', 'read', '', '', '']), 'Theatrette (Channel 1)')
	assert.equal(run(fake, ['NDI Virtual Input', 'select', 'Theatrette (Channel 2)', 'Theatrette', 'Channel 2']), 'OK:Theatrette (Channel 2)')
	assert.deepEqual(fake.log, ['<open>', 'Theatrette', 'Channel 2'])
	const blank = fakeVirtualInput({ layout: LAYOUT, menuButton: true, silent: true })
	assert.equal(run(blank, ['NDI Virtual Input', 'read', '', '', '']), '?', 'nothing readable: "?" so the module keeps its last value')
})

test('read mode returns what is showing without touching anything', () => {
	const fake = fakeVirtualInput({ layout: LAYOUT, value: 'WILLS-MACBOOK-PRO-4.LOCAL (Companion 1)' })
	assert.equal(run(fake, ['NDI Virtual Input', 'read', '', '', '']), 'WILLS-MACBOOK-PRO-4.LOCAL (Companion 1)')
	assert.deepEqual(fake.log, [])
})

test('problems are reported, and never anything but the drop-down is clicked', () => {
	let fake = fakeVirtualInput({ layout: LAYOUT })
	assert.equal(run(fake, ['NDI Virtual Input', 'select', 'OTHER (Cam 9)', 'OTHER', 'Cam 9']), 'ERR:not-found')
	assert.deepEqual(fake.log, ['<open>', '<key 53>'])
	assert.equal(run(fakeVirtualInput({ running: false }), ['NDI Virtual Input', 'select', 'a', 'b', 'c']), 'ERR:not-running')
	assert.equal(run(fakeVirtualInput({ window: false }), ['NDI Virtual Input', 'select', 'a', 'b', 'c']), 'ERR:no-window')
	assert.equal(
		run(fakeVirtualInput({ noDropdown: true }), ['NDI Virtual Input', 'select', 'a', 'b', 'c']),
		'ERR:no-dropdown:AXSplitGroup x1, AXGroup x1, AXImage x1',
		'lists what is in the window so the layout can be checked',
	)
})

test('list mode shows every computer > source', () => {
	const fake = fakeVirtualInput({ layout: LAYOUT })
	assert.deepEqual(JSON.parse(run(fake, ['NDI Virtual Input', 'list', '', '', ''])), [
		'None',
		'Auditorium Bio Booth > Cam 1',
		'Theatrette > Channel 1',
		'Theatrette > Channel 2',
		'WILLS-MACBOOK-PRO-4.LOCAL > Companion 1',
	])
})

test('osascript errors become plain-English messages', async () => {
	const fakeExec = (out, err, stderr) => (file, args, opts, cb) => cb(err, out, stderr)
	await assert.rejects(
		runMenuScript({ processName: 'x', mode: 'select' }, fakeExec('', new Error('fail'), 'osascript is not allowed assistive access. (-25211)')),
		/Accessibility/,
	)
	await assert.rejects(runMenuScript({ processName: 'x', mode: 'select' }, fakeExec('ERR:no-window\n', null, '')), /window is closed/)
	await assert.rejects(
		runMenuScript({ processName: 'x', mode: 'select' }, fakeExec('', new Error('fail'), 'Not authorized to send Apple events to System Events. (-1743)')),
		/Automation/,
	)
	await assert.rejects(runMenuScript({ processName: 'x', mode: 'select' }, fakeExec('ERR:no-dropdown:AXGroup x2\n', null, '')), /Elements found: AXGroup x2/)
	assert.equal(await runMenuScript({ processName: 'x', mode: 'select' }, fakeExec('OK:Theatrette (Channel 1)\n', null, '')), 'Theatrette (Channel 1)')
	let seen
	await runMenuScript({ processName: 'NDI Virtual Input', mode: 'select', full: 'A (B)', machine: 'A', short: 'B' }, (f, args, o, cb) => {
		seen = [f, args.slice(0, 2), args.slice(4)]
		cb(null, 'OK:A (B)', '')
	})
	assert.deepEqual(seen, ['osascript', ['-l', 'JavaScript'], ['NDI Virtual Input', 'select', 'A (B)', 'A', 'B']])
})
