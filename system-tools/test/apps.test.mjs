// Run with: node --test test/apps.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
	scanMac,
	finaliseList,
	macFolders,
	macRunning,
	parseWindowsScan,
	parseTasklist,
	launchCommand,
	openCommand,
	quitCommand,
} from '../src/apps.js'

test('Mac scan finds .app bundles, one folder deep, and nothing else', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'apps-'))
	await mkdir(path.join(root, 'Dante Controller.app', 'Contents'), { recursive: true })
	await mkdir(path.join(root, 'UA Console.app'))
	await mkdir(path.join(root, 'Microsoft Office', 'Microsoft Word.app'), { recursive: true })
	await mkdir(path.join(root, 'Deep', 'Deeper', 'Hidden.app'), { recursive: true })
	await writeFile(path.join(root, 'notes.txt'), 'x')
	const apps = finaliseList(await scanMac([root, path.join(root, 'does-not-exist')]))
	assert.deepEqual(
		apps.map((a) => [a.id, a.name]),
		[
			['dante_controller', 'Dante Controller'],
			['microsoft_word', 'Microsoft Word'],
			['ua_console', 'UA Console'],
		],
	)
	assert.equal(apps[0].path, path.join(root, 'Dante Controller.app'))
})

test('built-in Mac apps only when asked', () => {
	assert.ok(!macFolders(false, '/Users/will').some((f) => f.startsWith('/System')))
	assert.ok(macFolders(true, '/Users/will').includes('/System/Applications'))
	assert.ok(macFolders(false, '/Users/will').includes('/Users/will/Applications'))
})

test('duplicate names get unique ids', () => {
	const apps = finaliseList([
		{ name: 'Zoom', path: '/a/Zoom.app' },
		{ name: 'zoom', path: '/b/zoom.app' },
		{ name: 'Ableton Live 12', path: '/c' },
	])
	assert.deepEqual(
		apps.map((a) => a.id),
		['ableton_live_12', 'zoom', 'zoom_'],
	)
})

test('Mac running check matches the app bundle executable', () => {
	const ps = '/sbin/launchd\n/Applications/Dante Controller.app/Contents/MacOS/Dante Controller\n/usr/libexec/foo\n'
	assert.equal(macRunning(ps, '/Applications/Dante Controller.app'), true)
	assert.equal(macRunning(ps, '/Applications/Dante.app'), false)
	assert.equal(macRunning(ps, '/Applications/UA Console.app'), false)
})

test('Windows scan keeps .exe shortcuts, drops uninstallers, links and duplicates', () => {
	const json = JSON.stringify([
		{ name: 'Dante Controller', lnk: 'C:\\ProgramData\\Start Menu\\Programs\\Audinate\\Dante Controller.lnk', target: 'C:\\Program Files\\Audinate\\Dante Controller\\DanteController.exe' },
		{ name: 'Uninstall Dante Controller', lnk: 'C:\\x\\u.lnk', target: 'C:\\Program Files\\Audinate\\uninstall.exe' },
		{ name: 'Audinate website', lnk: 'C:\\x\\w.lnk', target: 'https://audinate.com' },
		{ name: 'Dante Controller', lnk: 'C:\\Users\\will\\AppData\\Start Menu\\Dante Controller.lnk', target: 'C:\\Program Files\\Audinate\\Dante Controller\\DanteController.exe' },
		{ name: 'Settings', lnk: 'C:\\x\\s.lnk', target: '' },
		null,
	])
	const apps = parseWindowsScan(json)
	assert.deepEqual(apps, [
		{
			name: 'Dante Controller',
			path: 'C:\\ProgramData\\Start Menu\\Programs\\Audinate\\Dante Controller.lnk',
			exe: 'DanteController.exe',
		},
	])
	// PowerShell returns a bare object when there is only one shortcut
	assert.equal(parseWindowsScan(JSON.stringify({ name: 'OBS', lnk: 'C:\\o.lnk', target: 'C:\\obs64.exe' })).length, 1)
	assert.deepEqual(parseWindowsScan(''), [])
	assert.deepEqual(parseWindowsScan('not json'), [])
})

test('Windows Store apps are added (launched via the Apps folder), without doubling up', () => {
	const json = JSON.stringify({
		shortcuts: [{ name: 'Dante Controller', lnk: 'C:\\x\\Dante Controller.lnk', target: 'C:\\Program Files\\Audinate\\DanteController.exe' }],
		store: [
			{ name: 'Calculator', appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
			{ name: 'Dante Controller', appId: 'Fake.Dante_123!App' },
			{ name: 'Not store', appId: 'C:\\tools\\thing.exe' },
		],
	})
	const apps = parseWindowsScan(json)
	assert.deepEqual(
		apps.map((a) => [a.name, a.path, a.exe, a.store]),
		[
			['Dante Controller', 'C:\\x\\Dante Controller.lnk', 'DanteController.exe', undefined],
			['Calculator', 'shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App', undefined, true],
		],
	)
	const [, calc] = apps
	assert.deepEqual(launchCommand(calc, 'win32'), ['explorer.exe', ['shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App']])
	assert.throws(() => quitCommand(calc, {}, 'win32'), /Store app/)
})

test('Windows tasklist parsing', () => {
	const csv = '"System Idle Process","0","Services","0","8 K"\r\n"DanteController.exe","4120","Console","1","80,000 K"\r\n'
	const names = parseTasklist(csv)
	assert.ok(names.has('dantecontroller.exe'))
	assert.ok(!names.has('obs64.exe'))
})

test('launch and quit commands never go through a shell', () => {
	const mac = { name: 'UA "Console"', path: '/Applications/UA Console.app' }
	assert.deepEqual(launchCommand(mac, 'darwin'), ['open', ['-a', '/Applications/UA Console.app']])
	assert.deepEqual(quitCommand(mac, {}, 'darwin'), ['osascript', ['-e', 'quit app "UA \\"Console\\""']])
	assert.deepEqual(quitCommand(mac, { force: true }, 'darwin'), ['pkill', ['-f', '/Applications/UA Console.app/Contents/MacOS/']])
	const win = { name: 'Dante Controller', path: 'C:\\x\\Dante Controller.lnk', exe: 'DanteController.exe' }
	assert.deepEqual(launchCommand(win, 'win32'), ['explorer.exe', ['C:\\x\\Dante Controller.lnk']])
	assert.deepEqual(quitCommand(win, {}, 'win32'), ['taskkill', ['/IM', 'DanteController.exe']])
	assert.deepEqual(quitCommand(win, { force: true }, 'win32'), ['taskkill', ['/IM', 'DanteController.exe', '/F']])
	assert.throws(() => quitCommand({ name: 'typed', path: 'C:\\a.exe' }, {}, 'win32'))
	assert.throws(() => launchCommand(mac, 'linux'))
})

test('openCommand: a named browser skips link pickers like OpenIn (Mac)', () => {
	assert.deepEqual(openCommand('http://127.0.0.1:8000/', 'Safari', 'darwin'), ['open', ['-a', 'Safari', 'http://127.0.0.1:8000/']])
	assert.deepEqual(openCommand('http://127.0.0.1:8000/', ' ', 'darwin'), ['open', ['http://127.0.0.1:8000/']])
	assert.deepEqual(openCommand('http://127.0.0.1:8000/', undefined, 'darwin'), ['open', ['http://127.0.0.1:8000/']])
	assert.deepEqual(openCommand('http://127.0.0.1:8000/', 'Safari', 'win32'), ['explorer.exe', ['http://127.0.0.1:8000/']])
})
