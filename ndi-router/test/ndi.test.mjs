// Run with: node --test test/ndi.test.mjs   (needs a C compiler: it builds a fake NDI library first)
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import koffi from 'koffi'
import { openNdi, candidateLibraries, splitSourceName, isOwnRoute } from '../src/ndi.js'
import { Router, parseRouteNames } from '../src/router.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let LIB, fake

before(() => {
	LIB = path.join(mkdtempSync(path.join(os.tmpdir(), 'fakendi-')), process.platform === 'darwin' ? 'libfakendi.dylib' : 'libfakendi.so')
	execFileSync('cc', ['-shared', '-fPIC', '-o', LIB, path.join(here, 'fake-ndi', 'fake_ndi.c')])
	const l = koffi.load(LIB)
	fake = {
		setSources: l.func('void fake_set_sources(const char *)'),
		target: l.func('const char *fake_route_target(int)'),
		name: l.func('const char *fake_route_name(int)'),
		setConnections: l.func('void fake_set_connections(int, int)'),
		count: l.func('int fake_route_count()'),
		reset: l.func('void fake_reset_routes()'),
	}
})

test('binding: finds sources, creates a route, changes and clears it', () => {
	fake.reset()
	fake.setSources('')
	const ndi = openNdi(LIB)
	assert.equal(ndi.version, 'FAKE NDI 6.2')
	assert.deepEqual(ndi.sources(), [])
	fake.setSources('STUDIO-PC (Cam 1)\nSTUDIO-PC (Cam 2)')
	assert.deepEqual(ndi.sources(), ['STUDIO-PC (Cam 1)', 'STUDIO-PC (Cam 2)'])
	const r = ndi.createRoute('Companion 1')
	assert.equal(fake.name(0), 'Companion 1')
	assert.equal(r.change('STUDIO-PC (Cam 2)'), true)
	assert.equal(fake.target(0), 'STUDIO-PC (Cam 2)')
	fake.setConnections(0, 2)
	assert.equal(r.connections(), 2)
	r.clear()
	assert.equal(fake.target(0), '')
	ndi.destroy()
})

test('router: routes, remembers, hides its own routes, reports watchers', () => {
	fake.reset()
	fake.setSources('STUDIO-PC (Cam 1)\nMACBOOK (Companion 1)\nOBS-PC (Program)')
	const router = new Router(openNdi(LIB), ['Companion 1', 'Companion 2'], { 'Companion 2': 'OBS-PC (Program)' })
	assert.equal(fake.count(), 2)
	assert.equal(fake.target(1), 'OBS-PC (Program)', 'saved route restored on start')
	let sourcesEvents = 0
	let routeEvents = 0
	router.on('sources', () => sourcesEvents++)
	router.on('routes', () => routeEvents++)
	router.poll()
	assert.deepEqual(router.sourceList, ['OBS-PC (Program)', 'STUDIO-PC (Cam 1)'], 'own route left out, sorted')
	assert.equal(sourcesEvents, 1)
	router.poll()
	assert.equal(sourcesEvents, 1, 'no event when nothing changed')

	assert.equal(router.route('Companion 1', 'STUDIO-PC (Cam 1)'), true)
	assert.equal(fake.target(0), 'STUDIO-PC (Cam 1)')
	assert.equal(router.route('Companion 1', 'MACBOOK (Companion 2)'), false, 'a route never shows a route')
	assert.equal(router.route('Nope', 'STUDIO-PC (Cam 1)'), false)
	assert.deepEqual(router.snapshot(), { 'Companion 1': 'STUDIO-PC (Cam 1)', 'Companion 2': 'OBS-PC (Program)' })

	fake.setConnections(0, 1)
	router.poll()
	assert.equal(router.routes.get('Companion 1').connections, 1)
	assert.ok(routeEvents >= 2)

	router.clear('Companion 1')
	assert.equal(fake.target(0), '')
	assert.deepEqual(router.snapshot(), { 'Companion 2': 'OBS-PC (Program)' })
	router.destroy()
})

test('route names from settings', () => {
	assert.deepEqual(parseRouteNames(' Companion 1 \n\nCam (wide)\nCompanion 1\n'), ['Companion 1', 'Cam wide'])
	assert.equal(parseRouteNames(Array.from({ length: 20 }, (_, i) => `R${i}`).join('\n')).length, 16)
})

test('source names', () => {
	assert.deepEqual(splitSourceName('STUDIO-PC (Cam 1)'), { machine: 'STUDIO-PC', name: 'Cam 1' })
	assert.deepEqual(splitSourceName('WEIRD (A (B))'), { machine: 'WEIRD', name: 'A (B)' })
	assert.deepEqual(splitSourceName('plain'), { machine: '', name: 'plain' })
	assert.equal(isOwnRoute('MAC (Companion 1)', ['Companion 1']), true)
	assert.equal(isOwnRoute('MAC (Cam 1)', ['Companion 1']), false)
})

test('finding the NDI library on Mac and Windows', () => {
	const files = new Set([
		'/usr/local/lib/libndi.dylib',
		'/Applications/NDI Video Monitor.app/Contents/Frameworks/libndi_advanced.dylib',
		'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\Processing.NDI.Lib.x64.dll',
	])
	const dirs = {
		'/Applications': ['NDI Video Monitor.app', 'Safari.app'],
		'/Applications/NDI Video Monitor.app/Contents/Frameworks': ['libndi_advanced.dylib', 'Other.framework'],
		'C:\\Program Files\\NDI': ['NDI 6 Runtime', 'NDI 6 Tools'],
		'C:\\Program Files\\NDI\\NDI 6 Runtime': ['v6'],
	}
	const exists = (p) => files.has(p)
	const list = (d) => dirs[d] ?? []
	assert.deepEqual(candidateLibraries({ platform: 'darwin', env: {}, exists, list }), [
		'/usr/local/lib/libndi.dylib',
		'/Applications/NDI Video Monitor.app/Contents/Frameworks/libndi_advanced.dylib',
	])
	if (process.arch === 'x64') {
		assert.deepEqual(candidateLibraries({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, exists, list }), [
			'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\Processing.NDI.Lib.x64.dll',
		])
	}
})
