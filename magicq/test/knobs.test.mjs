// Run with: node --test test/knobs.test.mjs (after installing dependencies; no build step)
// Part 1 drives the knob layer against a fake module instance. Part 2 runs the real module
// against a fake MagicQ on 127.0.0.1 (UDP, OSC encoded with the module's own osc library).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import osc from 'osc'
import MagicQInstance, { firstNumber, RESUBSCRIBE_MS } from '../src/main.js'
import {
	PERCENT_STEPS,
	stepLevelPercent,
	stepPercent,
	getKnobActions,
	getKnobFeedbacks,
	getKnobVariableValues,
	getKnobVariableDefinitions,
	getKnobPresets,
	selection,
} from '../src/knobs.js'

// ---------- part 1: knob layer with a fake instance ----------

function fakeSelf(levels = {}) {
	const playbacks = {}
	for (const [n, v] of Object.entries(levels)) playbacks[n] = { value: v, flash: 0 }
	const sent = []
	const self = {
		label: 'mq',
		isConsoleOnline: true,
		dbo: 0,
		swapMode: 0,
		sent,
		playbacks,
		sendOSC: (address, arg) => sent.push([address, arg?.value]),
		playbackLevel: (n) => playbacks[n]?.value ?? 0,
		playbackFlash: (n) => playbacks[n]?.flash ?? 0,
		// like main.js: sending also updates the local level straight away
		setPlaybackLevel: (n, v) => {
			sent.push(['/pb/' + n, v])
			playbacks[n] = { flash: 0, ...playbacks[n], value: v }
		},
		setPlaybackFlash: (n, v) => {
			playbacks[n] = { value: 0, ...playbacks[n], flash: v }
		},
		connectionText: () => 'connected',
		refreshKnobValues: () => {},
	}
	return self
}
const run = (actions, id, options = {}) => actions[id].callback({ options })

test('step sizes map to 1,2,3,4,5,6,8,10,15,20 % and clamp at 0-100', () => {
	assert.deepEqual(PERCENT_STEPS, [1, 2, 3, 4, 5, 6, 8, 10, 15, 20])
	assert.equal(stepPercent({ direction: 'up', size: 7 }), 8)
	assert.equal(stepPercent({ direction: 'down', size: 10 }), -20)
	assert.equal(stepPercent({ direction: 'up' }), 2, 'default is size 2 = 2 %')
	assert.equal(stepPercent({ direction: 'up', size: 'nonsense' }), 2)
	assert.equal(stepLevelPercent(95, 20), 100)
	assert.equal(stepLevelPercent(3, -15), 0)
	assert.equal(stepLevelPercent(undefined, 5), 5)
})

test('fast turn: every click counts, from the level we just sent', () => {
	const self = fakeSelf({ 1: 50 })
	const a = getKnobActions(self)
	for (let i = 0; i < 20; i++) run(a, 'knob_pb_step', { pb: 1, direction: 'down', size: 2 })
	assert.equal(self.playbackLevel(1), 10)
	assert.equal(self.sent.length, 20)
	for (let i = 0; i < 10; i++) run(a, 'knob_pb_step', { pb: 1, direction: 'up', size: 10 })
	assert.equal(self.playbackLevel(1), 100, 'clamped at full')
	assert.deepEqual(self.sent.at(-1), ['/pb/1', 100])
})

test('any playback number works, not just 1-10', () => {
	const self = fakeSelf()
	const a = getKnobActions(self)
	run(a, 'knob_pb_step', { pb: 25, direction: 'up', size: 5 })
	run(a, 'knob_pb_step', { pb: 25, direction: 'up', size: 5 })
	assert.deepEqual(self.sent, [
		['/pb/25', 5],
		['/pb/25', 10],
	])
	run(a, 'knob_pb_step', { pb: 0, direction: 'up' })
	assert.equal(self.sent.length, 2, 'playback 0 is ignored')
})

test('selected playback: choose, wrap, and Go / Pause / Release / Flash act on it', () => {
	const self = fakeSelf({ 3: 40 })
	const a = getKnobActions(self)
	run(a, 'sel_select', { pb: 9 })
	run(a, 'sel_next', { direction: 'up', max: 10 })
	assert.equal(selection(self).pb, 10)
	run(a, 'sel_next', { direction: 'up', max: 10 })
	assert.equal(selection(self).pb, 1, 'wraps at the top')
	run(a, 'sel_next', { direction: 'down', max: 10 })
	assert.equal(selection(self).pb, 10, 'wraps at the bottom')
	run(a, 'sel_select', { pb: 3 })
	run(a, 'sel_fader_step', { direction: 'up', size: 3 })
	assert.equal(self.playbackLevel(3), 43)
	run(a, 'sel_go')
	run(a, 'sel_pause')
	run(a, 'sel_release')
	run(a, 'sel_flash', { mode: 'on' })
	run(a, 'sel_flash', { mode: 'off' })
	run(a, 'sel_flash', { mode: 'toggle' })
	assert.deepEqual(self.sent.slice(1), [
		['/pb/3/go', undefined],
		['/pb/3/pause', undefined],
		['/pb/3/release', undefined],
		['/pb/3/flash', 1],
		['/pb/3/flash', 0],
		['/pb/3/flash', 1],
	])
	const vals = getKnobVariableValues(self)
	assert.equal(vals.sel_pb, '3')
	assert.equal(vals.sel_level, '43')
	assert.equal(vals.sel_flash, 'on')
	assert.equal(vals.pb_3_level, '43')
	assert.equal(vals.pb_1_level, '0')
})

test('feedbacks: above level, at full, selected, flash, DBO, swap', () => {
	const self = fakeSelf({ 2: 60, 4: 100 })
	const a = getKnobActions(self)
	const f = getKnobFeedbacks(self)
	const fb = (id, options = {}) => f[id].callback({ options })
	assert.equal(fb('pb_above', { pb: 2, level: 0 }), true)
	assert.equal(fb('pb_above', { pb: 2, level: 60 }), false)
	assert.equal(fb('pb_above', { pb: 1, level: 0 }), false)
	assert.equal(fb('pb_full', { pb: 4 }), true)
	assert.equal(fb('pb_full', { pb: 2 }), false)
	run(a, 'sel_select', { pb: 2 })
	assert.equal(fb('sel_is', { pb: 2 }), true)
	assert.equal(fb('sel_is', { pb: 4 }), false)
	assert.equal(fb('sel_above', { level: 50 }), true)
	run(a, 'dbo_toggle', { mode: 'toggle' })
	assert.equal(fb('dbo_on'), true)
	run(a, 'dbo_toggle', { mode: 'toggle' })
	assert.equal(fb('dbo_on'), false)
	run(a, 'swap_toggle', { mode: 'toggle' })
	assert.equal(fb('swap_on'), true)
	assert.equal(fb('console_online'), true)
})

test('variables and presets hang together', () => {
	const self = fakeSelf()
	const defs = getKnobVariableDefinitions()
	assert.ok(
		defs.pb_1_level && defs.pb_10_level && !defs.pb_11_level && defs.sel_pb && defs.sel_level && defs.connection,
	)
	const actions = getKnobActions(self)
	const feedbacks = getKnobFeedbacks(self)
	const { structure, presets } = getKnobPresets(self)
	assert.equal(presets.sel_fader_knob.steps[0].rotate_right[0].actionId, 'sel_fader_step')
	assert.equal(presets.sel_fader_knob.steps[0].down[0].actionId, 'sel_go')
	assert.equal(presets.sel_flash.steps[0].up[0].options.mode, 'off', 'flash is momentary')
	assert.match(presets.pb_7_select.style.text, /\$\(mq:pb_7_level\)/)
	for (const section of structure) for (const id of section.definitions) assert.ok(presets[id], `preset ${id} exists`)
	for (const p of Object.values(presets)) {
		for (const list of Object.values(p.steps[0]))
			for (const step of list) assert.ok(actions[step.actionId] || step.actionId === 'pbGo', step.actionId)
		for (const f of p.feedbacks) assert.ok(feedbacks[f.feedbackId], f.feedbackId)
	}
})

test('OSC argument parsing never throws on odd packets', () => {
	assert.equal(firstNumber([0.5]), 0.5)
	assert.equal(firstNumber([{ type: 'f', value: 0.25 }]), 0.25)
	assert.equal(firstNumber(0.75), 0.75)
	assert.equal(firstNumber([]), undefined)
	assert.equal(firstNumber(['abc']), undefined)
	assert.equal(firstNumber(undefined), undefined)
})

// ---------- part 2: the real module against a fake MagicQ ----------

function fakeContext(label = 'mq') {
	const calls = []
	const ctx = new Proxy(
		{ id: 'test', _isInstanceContext: true, label },
		{ get: (t, k) => (k in t ? t[k] : (...args) => calls.push([k, ...args])) },
	)
	return { ctx, calls }
}

async function freePort() {
	const s = dgram.createSocket('udp4')
	await new Promise((r) => s.bind(0, '127.0.0.1', r))
	const port = s.address().port
	await new Promise((r) => s.close(r))
	return port
}

/** A fake MagicQ: records what Companion sends, and can send feedback back to it. */
async function fakeMagicQ() {
	const received = []
	const port = new osc.UDPPort({ localAddress: '127.0.0.1', localPort: 0 })
	port.on('message', (m) => received.push([m.address, m.args[0]]))
	await new Promise((r) => {
		port.on('ready', r)
		port.open()
	})
	return {
		received,
		port: port.socket.address().port,
		send: (address, args, to) => port.send({ address, args }, '127.0.0.1', to),
		sendRaw: (buf, to) => port.socket.send(buf, to, '127.0.0.1'),
		close: () => port.close(),
	}
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 2000) {
	const end = Date.now() + ms
	while (!fn()) {
		if (Date.now() > end) throw new Error('timed out')
		await wait(10)
	}
}
const lastStatus = (calls) => calls.filter((c) => c[0] === 'updateStatus').at(-1)?.[1]

test('real module: subscribes, reads /pb levels, heartbeat goes Disconnected and back', async () => {
	const desk = await fakeMagicQ()
	const rxPort = await freePort()
	const { ctx, calls } = fakeContext()
	const mq = new MagicQInstance(ctx)
	try {
		await mq.init({
			host: '127.0.0.1',
			port: String(desk.port),
			enableFeedback: true,
			rxPort: String(rxPort),
			silenceTimeout: 30,
		})
		await until(() => desk.received.some((m) => m[0] === '/feedback/pb+exec'))
		assert.equal(lastStatus(calls), 'connecting', 'waits for MagicQ before going green')
		assert.equal(mq.connectionText(), 'waiting')

		desk.send('/pb/3', [{ type: 'f', value: 0.5 }], rxPort)
		await until(() => mq.playbackLevel(3) === 50)
		assert.equal(lastStatus(calls), 'ok')
		assert.equal(mq.isConsoleOnline, true)

		// out of range, junk and undecodable packets are ignored and don't change the status
		desk.send('/pb/42', [{ type: 'f', value: 1 }], rxPort)
		desk.send('/pb/4', [{ type: 's', value: 'abc' }], rxPort)
		desk.sendRaw(Buffer.from('not osc at all'), rxPort)
		desk.send('/pb/2/flash', [{ type: 'i', value: 1 }], rxPort)
		await until(() => mq.playbackFlash(2) === 1)
		assert.equal(mq.playbackLevel(4), 0)
		assert.equal(lastStatus(calls), 'ok')

		// fast knob turn: local target wins over a late report from the desk
		const a = getKnobActions(mq)
		for (let i = 0; i < 5; i++) a.knob_pb_step.callback({ options: { pb: 3, direction: 'up', size: 5 } })
		assert.equal(mq.playbackLevel(3), 75)
		desk.send('/pb/3', [{ type: 'f', value: 0.55 }], rxPort) // stale echo
		await wait(100)
		assert.equal(mq.playbackLevel(3), 75, 'echo guard keeps the target')
		await until(() => desk.received.filter((m) => m[0] === '/pb/3').length === 5)
		assert.deepEqual(
			desk.received.filter((m) => m[0] === '/pb/3').map((m) => m[1]),
			[55, 60, 65, 70, 75],
		)

		// silence: re-subscribe, then Disconnected after the timeout
		const subs = () => desk.received.filter((m) => m[0] === '/feedback/pb+exec').length
		const before = subs()
		const t0 = mq.lastSeen
		mq.heartbeatTick(t0 + RESUBSCRIBE_MS + 1)
		await until(() => subs() === before + 1)
		assert.equal(lastStatus(calls), 'ok', 'still ok within the timeout')
		mq.heartbeatTick(t0 + 31000)
		assert.equal(lastStatus(calls), 'disconnected')
		assert.equal(mq.connectionText(), 'disconnected')
		await until(() => subs() === before + 2) // that tick re-subscribed too

		// MagicQ comes back: Ok again, and the feedback subscription is re-sent at once
		const beforeBack = subs()
		desk.send('/pb/1', [{ type: 'f', value: 1 }], rxPort)
		await until(() => lastStatus(calls) === 'ok')
		await until(() => subs() === beforeBack + 1)
		assert.equal(mq.playbackLevel(1), 100)

		// timeout 0 = never mark Disconnected
		mq.config.silenceTimeout = 0
		mq.heartbeatTick(mq.lastSeen + 600000)
		assert.equal(lastStatus(calls), 'ok')
	} finally {
		await mq.destroy()
		desk.close()
	}
	assert.equal(mq.osc, null, 'sockets closed on destroy')
	assert.equal(mq.heartbeatTimer, undefined, 'heartbeat stopped on destroy')
})

test('real module: config screen builds (Regex import) and feedback off is send-only', async () => {
	const desk = await fakeMagicQ()
	const { ctx, calls } = fakeContext()
	const mq = new MagicQInstance(ctx)
	try {
		const fields = mq.getConfigFields()
		assert.ok(fields.find((f) => f.id === 'host').regex.startsWith('/^'))
		assert.ok(fields.find((f) => f.id === 'silenceTimeout'))
		await mq.init({ host: '127.0.0.1', port: String(desk.port), enableFeedback: false })
		await until(() => lastStatus(calls) === 'ok')
		assert.equal(mq.connectionText(), 'send only')
		getKnobActions(mq).sel_flash.callback({ options: { mode: 'on' } })
		await until(() => desk.received.length === 1)
		assert.deepEqual(desk.received[0], ['/pb/1/flash', 1])
		assert.equal(
			desk.received.some((m) => m[0] === '/feedback/pb+exec'),
			false,
		)
		const varDefs = calls.filter((c) => c[0] === 'setVariableDefinitions').at(-1)[1]
		assert.ok(varDefs.sel_level && !varDefs.pb1, 'knob variables only, when feedback is off')
		const fbDefs = calls.filter((c) => c[0] === 'setFeedbackDefinitions').at(-1)[1]
		assert.ok(fbDefs.pb_above && !fbDefs.pb)
	} finally {
		await mq.destroy()
		desk.close()
	}
})

test('every knob preset also gets − / + buttons and a push key (Stream Deck without dials, D200X row 4)', async () => {
	const { withSurfaceExtras, withSurfaceExtrasV2 } = await import('../src/surface-extras.js')
	const knob = {
		type: 'button',
		category: 'Knobs',
		name: 'Fader knob',
		options: { rotaryActions: true },
		style: { text: 'IN 1\\n$(x:level)', size: '14' },
		steps: [{ down: [{ actionId: 'mute' }], up: [], rotate_left: [{ actionId: 'down' }], rotate_right: [{ actionId: 'up' }] }],
		feedbacks: [{ feedbackId: 'muted' }],
	}
	const plain = { type: 'button', category: 'Keys', name: 'Go', style: { text: 'GO' }, steps: [{ down: [{ actionId: 'go' }], up: [] }], feedbacks: [] }
	const out = withSurfaceExtras({ k: knob, g: plain })
	assert.deepEqual(Object.keys(out).sort(), ['g', 'k', 'k__minus', 'k__plus', 'k__push'])
	assert.deepEqual(out.k, knob, 'the knob itself is unchanged (D200X turn, Stream Deck+ dial)')
	assert.deepEqual(out.k__minus.steps, [{ down: [{ actionId: 'down' }], up: [] }])
	assert.deepEqual(out.k__plus.steps, [{ down: [{ actionId: 'up' }], up: [] }])
	assert.deepEqual(out.k__push.steps, [{ down: [{ actionId: 'mute' }], up: [] }])
	assert.equal(out.k__plus.options.rotaryActions, undefined, 'plain keys, no rotary')
	assert.equal(out.k__minus.style.text, '− IN 1')
	assert.equal(out.k__minus.category, 'Knobs: − / + buttons and push keys')
	assert.deepEqual(out.k__plus.feedbacks, knob.feedbacks)
	const v2 = withSurfaceExtrasV2([{ id: 's', name: 'Strip', definitions: ['k', 'g'] }], { k: { ...knob, category: undefined }, g: plain })
	assert.deepEqual(v2.structure.map((x) => [x.id, x.definitions]), [
		['s', ['k', 'g']],
		['s_buttons', ['k__minus', 'k__plus', 'k__push']],
	])
})
