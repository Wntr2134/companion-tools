// Run with: node --test test/lights.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { HueBridge, hueState, toPct, toBri, toMired, toWarmCold } from '../src/hue.js'
import { parseTuyaDevices, tuyaSchema, tuyaState, tuyaChange, TuyaDevice } from '../src/tuya.js'

const KEY_TOOL_OUTPUT = `Lounge Lamp  (online)
  devId     : bf0123456789abcdefgh
  localKey  : a1b2c3d4e5f6a7b8
  productId : abcDEF123
  category  : dj
  dps       : {"20": true, "21": "white", "22": 500, "23": 300}

Kitchen Plug  (offline)
  devId     : bf9876543210zyxwvuts
  localKey  : 0011223344556677
  category  : cz
  dps       : {"1": false, "19": 0}
`

test('Grid Connect devices: the key tool\'s output pasted as it is, or one per line', () => {
	const d = parseTuyaDevices(KEY_TOOL_OUTPUT)
	assert.deepEqual(
		d.map((x) => [x.name, x.id, x.key, x.category]),
		[
			['Lounge Lamp', 'bf0123456789abcdefgh', 'a1b2c3d4e5f6a7b8', 'dj'],
			['Kitchen Plug', 'bf9876543210zyxwvuts', '0011223344556677', 'cz'],
		],
	)
	assert.deepEqual(d[0].dps, { 20: true, 21: 'white', 22: 500, 23: 300 })
	const lines = parseTuyaDevices('# my bulbs\nDesk, bf0123456789abcdefgh, a1b2c3d4e5f6a7b8, 192.168.1.40\nNo key here')
	assert.deepEqual(lines.map((x) => [x.name, x.ip]), [['Desk', '192.168.1.40']], 'a name with no devId/localKey is skipped')
})

test('Tuya bulbs: newer and older data points, plugs, and changes', () => {
	const v2 = tuyaSchema({ 20: true, 21: 'white', 22: 1000, 23: 0 })
	assert.equal(v2.kind, 'light')
	assert.deepEqual(tuyaState({ 20: true, 22: 1000, 23: 0 }, v2), { on: true, brightness: 100, warmCold: 0 })
	assert.deepEqual(tuyaChange({ brightness: 50 }, v2), { 20: true, 22: 505, 21: 'white' }, 'brightness turns it on, in white')
	assert.deepEqual(tuyaChange({ brightness: 0 }, v2), { 20: false }, 'brightness 0 = off')
	assert.deepEqual(tuyaChange({ warmCold: 100 }, v2), { 23: 1000, 21: 'white' })
	const v1 = tuyaSchema({ 1: true, 2: 'white', 3: 255, 4: 0 })
	assert.deepEqual([v1.on, v1.bri, v1.briMin, v1.briMax], ['1', '3', 25, 255])
	assert.equal(tuyaState({ 1: true, 3: 25 }, v1).brightness, 1)
	const plug = tuyaSchema({ 1: false, 19: 0 })
	assert.equal(plug.kind, 'switch')
	assert.deepEqual(tuyaChange({ on: true, brightness: 50 }, plug), { 1: true }, 'a plug only switches')
})

/** A stand-in for tuyapi: records what's sent, emits what a device would. */
class FakeApi extends EventEmitter {
	static made = []
	constructor(opts) {
		super()
		this.device = { ...opts }
		this.sent = []
		FakeApi.made.push(this)
	}
	async find() {
		this.device.ip = '192.168.1.77'
		this.device.version = '3.4'
	}
	async connect() {
		this.emit('connected')
	}
	async get() {
		this.emit('data', { dps: { 20: true, 21: 'white', 22: 1000, 23: 500 } })
	}
	async set(o) {
		this.sent.push(o)
	}
	disconnect() {
		this.emit('disconnected')
	}
}

test('Tuya device: found on the network, connected, read, set, and reconnecting by itself', async () => {
	const changes = []
	const [def] = parseTuyaDevices(KEY_TOOL_OUTPUT)
	const d = new TuyaDevice(def, { Api: FakeApi, onChange: (x) => changes.push(x.state), retryMs: 10 })
	await d.start()
	const api = FakeApi.made.at(-1)
	assert.equal(api.device.ip, '192.168.1.77', 'no IP given: found by its announcement')
	assert.deepEqual(d.state, { on: true, brightness: 100, warmCold: 50, reachable: true })
	await d.set({ brightness: 20 })
	assert.deepEqual(api.sent.at(-1), { multiple: true, data: { 20: true, 22: 208, 21: 'white' } })
	assert.equal(d.state.brightness, 20, 'shows the change straight away')
	api.emit('disconnected')
	assert.equal(d.state.reachable, false)
	await new Promise((r) => setTimeout(r, 30))
	assert.equal(d.state.reachable, true, 'reconnected')
	d.stop()
	await assert.rejects(new TuyaDevice({ ...def, name: 'Off' }, { Api: class extends FakeApi { async connect() {} } }).set({ on: true }), /isn't connected/)
})

test('Hue: conversions between the bridge and the module', () => {
	assert.equal(toPct(254), 100)
	assert.equal(toPct(1), 1)
	assert.equal(toBri(50), 127)
	assert.equal(toMired(0), 500, '0 = warmest')
	assert.equal(toMired(100), 153, '100 = coldest')
	assert.equal(toWarmCold(500), 0)
	assert.deepEqual(hueState({ brightness: 0 }), { on: false })
	assert.deepEqual(hueState({ brightness: 50 }), { bri: 127, on: true })
	assert.deepEqual(hueState({ on: false, transition: 0.4 }), { on: false, transitiontime: 4 })
})

test('Hue bridge: pairing waits for the button, then lights, rooms, scenes and changes', async () => {
	const calls = []
	let pressed = false
	const reply = (body) => ({ ok: true, status: 200, json: async () => body })
	const fetchFn = async (url, opts = {}) => {
		calls.push([opts.method ?? 'GET', url, opts.body ? JSON.parse(opts.body) : undefined])
		if (url === 'http://10.0.0.2/api' && opts.method === 'POST') return reply(pressed ? [{ success: { username: 'KEY123' } }] : [{ error: { type: 101, description: 'link button not pressed' } }])
		if (url.includes('/BADKEY/')) return reply([{ error: { type: 1, description: 'unauthorized user' } }])
		if (url.endsWith('/lights')) return reply({ 1: { name: 'Desk', state: { on: true, bri: 254, ct: 366, reachable: true } }, 2: { name: 'Hall', state: { on: true, bri: 100, reachable: false } } })
		if (url.endsWith('/groups')) return reply({ 1: { name: 'Lounge', type: 'Room', lights: ['1'], state: { any_on: true, all_on: true }, action: { bri: 127 } }, 9: { name: 'Entertainment', type: 'Entertainment' } })
		if (url.endsWith('/scenes')) return reply({ abc: { name: 'Relax', type: 'GroupScene', group: '1' }, xyz: { name: 'Old', type: 'LightScene' } })
		return reply([{ success: {} }])
	}
	const hue = new HueBridge({ ip: '10.0.0.2', fetchFn })
	assert.equal(await hue.pairOnce(), null, 'button not pressed yet')
	pressed = true
	assert.equal(await hue.pairOnce(), 'KEY123')
	const s = await hue.state()
	assert.deepEqual(s.lights.map((l) => [l.name, l.on, l.brightness, l.reachable]), [['Desk', true, 100, true], ['Hall', true, 39, false]])
	assert.deepEqual(s.groups.map((g) => [g.name, g.on, g.brightness]), [['Lounge', true, 50]], 'rooms and zones only')
	assert.deepEqual(s.scenes, [{ id: 'abc', name: 'Relax', group: '1' }])
	await hue.setLight('1', { brightness: 50 })
	assert.deepEqual(calls.at(-1), ['PUT', 'http://10.0.0.2/api/KEY123/lights/1/state', { bri: 127, on: true }])
	await hue.recallScene('1', 'abc')
	assert.deepEqual(calls.at(-1), ['PUT', 'http://10.0.0.2/api/KEY123/groups/1/action', { scene: 'abc' }])
	await assert.rejects(new HueBridge({ ip: '10.0.0.2', key: 'BADKEY', fetchFn }).state(), /pair it again/)
})

test('surface extras: every knob also gets − / + keys and a push key', async () => {
	const { withSurfaceExtras } = await import('../src/surface-extras.js')
	const out = withSurfaceExtras({
		k: { type: 'button', category: 'Rooms: knobs', name: 'Lounge', options: { rotaryActions: true }, style: { text: 'LOUNGE\\n50%' }, steps: [{ down: [{ actionId: 'power' }], up: [], rotate_left: [{ actionId: 'a' }], rotate_right: [{ actionId: 'b' }] }], feedbacks: [] },
	})
	assert.ok(out.k__minus && out.k__plus && out.k__push)
	assert.deepEqual(out.k__plus.steps[0].down, [{ actionId: 'b' }])
})

test('wide key viewers: display only, short enough for a normal key too', async () => {
	const { getViewerPresets } = await import('../src/viewers.js')
	for (const [id, p] of Object.entries(getViewerPresets({ label: 'smart-lights' }))) {
		assert.equal(p.category, 'Wide key viewers')
		assert.equal(p.style.size, 'auto')
		assert.ok(p.style.text.split('\\n').length <= 3, id)
		assert.deepEqual(p.steps[0], { down: [], up: [] })
	}
})
