// Run with: node --test test/
// Drives the step logic and command queue against a fake camera on localhost.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { CameraTransport } from '../src/transport.js'
import { StepController, parsePosition, lensToPercent, percentToLens } from '../src/steps.js'

const cam = { zoom: 0x800, focus: 0x900, gzSupported: true, hangNext: false, log: [] }

let server
before(async () => {
	server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://x')
		cam.log.push({ at: Date.now(), path: url.pathname, cmd: url.searchParams.get('cmd'), q: url.search })
		if (cam.hangNext) {
			cam.hangNext = false
			return // never answer
		}
		if (url.pathname === '/live/camdata.html') {
			return res.end(`p1\r\nOID:AW-HE40\r\naxz${cam.zoom.toString(16).toUpperCase()}\r\naxf${cam.focus.toString(16).toUpperCase()}\r\n`)
		}
		const cmd = (url.searchParams.get('cmd') ?? '').replace(/^#/, '')
		if (cmd === 'GZ') return res.end(cam.gzSupported ? `gz${cam.zoom.toString(16).toUpperCase()}` : 'er1')
		if (cmd === 'GF') return res.end(`gf${cam.focus.toString(16).toUpperCase()}`)
		if (cmd === 'APC') return res.end('aPC80007C00')
		let m
		if ((m = /^AXZ([0-9A-F]{3})$/.exec(cmd))) {
			cam.zoom = parseInt(m[1], 16)
			return res.end(`axz${m[1]}`)
		}
		if ((m = /^AXF([0-9A-F]{3})$/.exec(cmd))) {
			cam.focus = parseInt(m[1], 16)
			return res.end(`axf${m[1]}`)
		}
		if (/^RPC[0-9A-F]{8}$/.test(cmd)) return res.end(`aPC${cmd.slice(3)}`)
		res.end('er1')
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
})
after(() => server.close())

function makeSelf(extra = {}) {
	const self = {
		config: { host: '127.0.0.1', httpPort: server.address().port, commandInterval: 130, debug: false, ...extra },
		data: {},
		vars: {},
		logs: [],
		statuses: [],
		log: (level, msg) => self.logs.push([level, msg]),
		updateStatus: (s, m) => self.statuses.push([s, m]),
		setVariableValues: (v) => Object.assign(self.vars, v),
	}
	self.transport = new CameraTransport(self)
	self.steps = new StepController(self)
	return self
}

const idle = (self) => self.transport.enqueue(async () => undefined)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('parsePosition reads HE40 replies and camdata lines', () => {
	assert.deepEqual(parsePosition('gzB6C'), { zoom: 0xb6c })
	assert.deepEqual(parsePosition('axfF9C'), { focus: 0xf9c })
	assert.deepEqual(parsePosition('aPC80007C00'), { pan: 0x8000, tilt: 0x7c00 })
	assert.deepEqual(parsePosition('p1\r\naxz919\r\naxfF22'), { zoom: 0x919, focus: 0xf22 })
	assert.equal(lensToPercent(0x555), 0)
	assert.equal(lensToPercent(0xfff), 100)
	assert.equal(percentToLens(100), 0xfff)
})

test('fast zoom spin: one read, merged sends, every click counted', async () => {
	cam.zoom = 0x800
	cam.log = []
	const self = makeSelf()
	for (let i = 0; i < 10; i++) await self.steps.stepLens('zoom', 50)
	await idle(self)
	await idle(self)
	assert.equal(cam.zoom, 0x800 + 500, 'all 10 clicks applied')
	assert.equal(cam.log.filter((l) => l.cmd === '#GZ').length, 1, 'position read once')
	const sends = cam.log.filter((l) => l.cmd?.startsWith('#AXZ'))
	assert.ok(sends.length <= 3, `sends merged (${sends.length})`)
	assert.equal(self.vars.zoomPositionRaw, (0x800 + 500).toString(16).toUpperCase())
})

test('commands are spaced by the command interval', async () => {
	cam.log = []
	const self = makeSelf({ commandInterval: 130 })
	for (let i = 0; i < 4; i++) self.steps.stepPanTilt(0, 100) // each queued separately below
	await idle(self)
	for (let i = 0; i < 3; i++) {
		await self.transport.get(`http://127.0.0.1:${server.address().port}/cgi-bin/aw_ptz?cmd=%23O&res=1`)
	}
	const times = cam.log.map((l) => l.at)
	for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 120, `gap ${times[i] - times[i - 1]}ms`)
})

test('fast pan clicks merge into one relative move with the full distance', async () => {
	cam.log = []
	const self = makeSelf()
	// keep the queue busy so the clicks pile up
	self.transport.enqueue(() => sleep(50))
	for (let i = 0; i < 5; i++) self.steps.stepPanTilt(1280, 0)
	await idle(self)
	const rpc = cam.log.filter((l) => l.cmd?.startsWith('#RPC'))
	assert.equal(rpc.length, 1)
	assert.equal(rpc[0].cmd, '#RPC' + (0x8000 + 5 * 1280).toString(16).toUpperCase() + '8000')
})

test('left/right clicks that cancel out send nothing', async () => {
	cam.log = []
	const self = makeSelf()
	self.transport.enqueue(() => sleep(50))
	self.steps.stepPanTilt(1280, 0)
	self.steps.stepPanTilt(-1280, 0)
	await idle(self)
	assert.equal(cam.log.filter((l) => l.cmd?.startsWith('#RPC')).length, 0)
})

test('zoom falls back to camdata.html when #GZ is unsupported', async () => {
	cam.zoom = 0x700
	cam.gzSupported = false
	cam.log = []
	const self = makeSelf()
	await self.steps.stepLens('zoom', -100)
	await idle(self)
	cam.gzSupported = true
	assert.equal(cam.zoom, 0x700 - 100)
	assert.ok(cam.log.some((l) => l.path === '/live/camdata.html'))
	assert.ok(self.logs.some(([lvl, m]) => lvl === 'warn' && m.includes('er1')), 'camera error logged')
})

test('lens target clamps at the ends of the range', async () => {
	cam.zoom = 0xff0
	const self = makeSelf()
	await self.steps.stepLens('zoom', 500)
	await idle(self)
	assert.equal(cam.zoom, 0xfff)
})

test('a hung request times out once and is not retried', async () => {
	cam.log = []
	cam.hangNext = true
	const self = makeSelf()
	await assert.rejects(self.transport.get(`http://127.0.0.1:${server.address().port}/cgi-bin/aw_ptz?cmd=%23RPC85008000&res=1`))
	assert.equal(cam.log.length, 1, 'no automatic retry')
	// queue keeps working afterwards
	assert.equal(await self.transport.get(`http://127.0.0.1:${server.address().port}/cgi-bin/aw_ptz?cmd=%23GZ&res=1`).then((b) => b.slice(0, 2)), 'gz')
})

test('polling stops asking for a query the camera rejects', async () => {
	cam.gzSupported = false
	cam.log = []
	const self = makeSelf()
	await self.steps.refreshPositions()
	await self.steps.refreshPositions()
	cam.gzSupported = true
	assert.equal(cam.log.filter((l) => l.cmd === '#GZ').length, 1, '#GZ asked once only')
	assert.equal(cam.log.filter((l) => l.path === '/live/camdata.html').length, 2, 'camdata used instead')
	assert.equal(self.vars.panPosition, '8000')
	assert.equal(self.vars.tiltPosition, '7C00')
})

test('step size 1-10 maps to sensible distances, default 2', async () => {
	const { getStepActionDefinitions, PAN_TILT_STEP_UNITS } = await import('../src/steps.js')
	assert.equal(PAN_TILT_STEP_UNITS[1], 640, 'size 2 is half the old 1280 default')
	cam.log = []
	const self = makeSelf()
	const defs = getStepActionDefinitions(self)
	await defs.knobPanTiltStep.callback({ options: { direction: 'right', size: 1 } })
	await idle(self)
	await defs.knobPanTiltStep.callback({ options: { direction: 'up' } }) // no size -> default 2
	await idle(self)
	const rpc = cam.log.filter((l) => l.cmd?.startsWith('#RPC')).map((l) => l.cmd)
	assert.deepEqual(rpc, ['#RPC' + (0x8000 + 256).toString(16).toUpperCase() + '8000', '#RPC8000' + (0x8000 + 640).toString(16).toUpperCase()])
	cam.zoom = 0x800
	await defs.knobZoomStep.callback({ options: { direction: 'in', size: 10, method: 'position' } })
	await idle(self)
	assert.equal(cam.zoom, 0x800 + Math.round(0.16 * (0xfff - 0x555)))
})

test('upgrade converts old numeric step to the 1-10 size', async () => {
	const { UpgradeScripts } = await import('../src/upgrades.js')
	const up = UpgradeScripts[UpgradeScripts.length - 1]
	const res = up({}, {
		actions: [
			{ id: 'a', actionId: 'knobPanTiltStep', options: { direction: 'left', step: 1280 } },
			{ id: 'b', actionId: 'knobZoomStep', options: { direction: 'in', step: 2, method: 'position' } },
			{ id: 'c', actionId: 'knobFocusStep', options: { direction: 'far', size: 5 } },
		],
		feedbacks: [],
	})
	assert.equal(res.updatedActions.length, 2)
	assert.deepEqual(res.updatedActions[0].options, { direction: 'left', size: 4 })
	assert.deepEqual(res.updatedActions[1].options, { direction: 'in', size: 4, method: 'position' })
})

test('selected camera: knob only moves the camera whose number is selected', async () => {
	const { getStepActionDefinitions } = await import('../src/steps.js')
	cam.log = []
	const self = makeSelf({ cameraNumber: 2, selectVariable: '$(custom:ptz_cam)' })
	const defs = getStepActionDefinitions(self)
	let selected = '1'
	const context = { parseVariablesInString: async (t) => (t === '$(custom:ptz_cam)' ? selected : t) }
	await defs.knobPanTiltStep.callback({ options: { direction: 'right', size: 2, onlyIfSelected: true } }, context)
	await idle(self)
	assert.equal(cam.log.filter((l) => l.cmd?.startsWith('#RPC')).length, 0, 'camera 2 ignores knob while camera 1 is selected')
	selected = '2'
	await defs.knobPanTiltStep.callback({ options: { direction: 'right', size: 2, onlyIfSelected: true } }, context)
	await idle(self)
	assert.equal(cam.log.filter((l) => l.cmd?.startsWith('#RPC')).length, 1)
	// without the tick box it always moves
	selected = '1'
	await defs.knobPanTiltStep.callback({ options: { direction: 'right', size: 2 } }, context)
	await idle(self)
	assert.equal(cam.log.filter((l) => l.cmd?.startsWith('#RPC')).length, 2)
})
