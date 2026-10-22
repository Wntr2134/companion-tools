// Run with: node --test test/health.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { parseDevices, Monitor, tcpCheck } from '../src/monitor.js'

test('device list parsing', () => {
	const d = parseDevices('# comment\nFOH SD9, 192.168.1.100\n\nAmp rack, 10.0.0.5, 80\n10.0.0.9\nFOH SD9, 192.168.1.200\nBad port, 1.2.3.4, 99999')
	assert.deepEqual(
		d.map((x) => [x.id, x.name, x.host, x.port]),
		[
			['foh_sd9', 'FOH SD9', '192.168.1.100', undefined],
			['amp_rack', 'Amp rack', '10.0.0.5', 80],
			['10_0_0_9', '10.0.0.9', '10.0.0.9', undefined],
			['foh_sd9_', 'FOH SD9', '192.168.1.200', undefined],
			['bad_port', 'Bad port', '1.2.3.4', undefined],
		],
	)
})

test('one missed check does not mark a device down; two do; recovery is immediate', async () => {
	const results = { a: [true, false, false, true], b: [true, true, true, true] }
	const round = { n: 0 }
	const m = new Monitor({
		failuresToDown: 2,
		check: async (d) => {
			if (results[d.id][round.n]) return 3
			throw new Error('no reply')
		},
	})
	m.setDevices([
		{ id: 'a', name: 'Amp', host: 'x' },
		{ id: 'b', name: 'Board', host: 'y' },
	])
	let changes = 0
	m.on('change', () => changes++)
	const states = []
	for (round.n = 0; round.n < 4; round.n++) {
		await m.checkAll()
		states.push(m.state.get('a').status)
	}
	assert.deepEqual(states, ['up', 'up', 'down', 'up'])
	assert.equal(changes, 3) // unknown->up, up->down, down->up
	assert.equal(m.summary().allOk, true)
})

test('summary lists what is down', async () => {
	const m = new Monitor({ failuresToDown: 1, check: async (d) => (d.id === 'b' ? Promise.reject(new Error('x')) : 1) })
	m.setDevices([
		{ id: 'a', name: 'Amp', host: 'x' },
		{ id: 'b', name: 'Stage rack', host: 'y' },
	])
	await m.checkAll()
	assert.deepEqual(m.summary(), { total: 2, down: 1, downNames: ['Stage rack'], allOk: false })
})

test('TCP check: open port is up, closed port fails fast', async () => {
	const server = net.createServer((s) => s.end())
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const port = server.address().port
	assert.ok((await tcpCheck('127.0.0.1', port, 1000)) >= 0)
	server.close()
	await new Promise((r) => setTimeout(r, 50))
	await assert.rejects(tcpCheck('127.0.0.1', port, 1000))
})

test('wide key viewers: display only, short enough for a normal key too', async () => {
	const { getViewerPresets } = await import('../src/viewers.js')
	const out = getViewerPresets({ label: 'x' })
	const presets = out.presets ?? out
	assert.ok(Object.keys(presets).length > 0)
	for (const p of Object.values(presets)) {
		if (out.section === undefined) assert.equal(p.category, 'Wide key viewers')
		assert.deepEqual(p.steps, [{ down: [], up: [] }], 'viewers never do anything when pressed')
		assert.equal(p.style.size, 'auto')
		assert.ok(p.style.text.split('\\n').length <= 3, `at most 3 lines: ${p.name}`)
		assert.ok(!p.options?.rotaryActions)
	}
	if (out.section) assert.deepEqual(out.section.definitions, Object.keys(presets))
})

test('everything OK?: devices plus Companion connection states', async () => {
	const { parseWatchList, connectionTemplates, connectionState, everything } = await import('../src/connections.js')
	const watch = parseWatchList('digico\n# comment\nptz-1, magicq\ndigico')
	assert.deepEqual(watch, ['digico', 'ptz-1', 'magicq'])
	assert.deepEqual(connectionTemplates(['digico']).at(-1), ['c:digico', '$(internal:connection_digico_status)'])

	const conns = connectionState({ errors: '2', warnings: '1', total: '9', disabled: '1', 'c:digico': 'error', 'c:ptz-1': 'good', 'c:magicq': '$NA' }, watch)
	assert.deepEqual(conns.named, { error: ['digico'], warning: [], unknown: ['magicq'] })
	assert.equal(conns.problems, 2, 'warnings are not problems unless asked')

	const devicesOk = { total: 2, down: 0, downNames: [], allOk: true }
	const devicesDown = { total: 2, down: 1, downNames: ['FOH SD9'], allOk: false }
	assert.deepEqual(everything(devicesDown, conns), { ok: false, problems: 3, summary: '3 PROBLEMS', list: 'FOH SD9 down · digico error · 1 connection with errors' })

	const clean = connectionState({ errors: '0', warnings: '3', total: '5', disabled: '0' }, [])
	assert.deepEqual(everything(devicesOk, clean), { ok: true, problems: 0, summary: 'ALL OK', list: '' })
	const strict = connectionState({ errors: '0', warnings: '1', total: '5', disabled: '0' }, [], { warningsCount: true })
	assert.equal(everything(devicesOk, strict, { warningsCount: true }).list, '1 warning')
	assert.equal(everything({ total: 2, down: 0, downNames: [], allOk: false }, clean).summary, 'CHECKING')
	assert.equal(everything({ total: 0, down: 0, downNames: [], allOk: false }, clean).summary, 'ALL OK', 'connections only')
})
