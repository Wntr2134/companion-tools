// Run with: node --test test/
// A fake UA Mixer Engine on localhost, shaped like the replies documented by
// UA-Midi-Control and cuefinger, driven through the real client and actions.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { UAClient, normalisePath, extractValue, findTalkback } from '../src/ua-client.js'
import { getExtraActions, getExtraVariableValues, getExtraFeedbacks, getExtraPresets, selection, meterBar } from '../src/extras.js'
import { getActions, getFeedbacks, getVariableValues, getVariableDefinitions, getPresets, stepDb } from '../src/controls.js'

const engine = { props: new Map(), sets: [], subs: new Set(), splitWrites: true, inputCount: 4 }
const P = (k, v) => engine.props.set(k, v)
function resetEngine() {
	engine.inputCount = 4
	engine.props.clear()
	engine.sets = []
	for (let i = 0; i < 4; i++) {
		const b = `/devices/0/inputs/${i}`
		P(`${b}/Mute`, false)
		P(`${b}/Solo`, false)
		P(`${b}/FaderLevel`, i === 3 ? -144 : 0)
		P(`${b}/Pan`, 0)
		P(`${b}/sends/0/Gain`, -144)
		P(`${b}/sends/1/Gain`, -144)
		P(`${b}/sends/0/Bypass`, false)
		P(`${b}/preamps/0/48V`, false)
		P(`${b}/preamps/0/GainTapered`, 0.5)
	}
	for (let i = 0; i < 2; i++) {
		P(`/devices/0/auxs/${i}/Mute`, false)
		P(`/devices/0/auxs/${i}/FaderLevel`, 0)
	}
	P('/devices/0/TalkbackOn', false)
	P('/devices/0/outputs/0/Mute', false)
	P('/devices/0/outputs/0/CRMonitorLevel', -20)
	P('/devices/0/outputs/0/DimOn', false)
}
const NAMES = { 'inputs/0': 'Kick', 'inputs/1': 'Snare', 'inputs/2': '', 'inputs/3': 'Vox', 'auxs/0': 'Cue 1', 'auxs/1': 'Cue 2', 'outputs/0': 'Monitor', 'outputs/1': 'Line 1' }
const INACTIVE = new Set(['inputs/2'])

function reply(path) {
	const parts = path.split('/').filter(Boolean)
	const kids = (o) => Object.fromEntries(o.map((k) => [k, {}]))
	if (path === '/devices') return { path, data: { properties: { Type: { type: 'string', value: 'container' } }, children: kids(['0']) } }
	if (parts.length === 2) return { path, data: { properties: { DeviceName: { value: 'Apollo Twin X' }, DeviceOnline: { value: true }, TalkbackOn: { value: engine.props.get('/devices/0/TalkbackOn') } }, children: kids(['inputs', 'auxs', 'outputs']) } }
	if (parts.length === 3 && ['inputs', 'auxs', 'outputs'].includes(parts[2])) {
		const ids = { inputs: Array.from({ length: engine.inputCount }, (_, i) => String(i)), auxs: ['0', '1'], outputs: ['0', '1'] }[parts[2]]
		return { path, data: { properties: {}, children: kids(ids) } }
	}
	if (parts.length === 4) {
		const base = '/' + parts.join('/')
		const props = { Name: { value: NAMES[`${parts[2]}/${parts[3]}`], default: `Analog ${Number(parts[3]) + 1}` }, Active: { value: !INACTIVE.has(`${parts[2]}/${parts[3]}`) } }
		for (const [k, v] of engine.props) {
			const rest = k.slice(base.length + 1)
			if (k.startsWith(base + '/') && !rest.includes('/')) props[rest] = { value: v }
		}
		const children = parts[2] === 'inputs' ? kids(['sends', 'preamps']) : {}
		return { path, data: { properties: props, children } }
	}
	if (parts.length === 5 && parts[4] === 'sends') return { path, data: { properties: {}, children: kids(['0', '1']) } }
	if (parts.length === 6 && parts[4] === 'sends') return { path, data: { properties: { Name: { value: ['AUX 1', 'CUE 1'][parts[5]] } }, children: {} } }
	const key = normalisePath(path)
	if (engine.props.has(key)) return { path: key, data: { properties: { value: { value: engine.props.get(key) } } } }
	return { path, data: null }
}

let server
const sockets = new Set()
const writeChains = new WeakMap()
function write(sock, obj) {
	const buf = Buffer.from(JSON.stringify(obj) + '\0')
	if (!engine.splitWrites) return sock.write(buf)
	// Split each message across two packets (in order) to prove the client reassembles them
	const mid = Math.floor(buf.length / 2)
	const prev = writeChains.get(sock) ?? Promise.resolve()
	const next = prev.then(async () => {
		if (sock.destroyed) return
		sock.write(buf.subarray(0, mid))
		await new Promise((r) => setImmediate(r))
		if (!sock.destroyed) sock.write(buf.subarray(mid))
	})
	writeChains.set(sock, next)
}

before(async () => {
	resetEngine()
	server = net.createServer((sock) => {
		sockets.add(sock)
		sock.on('close', () => sockets.delete(sock))
		sock.on('error', () => sockets.delete(sock))
		let buf = ''
		sock.on('data', (d) => {
			buf += d.toString()
			let i
			while ((i = buf.indexOf('\0')) !== -1) {
				const line = buf.slice(0, i)
				buf = buf.slice(i + 1)
				const [verb, path, val] = line.split(' ')
				if (verb === 'get') write(sock, reply(path))
				else if (verb === 'subscribe') engine.subs.add(normalisePath(path))
				else if (verb === 'set' && path !== '/Sleep') {
					const key = normalisePath(path)
					const v = val === 'true' ? true : val === 'false' ? false : Number(val)
					engine.props.set(key, v)
					engine.sets.push([key, v])
					// subscription echo, in the UA-Midi-Control shape
					if (engine.subs.has(key)) for (const s of sockets) write(s, { path: key + '/value', data: v })
				}
			}
		})
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
})
const clients = new Set()
after(() => {
	for (const c of clients) c.stop()
	for (const s of sockets) s.destroy()
	server.close()
})

async function connected(opts) {
	resetEngine()
	const client = new UAClient(opts)
	clients.add(client)
	const ready = new Promise((r) => client.once('devices', r))
	client.start('127.0.0.1', server.address().port)
	await ready
	const self = { client, label: 'uad' }
	return { client, self, actions: getActions(self), feedbacks: getFeedbacks(self) }
}
const run = (actions, id, options) => actions[id].callback({ options }, { parseVariablesInString: async (s) => s })
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

test('path and value helpers', () => {
	assert.equal(normalisePath('/devices/0/inputs/3/Mute/value/'), '/devices/0/inputs/3/Mute')
	assert.equal(extractValue(true), true)
	assert.equal(extractValue({ properties: { value: { value: -6 } } }), -6)
	assert.equal(extractValue({ value: false }), false)
})

test('fader step maths: -inf, floor, clamp', () => {
	assert.equal(stepDb(-144, 0.5), -60)
	assert.equal(stepDb(-59.5, -1), -144)
	assert.equal(stepDb(11.8, 1), 12)
	assert.equal(stepDb(-20, -0.5, -96, 0), -20.5)
	assert.equal(stepDb(-96, 0.5, -96, 0), -95.5, 'monitor has no -60 jump')
})

test('discovers channels, names, monitor output only, sends', async () => {
	const { client, self } = await connected()
	const chans = client.devices[0].channels
	assert.equal(client.devices[0].name, 'Apollo Twin X')
	assert.deepEqual(chans.filter((c) => c.group === 'inputs').map((c) => c.name), ['Kick', 'Snare', 'Analog 3', 'Vox'])
	assert.deepEqual(chans.filter((c) => c.group === 'outputs').map((c) => c.id), ['0'], 'non-monitor output skipped')
	assert.deepEqual(chans[0].sends, ['0', '1'])
	const vars = getVariableValues(self)
	assert.equal(vars.in_1_name, 'Kick')
	assert.equal(vars.in_4_level, '-inf')
	assert.equal(vars.mon_1_level, '-20.0')
	assert.ok(getVariableDefinitions(self).some((d) => d.variableId === 'aux_2_mute'))
	assert.ok(Object.keys(getPresets(self)).includes('in_1_mute_hold'))
	assert.ok(!Object.keys(getPresets(self)).includes('in_3_mute'), 'no presets for unused channels')
	assert.deepEqual(client.devices[0].sendNames, { 0: 'AUX 1', 1: 'CUE 1' })
	const sendOpt = getActions(self).sendStep.options.find((o) => o.id === 'send')
	assert.equal(sendOpt.choices[1].label, 'Send 2: CUE 1')
	client.stop()
})

test('mute toggle / on / off and momentary hold', async () => {
	const { client, actions, feedbacks } = await connected()
	await run(actions, 'mute', { channel: '0/inputs/1', mode: 'toggle' })
	await tick()
	assert.equal(engine.props.get('/devices/0/inputs/1/Mute'), true)
	assert.equal(feedbacks.muted.callback({ options: { channel: '0/inputs/1' } }), true)
	await run(actions, 'mute', { channel: '0/inputs/1', mode: 'toggle' })
	await tick()
	assert.equal(engine.props.get('/devices/0/inputs/1/Mute'), false)
	// momentary: press = on, release = off
	await run(actions, 'mute', { channel: '0/auxs/0', mode: 'on' })
	await tick()
	assert.equal(engine.props.get('/devices/0/auxs/0/Mute'), true)
	await run(actions, 'mute', { channel: '0/auxs/0', mode: 'off' })
	await tick()
	assert.equal(engine.props.get('/devices/0/auxs/0/Mute'), false)
	client.stop()
})

test('fast fader knob spin: every click counts, echoes do not drag it back', async () => {
	const { client, actions } = await connected()
	for (let i = 0; i < 20; i++) await run(actions, 'levelStep', { channel: '0/inputs/0', direction: 'down', size: 2 })
	await tick(100)
	assert.equal(engine.props.get('/devices/0/inputs/0/FaderLevel'), -10)
	assert.equal(client.values.get('/devices/0/inputs/0/FaderLevel'), -10)
	// Up from -inf starts at -60
	await run(actions, 'levelStep', { channel: '0/inputs/3', direction: 'up', size: 2 })
	await tick()
	assert.equal(engine.props.get('/devices/0/inputs/3/FaderLevel'), -60)
	client.stop()
})

test('external changes (someone moves Console) update state', async () => {
	const { client, feedbacks } = await connected()
	for (const s of sockets) write(s, { path: '/devices/0/outputs/0/DimOn/value', data: true })
	await tick(60)
	assert.equal(feedbacks.monitorDimmed.callback({ options: { channel: '0/outputs/0' } }), true)
	client.stop()
})

test('pan, send, preamp, monitor actions write the right paths', async () => {
	const { client, actions } = await connected()
	await run(actions, 'panStep', { channel: '0/inputs/0', direction: 'up', size: 5 })
	await run(actions, 'sendStep', { channel: '0/inputs/0', send: '1', direction: 'up', size: 2 })
	await run(actions, 'preampSwitch', { channel: '0/inputs/0', prop: '48V', mode: 'toggle' })
	await run(actions, 'preampGainStep', { channel: '0/inputs/0', direction: 'up', size: 10 })
	await run(actions, 'monitorStep', { channel: '0/outputs/0', direction: 'down', size: 4 })
	await run(actions, 'monitorDim', { channel: '0/outputs/0', mode: 'on' })
	await tick(80)
	assert.equal(engine.props.get('/devices/0/inputs/0/Pan'), 0.1)
	assert.equal(engine.props.get('/devices/0/inputs/0/sends/1/Gain'), -60)
	assert.equal(engine.props.get('/devices/0/inputs/0/preamps/0/48V'), true)
	assert.equal(engine.props.get('/devices/0/inputs/0/preamps/0/GainTapered'), 0.7)
	assert.equal(engine.props.get('/devices/0/outputs/0/CRMonitorLevel'), -21.5)
	assert.equal(engine.props.get('/devices/0/outputs/0/DimOn'), true)
	client.stop()
})

test('reconnects after the engine drops the connection', async () => {
	const { client } = await connected()
	let reconnected = new Promise((r) => client.once('devices', r))
	for (const s of sockets) s.destroy()
	await tick(50)
	assert.equal(client.connected, false)
	await reconnected
	assert.equal(client.connected, true)
	client.stop()
})

test('channel renamed in Console updates names live', async () => {
	const { client, self } = await connected()
	const changed = new Promise((r) => client.once('devices', r))
	for (const s of sockets) write(s, { path: '/devices/0/inputs/1/Name/value', data: 'Snare Top' })
	await changed
	assert.equal(getVariableValues(self).in_2_name, 'Snare Top')
	// clearing the custom name falls back to Console's default name
	const back = new Promise((r) => client.once('devices', r))
	for (const s of sockets) write(s, { path: '/devices/0/inputs/1/Name/value', data: '' })
	await back
	assert.equal(getVariableValues(self).in_2_name, 'Analog 2')
	client.stop()
})

test('channel count change (e.g. sample rate) triggers a rescan', async () => {
	const { client } = await connected({ layoutCheckMs: 100, rescanDelayMs: 50 })
	assert.equal(client.devices[0].channels.filter((c) => c.group === 'inputs').length, 4)
	const rescanned = new Promise((r) => client.once('devices', r))
	engine.inputCount = 6
	await rescanned
	assert.equal(client.devices[0].channels.filter((c) => c.group === 'inputs').length, 6)
	client.stop()
})

test('device going offline/online triggers one rescan, not a loop', async () => {
	const { client } = await connected({ layoutCheckMs: 60000, rescanDelayMs: 50 })
	let scans = 0
	client.on('devices', () => scans++)
	for (const s of sockets) write(s, { path: '/devices/0/DeviceOnline/value', data: true })
	await tick(150) // first report just records the state
	for (const s of sockets) write(s, { path: '/devices/0/DeviceOnline/value', data: false })
	await tick(1500)
	assert.equal(scans, 1)
	client.stop()
})

test('talkback detection prefers a real switch, falls back to the TALKBACK channel', () => {
	assert.equal(findTalkback({ id: '0', propNames: ['DeviceName', 'TalkbackOn'], channels: [] }).path, '/devices/0/TalkbackOn')
	const mon = { key: '0/outputs/18', group: 'outputs', propNames: ['Mute', 'CRMonitorLevel', 'TalkBack'] }
	assert.equal(findTalkback({ id: '0', propNames: ['DeviceName'], channels: [mon] }).path, '/devices/0/outputs/18/TalkBack')
	const tb = findTalkback({ id: '0', propNames: [], channels: [], talkbackChannel: '0/inputs/22' })
	assert.deepEqual([tb.path, tb.invert], ['/devices/0/inputs/22/Mute', true])
	assert.equal(findTalkback({ id: '0', propNames: [], channels: [] }), null)
})

test('talkback hold: press talks, release stops', async () => {
	const { client, self } = await connected()
	self.config = {}
	const x = getExtraActions(self)
	await x.talkback.callback({ options: { device: 'all', mode: 'on' } })
	await tick()
	assert.equal(engine.props.get('/devices/0/TalkbackOn'), true)
	assert.equal(getExtraFeedbacks(self).talkbackOn.callback({ options: { device: 'all' } }), true)
	await x.talkback.callback({ options: { device: 'all', mode: 'off' } })
	await tick()
	assert.equal(engine.props.get('/devices/0/TalkbackOn'), false)
	assert.match(getExtraVariableValues(self).talkback_method, /device TalkbackOn/)
	client.stop()
})

test('cue strip: select channel + send, knob changes that send only', async () => {
	const { client, self } = await connected()
	self.config = {}
	self.refreshAll = () => {}
	const x = getExtraActions(self)
	assert.equal(selection(self).channel, '0/inputs/0', 'defaults to first active input')
	await x.selectChannelStep.callback({ options: { direction: 'up' } })
	assert.equal(selection(self).channel, '0/inputs/1')
	await x.selectChannelStep.callback({ options: { direction: 'up' } })
	assert.equal(selection(self).channel, '0/inputs/3', 'skips the unused channel')
	await x.selectSend.callback({ options: { send: '1' } })
	for (let i = 0; i < 3; i++) await x.selectedSendStep.callback({ options: { direction: 'up', size: 2 } })
	await tick(60)
	assert.equal(engine.props.get('/devices/0/inputs/3/sends/1/Gain'), -59)
	assert.equal(engine.props.get('/devices/0/inputs/3/sends/0/Gain'), -144)
	const vals = getExtraVariableValues(self)
	assert.equal(vals.sel_name, 'Vox')
	assert.equal(vals.sel_send_name, 'CUE 1')
	assert.equal(vals.sel_send_level, '-59.0')
	await x.selectedMute.callback({ options: { what: 'send' } })
	await tick()
	assert.equal(engine.props.get('/devices/0/inputs/3/sends/1/Bypass'), true)
	assert.ok(Object.keys(getExtraPresets(self)).includes('sel_send_knob'))
	client.stop()
})

test('meters: selected channel subscribed, bar drawn', async () => {
	const { client, self } = await connected()
	self.config = { meters: 'selected' }
	self.refreshAll = () => {}
	await getExtraActions(self).selectChannel.callback({ options: { channel: '0/inputs/0' } })
	await tick(60)
	assert.ok(engine.subs.has('/devices/0/inputs/0/meters/0/MeterLevel'))
	for (const s of sockets) write(s, { path: '/devices/0/inputs/0/meters/0/MeterLevel/value', data: -30 })
	await tick(60)
	assert.equal(getExtraVariableValues(self).sel_meter, '-30.0')
	assert.equal(getExtraVariableValues(self).sel_meterbar, '████░░░░')
	assert.equal(meterBar(-100), '░░░░░░░░')
	client.stop()
})
