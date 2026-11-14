// Run with: node --test test/lights.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { HueBridge, parseSsdpHue, hueState, toPct, toBri, toMired, toWarmCold } from '../src/hue.js'
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

test('Grid Connect sign-in: signature, channel key and body encryption', async () => {
	const crypto = await import('node:crypto')
	const { signParams, channelKey, bodyKey, sealBody, openBody, APP } = await import('../src/gridconnect.js')
	const signKey = `${APP.package}_${APP.cert}_${APP.hidden}_${APP.secret}`
	const h = crypto.createHash('md5').update('{"a":1}').digest('hex')
	const pre = `a=x.y||et=3||postData=${h.slice(8, 16) + h.slice(0, 8) + h.slice(24, 32) + h.slice(16, 24)}||time=100`
	assert.equal(
		signParams({ time: '100', a: 'x.y', et: '3', postData: '{"a":1}', sdkVersion: 'not signed', sid: '' }),
		crypto.createHmac('sha256', signKey).update(pre).digest('hex'),
		'only listed, non-empty fields, sorted, postData by its shuffled MD5',
	)
	assert.match(channelKey(), /^[0-9a-f]{8}$/)
	const k = bodyKey('req-1')
	assert.equal(k.length, 16)
	assert.notDeepEqual(bodyKey('req-1', 'E1'), k, 'after sign-in the session changes the key')
	assert.equal(openBody(k, sealBody(k, 'hello')), 'hello')
	const zipped = (await import('node:zlib')).gzipSync(Buffer.from('{"z":true}'))
	const c = crypto.createCipheriv('aes-128-gcm', k, Buffer.alloc(12, 1))
	const blob = Buffer.concat([Buffer.alloc(12, 1), c.update(zipped), c.final(), c.getAuthTag()]).toString('base64')
	assert.equal(openBody(k, blob), '{"z":true}', 'gzipped replies are unzipped')
	assert.throws(() => openBody(bodyKey('other'), sealBody(k, 'x')), 'a wrong key fails, not garbage')
})

/** A stand-in for Grid Connect's servers: checks what the module sends and answers like the real thing. */
function fakeGridConnect({ home = 'eu', password = 'pw' } = {}) {
	const { crypto, signParams, bodyKey, sealBody, openBody, wrap } = fakeGridConnect.deps
	const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 })
	const jwk = publicKey.export({ format: 'jwk' })
	const dec = (b64u) => BigInt(`0x${Buffer.from(b64u, 'base64url').toString('hex')}`).toString(10)
	const seen = []
	const fetchFn = async (url, opts) => {
		const p = Object.fromEntries(new URLSearchParams(opts.body))
		seen.push([url, p.a])
		const { sign, ...rest } = p
		assert.equal(sign, signParams(rest), `${p.a}: signed`)
		const ecode = p.sid ? 'EC9' : null
		const body = p.postData ? JSON.parse(openBody(bodyKey(p.requestId, ecode), p.postData)) : {}
		const answer = (result) => ({ ok: true, status: 200, json: async () => ({ success: true, result: sealBody(bodyKey(p.requestId, ecode), JSON.stringify(wrap ? { success: true, result } : result)) }) })
		const nope = (code) => ({ ok: true, status: 200, json: async () => ({ success: false, errorCode: code, errorMsg: 'no' }) })
		if (!url.includes('a1-home.example.com') && (!url.includes(home === 'eu' ? 'tuyaeu.com' : 'tuyaus.com') || url.includes('-weaz'))) return nope('USER_NOT_EXISTS')
		if (p.a === 'smartlife.m.user.email.token.create') return answer({ token: 'T1', publicKey: dec(jwk.n), exponent: dec(jwk.e) })
		if (p.a === 'smartlife.m.user.email.password.login') {
			assert.equal(body.passwd.length, 256, 'the key\'s full length (1024 bits) in hex')
			// no padding: the server gets back exactly the text, with zeros in front
			const sent = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_NO_PADDING }, Buffer.from(body.passwd, 'hex')).toString().replace(/^\0+/, '')
			if (sent !== crypto.createHash('md5').update(password).digest('hex')) return nope('USER_PASSWD_WRONG')
			assert.equal(body.token, 'T1')
			assert.equal(body.countryCode, '61')
			return answer({ sid: 'S1', ecode: 'EC9', uid: 'u', domain: { mobileApiUrl: 'https://a1-home.example.com', regionCode: 'AZ' } })
		}
		assert.equal(p.sid, 'S1', `${p.a}: sent with the session`)
		if (url !== 'https://a1-home.example.com/api.json') return nope('USER_SESSION_INVALID') // the session only works on the server the sign-in named
		if (p.a === 'm.life.home.space.list') return answer([{ gid: 42, name: 'Home' }])
		if (p.a === 'smartlife.m.my.group.device.list') {
			assert.equal(p.gid, '42')
			return answer([
				{ devId: 'bf0123456789abcdefgh', name: 'Lounge Lamp', localKey: 'a1b2c3d4e5f6a7b8', category: 'dj', isOnline: true, dps: { 20: true, 22: 500 } },
				{ devId: 'bfnokeyyyyyyyyyyyyyy', name: 'Hub', localKey: '' },
			])
		}
		throw new Error(`unexpected ${p.a}`)
	}
	return { fetchFn, seen }
}

test('Grid Connect sign-in: finds the right data centre, the password goes encrypted, devices fill the list', async () => {
	const crypto = await import('node:crypto')
	const gc = await import('../src/gridconnect.js')
	for (const wrap of [false, true]) {
		fakeGridConnect.deps = { crypto, ...gc, wrap }
		const { fetchFn, seen } = fakeGridConnect({ home: 'eu' })
		const cloud = await gc.signIn('me@example.com', 'pw', { fetchFn })
		assert.equal(cloud.region, 'eu', 'tried us first, then found the account on eu')
		assert.ok(seen[0][0].includes('tuyaus.com'))
		const devices = await cloud.devices()
		assert.deepEqual(devices.map((d) => [d.name, d.id, d.key, d.online]), [['Lounge Lamp', 'bf0123456789abcdefgh', 'a1b2c3d4e5f6a7b8', true]], 'a device with no local key (a hub) is left out')
		const text = gc.devicesText(devices, { bf0123456789abcdefgh: '192.168.1.40' })
		const [parsed] = parseTuyaDevices(text)
		assert.deepEqual([parsed.name, parsed.id, parsed.key, parsed.category, parsed.ip], ['Lounge Lamp', 'bf0123456789abcdefgh', 'a1b2c3d4e5f6a7b8', 'dj', '192.168.1.40'], 'the settings box reads it back, IP kept')
		assert.deepEqual(parsed.dps, { 20: true, 22: 500 })
	}
	fakeGridConnect.deps = { crypto, ...gc }
	const { fetchFn, seen } = fakeGridConnect({ home: 'us', password: 'right' })
	await assert.rejects(gc.signIn('me@example.com', 'wrong', { fetchFn }), (e) => !/wrong'/.test(e.message) && /us said "incorrect account or password"/.test(e.message), 'says so without echoing the password')
	assert.equal(seen.filter(([, a]) => a.endsWith('password.login')).length, 1, 'one wrong-password answer is enough: each try counts towards Grid Connect\'s lock-out')
})

test('Hue bridge found on the local network first (SSDP), the online finder only as a fallback', async () => {
	const answer = 'HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.20:80/description.xml\r\nhue-bridgeid: 001788FFFE123456\r\n\r\n'
	assert.deepEqual(parseSsdpHue(answer, '192.168.1.20'), { ip: '192.168.1.20', id: '001788fffe123456' })
	assert.equal(parseSsdpHue('HTTP/1.1 200 OK\r\nSERVER: a printer\r\n', '192.168.1.9'), null)
	let asked = 0
	const fetchFn = async () => {
		asked++
		return { ok: false, status: 429 }
	}
	assert.deepEqual(await HueBridge.discover({ fetchFn, local: async () => [{ ip: '192.168.1.20', id: 'x' }] }), [{ ip: '192.168.1.20', id: 'x' }])
	assert.equal(asked, 0, 'found locally: the online finder isn\'t asked')
	await assert.rejects(HueBridge.discover({ fetchFn, local: async () => [] }), /no bridge answered on the network, and Philips' bridge finder said 429/)
})


test('Grid Connect sign-in: a data centre that never answers doesn\'t hold up the one that has the account', async () => {
	const crypto = await import('node:crypto')
	const gc = await import('../src/gridconnect.js')
	fakeGridConnect.deps = { crypto, ...gc }
	const { fetchFn: real } = fakeGridConnect({ home: 'eu' })
	const keepAlive = setInterval(() => {}, 50) // the timeouts alone don't keep the test running
	const hang = (url, opts) =>
		url.includes('tuyacn.com') ? new Promise((_, no) => opts.signal.addEventListener('abort', () => no(opts.signal.reason))) : real(url, opts)
	try {
		const t = Date.now()
		assert.equal((await gc.signIn('me@example.com', 'pw', { fetchFn: hang, timeout: 5000 })).region, 'eu')
		assert.ok(Date.now() - t < 2000, 'answered without waiting for the silent one')
		const allHang = (url, opts) => new Promise((_, no) => opts.signal.addEventListener('abort', () => no(opts.signal.reason)))
		await assert.rejects(gc.signIn('me@example.com', 'pw', { fetchFn: allHang, timeout: 200 }), /us: .*no answer/)
	} finally {
		clearInterval(keepAlive)
	}
})

test('Grid Connect sign-in: one data centre at a time, and stops when Grid Connect says to wait', async () => {
	const gc = await import('../src/gridconnect.js')
	const asked = []
	const tooMany = async (url, opts) => {
		asked.push(new URLSearchParams(opts.body).get('a'))
		return { ok: true, status: 200, json: async () => ({ success: false, errorCode: 'USER_PASSWD_ERROR_TIMES_TOO_MANY_2', errorMsg: 'try again 15 minutes later' }) }
	}
	await assert.rejects(gc.signIn('me@example.com', 'pw', { fetchFn: tooMany }), (e) => e.lockout && /Wait 15 minutes/.test(e.message))
	assert.equal(asked.length, 1, 'no more tries after "wait"')
	assert.ok(gc.isLockout('REQUEST_TOO_FREQUENTLY_PLEASE_TRY_AGAIN_LATER'))
	assert.ok(!gc.isLockout('USER_PASSWD_WRONG'))
})

test('Magic Home: commands, state replies, colours, brightness and the device list', async () => {
	const mh = await import('../src/magichome.js')
	assert.deepEqual([...mh.POWER_ON], [0x71, 0x23, 0x0f, 0xa3], 'checksum on the end')
	assert.deepEqual([...mh.POWER_OFF], [0x71, 0x24, 0x0f, 0xa4])
	assert.deepEqual([...mh.QUERY], [0x81, 0x8a, 0x8b, 0x96])
	assert.deepEqual([...mh.colourCommand({ r: 255, g: 0, b: 0 })], [0x31, 0xff, 0, 0, 0, 0, 0x0f, 0x3f])
	assert.deepEqual(mh.parseState(Buffer.from([0x81, 0x25, 0x23, 0x61, 0, 0x10, 255, 128, 0, 0, 0x07, 0, 0, 0])), { on: true, r: 255, g: 128, b: 0, w: 0 })
	assert.equal(mh.parseState(Buffer.from([0x31, 1, 2])), null)
	assert.equal(mh.colourBrightness({ r: 128, g: 0, b: 0 }), 50)
	assert.deepEqual(mh.atBrightness({ r: 255, g: 128, b: 0, w: 0 }, 50), { r: 128, g: 64, b: 0, w: 0 }, 'same colour, half as bright')
	assert.deepEqual(mh.atBrightness({ r: 0, g: 0, b: 0, w: 0 }, 100), { r: 255, g: 255, b: 255, w: 0 }, 'black comes back as white')
	assert.deepEqual(mh.toRgb(0x00ff80), { r: 0, g: 255, b: 128, w: 0 })
	assert.deepEqual(mh.toRgb('#ff0000'), { r: 255, g: 0, b: 0, w: 0 })
	assert.deepEqual(mh.parseMagicDevices('# strips\nDesk strip, 192.168.1.50\n192.168.1.51\nnot one'), [{ name: 'Desk strip', ip: '192.168.1.50' }, { name: 'LED strip 51', ip: '192.168.1.51' }])
})

test('Magic Home controller: connected, read, switched, coloured, dimmed, and grey when it goes away', async () => {
	const net = await import('node:net')
	const mh = await import('../src/magichome.js')
	const got = []
	let state = { on: false, r: 0, g: 0, b: 255 }
	const socks = []
	const server = net.createServer((sock) => {
		socks.push(sock)
		sock.on('data', (chunk) => {
			// commands can arrive together: split them by their lengths
			for (let i = 0; i < chunk.length; ) {
				const len = chunk[i] === 0x31 ? 8 : 4
				const d = chunk.subarray(i, i + len)
				i += len
				got.push([...d])
				if (d[0] === 0x81) sock.write(Buffer.from([0x81, 0x25, state.on ? 0x23 : 0x24, 0x61, 0, 0x10, state.r, state.g, state.b, 0, 0x07, 0, 0, 0]))
				if (d[0] === 0x71) state.on = d[1] === 0x23
				if (d[0] === 0x31) Object.assign(state, { r: d[1], g: d[2], b: d[3] })
			}
		})
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const changes = []
	const d = new mh.MagicHomeDevice({ name: 'Desk', ip: '127.0.0.1' }, { port: server.address().port, pollMs: 50, onChange: (x) => changes.push(x.state) })
	try {
		await d.start()
		await new Promise((r) => setTimeout(r, 80))
		assert.deepEqual(d.state, { on: false, brightness: 100, warmCold: null, reachable: true }, 'read from the controller')
		await d.set({ colour: { r: 255, g: 0, b: 0, w: 0 } })
		await new Promise((r) => setTimeout(r, 30))
		assert.ok(got.some((g) => g[0] === 0x71 && g[1] === 0x23), 'a colour turns it on')
		assert.deepEqual(got.find((g) => g[0] === 0x31), [...mh.colourCommand({ r: 255, g: 0, b: 0 })])
		await d.set({ brightness: 50 })
		await new Promise((r) => setTimeout(r, 80))
		assert.deepEqual([state.r, state.g, state.b], [128, 0, 0], 'dimmed, same colour')
		assert.equal(d.state.brightness, 50)
		await d.set({ brightness: 0 })
		await new Promise((r) => setTimeout(r, 30))
		assert.equal(state.on, false, 'brightness 0 = off')
		for (const c of socks) c.destroy()
		server.close()
		d.sock?.destroy()
		await new Promise((r) => setTimeout(r, 150))
		assert.equal(d.state.reachable, false, 'gone: shown as not reachable')
	} finally {
		d.stop()
		for (const c of socks) c.destroy()
		server.close()
	}
})

test('Home page: a ready-to-import page built from the connection\'s own lights', async () => {
	const { buildHomePages } = await import('../src/page.js')
	const btn = (text, extra = {}) => ({ type: 'button', name: text, style: { text }, steps: [{ down: [{ actionId: 'power', options: { target: text } }], up: [] }], feedbacks: [{ feedbackId: 'is_on', options: { target: text }, style: { bgcolor: 1 } }], ...extra })
	const targets = []
	const presets = { all_off: btn('ALL OFF'), view_clock_lights: { ...btn('CLOCK'), steps: [{ down: [], up: [] }], feedbacks: [] } }
	for (let i = 0; i < 14; i++) {
		const slug = `hue_l${i}`
		targets.push({ id: `hue:light:${i}`, kind: 'light', slug })
		presets[`t_${slug}`] = { ...btn(`L${i}`), steps: [{ down: [], up: [{ actionId: 'power', options: { target: `hue:light:${i}`, mode: 'toggle' } }], 600: { options: { runWhileHeld: true }, actions: [{ actionId: 'brightness_set', options: { target: `hue:light:${i}`, value: 100 } }] } }] }
		presets[`k_${slug}`] = btn(`K${i}`, { options: { rotaryActions: true }, steps: [{ down: [], up: [], rotate_left: [{ actionId: 'brightness_step', options: {} }], rotate_right: [{ actionId: 'brightness_step', options: {} }] }] })
		presets[`k_${slug}__push`] = btn(`P${i}`)
	}
	const file = buildHomePages({ targets, presets, connection: { id: 'abc123', label: 'Smart_Lights' } })
	assert.deepEqual(Object.values(file.pages).map((p) => p.name), ['Home', 'Home 2'], '14 lights: 12 on the first page, the rest on a second')
	const home = file.pages[1].controls
	assert.equal(home[0][0].style.text, 'L0')
	assert.equal(home[2][1].style.text, 'L11')
	assert.equal(home[2][2].style.text, 'ALL OFF')
	assert.equal(home[2][3].style.text, 'CLOCK', 'wide key')
	assert.equal(home[3][1].style.text, 'K0', 'knob 1 turn')
	assert.equal(home[3][1].options.rotaryActions, true)
	assert.equal(home[4][1].style.text, 'P0', 'knob 1 push')
	assert.equal(home[3][0], undefined, 'the hardware page buttons are left alone')
	const tap = home[0][0].steps[0]
	assert.equal(tap.action_sets.up[0].definitionId, 'power')
	assert.equal(tap.action_sets[600][0].definitionId, 'brightness_set', 'hold = 100% kept')
	assert.deepEqual(tap.options.runWhileHeld, [600])
	assert.equal(tap.action_sets.up[0].connectionId, 'abc123')
	assert.deepEqual(file.instances.abc123, { label: 'Smart_Lights', moduleId: 'smart-lights', lastUpgradeIndex: -1, sortOrder: 0 })
	assert.equal(file.instances['system-tools'].moduleId, 'system-tools')
	const fbs = home[0][0].feedbacks
	assert.deepEqual([fbs[0].definitionId, fbs[0].connectionId], ['key_style', 'system-tools'], 'linked to the Key Styler, first so the lit colour still wins')
	assert.deepEqual([fbs[1].definitionId, fbs[1].connectionId], ['is_on', 'abc123'])
	assert.equal(file.pages[2].controls[0][1].style.text, 'L13')
	assert.equal(file.pages[2].controls[3][1].style.text, 'K12', 'page 2 knobs = its own lights')
	const empty = buildHomePages({ targets: [], presets: { all_off: btn('ALL OFF') }, connection: { id: 'x', label: 'y' } })
	assert.equal(empty.pages[1].controls[2][2].style.text, 'ALL OFF', 'no lights yet: still a page')
})
