// Run with: node --test test/echo.test.mjs
// A fake Echo360 capture device on localhost: a small state machine serving the XML shapes quoted in
// the Capture API guide (via tonyallan/echo360) and the Navitas Crestron driver, with Basic auth and
// <error> replies for commands that make no sense in the current state.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import { EchoClient, parseXml, xmlGet, xmlText, xmlAll, xmlIsEmpty, encodeForm, parseDeviceTime } from '../src/echo-client.js'
import {
	getActions,
	getFeedbacks,
	getVariableValues,
	getVariableDefinitions,
	getPresets,
	startAdHoc,
	resume,
	pause,
	stop,
	extend,
	togglePause,
	startScheduledNow,
	hms,
	untilText,
	ucKey,
	UC_CATEGORY,
} from '../src/controls.js'
import { UCKeys, osascriptArgs, powershellArgs, WINDOWS_SCRIPT } from '../src/uc-keys.js'

const USER = 'instructor'
const PASS = 'p@ss:word'
const PROFILES = ['UWS Audio Only', 'UWS Display and Audio', 'UWS Display and Audio HD']

// ---------- fake device ----------

function makeDevice({ tls } = {}) {
	const dev = {
		state: 'inactive',
		start: undefined, // device ms
		duration: undefined, // s
		title: '',
		skewMs: 0, // device clock minus real clock
		emptyCurrent: 'self-closing', // or 'navitas'
		next: undefined, // { title, start (device ms), duration }
		hang: new Set(), // paths that never answer
		requests: [],
		port: 0,
	}
	const now = () => Date.now() + dev.skewMs
	const iso = (ms) => new Date(ms).toISOString()
	const ok = (text) => `<ok text="${text}" />`
	const err = (cmd, why) => `<error text="Failed on command (${cmd}).  ${why}" />`
	const capXml = (c, state) =>
		`<schedule><type>${c.type ?? 'adhoc'}</type><start-time>${iso(c.start)}</start-time><duration>${c.duration}</duration>` +
		`<parameters><title>${esc(c.title)}</title><section>Sound Design 101</section>` +
		`<presenters><presenter>Jo Citizen</presenter><presenter>Sam Lee</presenter></presenters>` +
		`<capture-profile><name>${esc(c.profile ?? PROFILES[1])}</name></capture-profile></parameters></schedule>` +
		(state ? `<state>${state}</state><start-time>${iso(c.start)}</start-time><duration>${c.duration}</duration>` : '')

	const routes = {
		'GET /status/system': () =>
			`<?xml version="1.0" encoding="UTF-8"?>\n<status>\n  <wall-clock-time>${iso(now())}</wall-clock-time>\n` +
			`  <api-versions><api-version>3.0</api-version></api-versions>\n` +
			`  <max-capture-duration-minutes>240</max-capture-duration-minutes>\n` +
			`  <max-live-capture-extend-duration-minutes>240</max-live-capture-extend-duration-minutes>\n` +
			`  <capture-profiles>${PROFILES.map((p) => `<capture-profile>${p}</capture-profile>`).join('')}</capture-profiles>\n` +
			`  <monitor-profiles><monitor-profile>UWS Display and Audio HD</monitor-profile></monitor-profiles>\n` +
			`  <host-address>echo0019e5</host-address><serial-number>00-1c-08-00-19-e5</serial-number>\n` +
			`  <system-version>5.5.559796374</system-version><content><state>idle</state><archive-space-usage /></content>\n` +
			`  <location>Hawkesbury: G6</location><utc-offset>600</utc-offset>\n</status>`,
		'GET /status/monitoring': () =>
			`<status><state>${dev.state}</state>` +
			(dev.state === 'inactive' ? '' : `<start-time>${iso(dev.start)}</start-time><duration>${dev.duration}</duration><original-duration>3600</original-duration>`) +
			`<confidence-monitoring>false</confidence-monitoring></status>`,
		'GET /status/captures': () => {
			const empty = dev.emptyCurrent === 'navitas' ? '<current>\n  <schedule></schedule>\n</current>' : '<current/>'
			const current = dev.state === 'inactive' ? empty : `<current>${capXml({ start: dev.start, duration: dev.duration, title: dev.title }, dev.state)}</current>`
			const next = dev.next ? `<next>${capXml({ ...dev.next, type: 'scheduled' })}</next>` : '<next/>'
			return `<status><wall-clock-time>${iso(now())}</wall-clock-time>${current}${next}</status>`
		},
		'POST /capture/new_capture': (form) => {
			if (!['inactive', 'complete'].includes(dev.state)) return err('new_capture', 'A capture is already running.')
			if (!form.duration || !form.capture_profile_name || form.description === undefined) return err('new_capture', 'Missing parameter.')
			Object.assign(dev, { state: 'waiting', start: now(), duration: Number(form.duration), title: form.description })
			return ok('Capture scheduled for start')
		},
		'POST /capture/confidence_monitor': (form) => routes['POST /capture/new_capture'](form),
		'POST /capture/pause': () => (dev.state === 'active' ? ((dev.state = 'paused'), ok('Command (pause) submitted')) : err('pause', 'No capture is recording.')),
		'POST /capture/record': () =>
			['paused', 'waiting'].includes(dev.state) ? ((dev.state = 'active'), ok('Command (record) submitted')) : err('record', 'No capture to record.'),
		'POST /capture/stop': () =>
			['active', 'paused'].includes(dev.state) ? ((dev.state = 'complete'), ok('Command (stop) submitted')) : err('stop', 'No capture is running.'),
		'POST /capture/extend': (form) => {
			if (!['active', 'paused'].includes(dev.state)) return err('extend', 'No capture is running.')
			dev.duration += Number(form.duration)
			return ok(`Extend by ${form.duration} seconds recieved`)
		},
	}

	const handler = (req, res) => {
		const chunks = []
		req.on('data', (d) => chunks.push(d))
		req.on('end', () => {
			const body = Buffer.concat(chunks).toString()
			dev.requests.push({ method: req.method, path: req.url, body, type: req.headers['content-type'] })
			const expected = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')
			if (req.headers.authorization !== expected) {
				res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Echo360"' })
				return res.end('Unauthorized')
			}
			if (dev.hang.has(req.url)) return // never answer
			const route = routes[`${req.method} ${req.url}`]
			if (!route) {
				res.writeHead(404)
				return res.end()
			}
			const form = Object.fromEntries(new URLSearchParams(body))
			res.writeHead(200, { 'Content-Type': 'text/xml' })
			res.end(route(form))
		})
	}
	dev.server = tls ? https.createServer(tls, handler) : http.createServer(handler)
	dev.listen = (port = 0) => new Promise((r) => dev.server.listen(port, '127.0.0.1', () => r((dev.port = dev.server.address().port))))
	dev.close = () =>
		new Promise((r) => {
			dev.server.closeAllConnections?.()
			dev.server.close(() => r())
		})
	dev.posts = (path) => dev.requests.filter((q) => q.method === 'POST' && (!path || q.path === path))
	devices.push(dev)
	return dev
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')

// ---------- client + fake Companion instance ----------

const devices = []
const clients = []
const TIMING = { requestTimeoutMs: 300, capturesEveryMs: 100, systemEveryMs: 2000, backoffMs: 100, minPollMs: 20 }

function makeClient(dev, extra = {}) {
	const client = new EchoClient(TIMING)
	client.logs = []
	client.on('log', (level, msg) => client.logs.push([level, msg]))
	client.configure({ host: '127.0.0.1', protocol: dev.server instanceof https.Server ? 'https' : 'http', port: dev.port, username: USER, password: PASS, pollMs: 50, ...extra })
	clients.push(client)
	return client
}

function makeSelf(client, config = {}) {
	return {
		client,
		label: 'echo',
		config: { profile: '', minutes: 60, title: 'Lecture $(room) & stuff', room: 'G6', ...config },
		parseVariablesInString: async (s) => s.replace('$(room)', 'A&B = C'),
		blinkOn: true,
	}
}

async function waitFor(fn, ms = 3000, what = 'condition') {
	const end = Date.now() + ms
	while (Date.now() < end) {
		if (await fn()) return
		await new Promise((r) => setTimeout(r, 10))
	}
	assert.fail(`Timed out waiting for ${what}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connected(dev, extra) {
	await dev.listen()
	const client = makeClient(dev, extra)
	client.start()
	await waitFor(() => client.connected && client.state && client.system, 3000, 'connect')
	return client
}

afterEach(async () => {
	for (const c of clients.splice(0)) c.stop()
	for (const d of devices.splice(0)) await d.close()
})

// ---------- XML ----------

test('XML reader: declaration, attributes, entities, lists, self-closing and empty elements', () => {
	const x = parseXml(
		`<?xml version="1.0" encoding="UTF-8"?>\n<!-- c --><status a="1" b='two &amp; three'>\n` +
			`<capture-profiles><capture-profile>Audio &amp; Video</capture-profile><capture-profile>Display/Video (Podcast). Optimised</capture-profile></capture-profiles>` +
			`<current/><next>\n  <schedule></schedule>\n</next><archive-space-usage /><t><![CDATA[x<y]]></t></status>`,
	)
	assert.equal(x.name, 'status')
	assert.deepEqual(x.attrs, { a: '1', b: 'two & three' })
	assert.deepEqual(
		xmlAll(x, 'capture-profiles/capture-profile').map((n) => xmlText(n)),
		['Audio & Video', 'Display/Video (Podcast). Optimised'],
	)
	assert.ok(xmlIsEmpty(xmlGet(x, 'current')))
	assert.ok(xmlIsEmpty(xmlGet(x, 'next')), 'Navitas-style <next><schedule></schedule></next> counts as empty')
	assert.equal(xmlText(x, 't'), 'x<y')
	assert.equal(xmlText(x, 'missing/path'), '')

	const ok = parseXml('<ok text="Extend by 300 seconds recieved" />')
	assert.equal(ok.name, 'ok')
	assert.equal(ok.attrs.text, 'Extend by 300 seconds recieved')

	assert.throws(() => parseXml('<status><state>active</status>'))
	assert.throws(() => parseXml('<status>'))
	assert.throws(() => parseXml(''))
})

test('form encoding encodes values only; device times are GMT', () => {
	assert.equal(encodeForm({ duration: 300, extend: 'Submit Query' }), 'duration=300&extend=Submit+Query')
	assert.equal(encodeForm({ description: 'A&B = C/100%' }), 'description=A%26B+%3D+C%2F100%25')
	assert.equal(parseDeviceTime('2014-06-11T02:50:56.749Z'), Date.UTC(2014, 5, 11, 2, 50, 56, 749))
	assert.equal(parseDeviceTime('2014-06-11T02:50:56'), Date.UTC(2014, 5, 11, 2, 50, 56))
	assert.equal(parseDeviceTime(''), undefined)
	assert.equal(hms(3725), '01:02:05')
	assert.equal(untilText(65 * 60), '1h 05m')
	assert.equal(untilText(0), 'now')
})

// ---------- connection ----------

test('reads system info and profiles on connect, and sends Basic auth', async () => {
	const dev = makeDevice()
	const client = await connected(dev)
	assert.deepEqual(client.system.profiles, PROFILES)
	assert.equal(client.system.serial, '00-1c-08-00-19-e5')
	assert.equal(client.system.apiVersion, '3.0')
	assert.equal(client.system.name, 'echo0019e5')
	assert.equal(client.status, 'ok')
	assert.equal(dev.requests[0].path, '/status/system', 'system is read first on connect')
	const v = getVariableValues(makeSelf(client))
	assert.equal(v.state_label, 'IDLE')
	assert.equal(v.location, 'Hawkesbury: G6')
	assert.equal(v.room, 'G6')
})

test('wrong password gives bad config (401)', async () => {
	const dev = makeDevice()
	await dev.listen()
	const client = makeClient(dev, { password: 'nope' })
	const statuses = []
	client.on('status', (s) => statuses.push(s))
	client.start()
	await waitFor(() => client.status === 'bad_config', 2000, 'bad_config')
	assert.equal(client.connected, false)
	assert.ok(!statuses.includes('ok'))
	assert.equal(getVariableValues(makeSelf(client)).state_label, 'OFFLINE')
})

test('missing host gives bad config without sending anything', () => {
	const client = new EchoClient(TIMING)
	clients.push(client)
	client.configure({ host: '', protocol: 'http', port: 1 })
	client.start()
	assert.equal(client.status, 'bad_config')
})

test('empty <current/> (both shapes) shows idle with no title', async () => {
	for (const shape of ['self-closing', 'navitas']) {
		const dev = makeDevice()
		dev.emptyCurrent = shape
		const client = await connected(dev)
		await waitFor(() => client.capturesAt, 2000, 'captures read')
		const v = getVariableValues(makeSelf(client))
		assert.equal(v.state, 'inactive')
		assert.equal(v.state_label, 'IDLE')
		assert.equal(v.title, '')
		assert.equal(v.elapsed, '')
		assert.equal(v.next_in, 'none')
		const fb = getFeedbacks(makeSelf(client))
		assert.equal(fb.idle.callback({ options: {} }), true)
		assert.equal(fb.recording.callback({ options: {} }), false)
		client.stop()
		await dev.close()
	}
})

test('poller recovers after the device restarts', async () => {
	const dev = makeDevice()
	const client = await connected(dev)
	const port = dev.port
	await dev.close()
	await waitFor(() => client.status === 'connection_failure', 3000, 'connection_failure')
	assert.equal(client.connected, false)
	assert.equal(getVariableValues(makeSelf(client)).state_label, 'OFFLINE')
	assert.equal(getFeedbacks(makeSelf(client)).disconnected.callback({ options: {} }), true)

	const again = makeDevice()
	again.state = 'active'
	again.start = Date.now() - 60_000
	again.duration = 3600
	await again.listen(port)
	await waitFor(() => client.status === 'ok' && client.state === 'active', 3000, 'reconnect')
	assert.ok(client.system, 'system re-read after reconnect')
})

// ---------- commands ----------

test('start sends exactly one new_capture with a correctly encoded form body', async () => {
	const dev = makeDevice()
	const client = await connected(dev)
	const self = makeSelf(client)
	const r = await startAdHoc(self, {})
	assert.equal(r.sent, true)
	assert.equal(r.ok, true)
	assert.equal(client.lastMessage, 'Capture scheduled for start')
	const posts = dev.posts()
	assert.equal(posts.length, 1)
	assert.equal(posts[0].path, '/capture/new_capture')
	assert.equal(posts[0].type, 'application/x-www-form-urlencoded')
	assert.equal(posts[0].body, 'duration=3600&capture_profile_name=UWS+Audio+Only&description=Lecture+A%26B+%3D+C+%26+stuff')

	// Second press straight away: debounced. After the debounce: refused because it's capturing.
	assert.equal((await startAdHoc(self, {})).reason, 'debounced')
	self.lastPress.clear()
	await waitFor(() => client.state === 'waiting', 2000, 'waiting')
	assert.equal((await startAdHoc(self, {})).reason, 'state')
	assert.equal(dev.posts('/capture/new_capture').length, 1)

	// The title is never logged.
	assert.ok(!client.logs.some(([, m]) => m.includes('Lecture')))
})

test('start uses action options, caps length, and test mode uses confidence_monitor', async () => {
	const dev = makeDevice()
	const client = await connected(dev)
	const self = makeSelf(client, { profile: PROFILES[2] })
	await startAdHoc(self, { title: 'Check', minutes: 999, profile: '', test: true })
	const [p] = dev.posts()
	assert.equal(p.path, '/capture/confidence_monitor')
	assert.equal(p.body, `duration=${240 * 60}&capture_profile_name=UWS+Display+and+Audio+HD&description=Check`)
})

test('resume while a scheduled capture is waiting sends nothing', async () => {
	const dev = makeDevice()
	dev.state = 'waiting'
	dev.start = Date.now()
	dev.duration = 3600
	const client = await connected(dev)
	const self = makeSelf(client)
	const r = await resume(self)
	assert.equal(r.sent, false)
	assert.equal(r.reason, 'state')
	assert.equal(await togglePause(self).then((x) => x.sent), false)
	assert.equal(dev.posts().length, 0)
	assert.match(client.lastMessage, /nothing sent/)
	// ...whereas "start scheduled now" is exactly what record is for here.
	assert.equal((await startScheduledNow(self)).ok, true)
	assert.deepEqual(dev.posts().map((p) => p.path), ['/capture/record'])
})

test('pause, resume and toggle send the right command only in the right state', async () => {
	const dev = makeDevice()
	dev.state = 'active'
	dev.start = Date.now()
	dev.duration = 3600
	const client = await connected(dev)
	const self = makeSelf(client)
	assert.equal((await pause(self)).ok, true)
	await waitFor(() => client.state === 'paused', 2000, 'paused')
	assert.equal(getFeedbacks(self).paused.callback({ options: { blink: false } }), true)
	self.blinkOn = false
	assert.equal(getFeedbacks(self).paused.callback({ options: { blink: true } }), false, 'flash off phase')
	self.lastPress.clear()
	assert.equal((await pause(self)).reason, 'state', 'pause while paused sends nothing')
	assert.equal((await togglePause(self)).ok, true) // paused -> record
	await waitFor(() => client.state === 'active', 2000, 'active')
	assert.deepEqual(dev.posts().map((p) => p.path), ['/capture/pause', '/capture/record'])
	assert.ok(dev.posts().every((p) => p.body === ''))
})

test('debounce: a double tap sends one request', async () => {
	const dev = makeDevice()
	dev.state = 'active'
	dev.start = Date.now()
	dev.duration = 3600
	const client = await connected(dev)
	const self = makeSelf(client)
	const [a, b] = await Promise.all([pause(self), pause(self)])
	assert.equal(a.sent, true)
	assert.equal(b.reason, 'debounced')
	await extend(self, 5)
	assert.equal((await extend(self, 5)).reason, 'debounced')
	assert.equal(dev.posts('/capture/pause').length, 1)
	assert.equal(dev.posts('/capture/extend').length, 1)
})

test('toggle refuses when the state is stale', async () => {
	const dev = makeDevice()
	dev.state = 'active'
	dev.start = Date.now()
	dev.duration = 3600
	const client = await connected(dev)
	client.stop() // no more polls
	client.stateAt = Date.now() - 10_000
	const r = await togglePause(makeSelf(client))
	assert.equal(r.reason, 'stale')
	assert.equal(dev.posts().length, 0)
})

test('extend sends duration in seconds with extend=Submit+Query', async () => {
	const dev = makeDevice()
	dev.state = 'paused'
	dev.start = Date.now()
	dev.duration = 3600
	const client = await connected(dev)
	const self = makeSelf(client)
	await extend(self, 5)
	await extend(self, 15)
	const acts = getActions(self)
	await acts.extend.callback({ options: { minutes: 'custom', custom: 7 } })
	assert.deepEqual(
		dev.posts().map((p) => `${p.path} ${p.body}`),
		[
			'/capture/extend duration=300&extend=Submit+Query',
			'/capture/extend duration=900&extend=Submit+Query',
			'/capture/extend duration=420&extend=Submit+Query',
		],
	)
	assert.equal(client.lastMessage, 'Extend by 420 seconds recieved')
	await waitFor(() => client.duration === 3600 + 300 + 900 + 420, 2000, 'duration updated')

	// Nothing to extend when idle.
	dev.state = 'inactive'
	await waitFor(() => client.state === 'inactive', 2000, 'inactive')
	self.lastPress.clear()
	assert.equal((await extend(self, 5)).reason, 'state')
})

test('stop that times out is not retried', async () => {
	const dev = makeDevice()
	dev.state = 'active'
	dev.start = Date.now()
	dev.duration = 3600
	dev.hang.add('/capture/stop')
	const client = await connected(dev)
	const self = makeSelf(client)
	const r = await stop(self)
	assert.equal(r.sent, true)
	assert.equal(r.ok, false)
	assert.match(r.text, /No reply to stop \(not retried/)
	assert.equal(getFeedbacks(self).error.callback({ options: {} }), true)
	await sleep(TIMING.requestTimeoutMs * 4)
	assert.equal(dev.posts('/capture/stop').length, 1)
	assert.equal(client.state, 'active', 'polling carried on and shows the truth')
})

test('device <error> replies are shown and flagged for 10 s', async () => {
	const dev = makeDevice()
	const client = await connected(dev)
	const r = await client.command('stop')
	assert.equal(r.ok, false)
	assert.equal(client.lastMessage, 'Failed on command (stop).  No capture is running.')
	const self = makeSelf(client)
	assert.equal(getFeedbacks(self).error.callback({ options: {} }), true)
	client.lastError.at -= 11_000
	assert.equal(getFeedbacks(self).error.callback({ options: {} }), false)
})

test('stop only when active or paused; offline sends nothing', async () => {
	const dev = makeDevice()
	const client = await connected(dev)
	const self = makeSelf(client)
	assert.equal((await stop(self)).reason, 'state')
	client.stop()
	client.connected = false
	self.lastPress.clear()
	assert.equal((await stop(self)).reason, 'offline')
	assert.equal((await startAdHoc(self, {})).reason, 'offline')
	assert.equal(dev.posts().length, 0)
})

test('elapsed and remaining use the device clock offset', async () => {
	const dev = makeDevice()
	dev.skewMs = 3600_000 // device clock an hour ahead of this machine
	dev.state = 'active'
	dev.start = Date.now() + dev.skewMs - 600_000 // started 10 minutes ago, device time
	dev.duration = 3600
	dev.next = { title: 'Next lecture', start: Date.now() + dev.skewMs + 30 * 60_000, duration: 3000 }
	const client = await connected(dev)
	await waitFor(() => client.capturesAt && client.next, 2000, 'captures')
	assert.ok(Math.abs(client.clockOffset - 3600_000) < 500, `offset ${client.clockOffset}`)
	const el = client.elapsedSeconds()
	const rem = client.remainingSeconds()
	assert.ok(el >= 599 && el <= 602, `elapsed ${el}`)
	assert.ok(rem >= 2998 && rem <= 3001, `remaining ${rem}`)
	const self = makeSelf(client)
	const v = getVariableValues(self)
	assert.match(v.elapsed, /^00:10:0[0-2]$/)
	assert.match(v.remaining, /^00:(49:5\d|50:0[01])$/)
	assert.equal(v.state_label, 'REC')
	assert.equal(v.duration_min, 60)
	assert.equal(v.title, '')
	assert.equal(v.section, 'Sound Design 101')
	assert.equal(v.presenter, 'Jo Citizen, Sam Lee')
	assert.equal(v.profile, PROFILES[1])
	assert.equal(v.next_title, 'Next lecture')
	assert.match(v.next_in, /^(29|30)m$/)
	// End time is shown in this machine's clock: start + duration - offset = now + 50 minutes.
	const end = new Date(Date.now() + 50 * 60_000)
	const pad = (n) => String(n).padStart(2, '0')
	assert.ok(v.end_time.endsWith(`${pad(end.getHours())}:${pad(end.getMinutes())}`) || v.end_time.endsWith(`${pad(end.getHours())}:${pad((end.getMinutes() + 59) % 60)}`))
	const fb = getFeedbacks(self)
	assert.equal(fb.remaining_below.callback({ options: { minutes: 60, blink: false } }), true)
	assert.equal(fb.remaining_below.callback({ options: { minutes: 5, blink: false } }), false)
	assert.equal(fb.next_within.callback({ options: { minutes: 31 } }), true)
	assert.equal(fb.next_within.callback({ options: { minutes: 10 } }), false)
})

test('presets: hold-to-stop uses a 2 s runWhileHeld group and nothing on a short press', () => {
	const self = makeSelf(new EchoClient(TIMING))
	const p = getPresets(self)
	const step = p.stop_hold.steps[0]
	assert.deepEqual(step.down, [])
	assert.deepEqual(step.up, [])
	assert.deepEqual(step[2000], { options: { runWhileHeld: true }, actions: [{ actionId: 'stop', options: {} }] })
	assert.equal(p.rec.style.text, '$(echo:state_label)\\n$(echo:elapsed)')
	const actions = getActions(self)
	const feedbacks = getFeedbacks(self)
	for (const preset of Object.values(p)) {
		for (const s of preset.steps) for (const a of [...s.down, ...s.up, ...(s[2000]?.actions ?? [])]) assert.ok(actions[a.actionId], a.actionId)
		for (const f of preset.feedbacks) assert.ok(feedbacks[f.feedbackId], f.feedbackId)
	}
	const ids = new Set(getVariableDefinitions().map((d) => d.variableId))
	for (const id of Object.keys(getVariableValues(self))) assert.ok(ids.has(id), id)
	assert.ok(!Object.keys(actions).some((k) => /reboot|diagnostic|restart/.test(k)))
})

// ---------- https ----------

// A self-signed Ed25519 certificate built with node:crypto alone (no openssl needed).
function selfSigned() {
	const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
	const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]))
	const der = (tag, ...parts) => {
		const body = Buffer.concat(parts)
		return Buffer.concat([Buffer.from([tag]), len(body.length), body])
	}
	const seq = (...p) => der(0x30, ...p)
	const alg = seq(Buffer.from([0x06, 0x03, 0x2b, 0x65, 0x70]))
	const name = seq(der(0x31, seq(Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]), der(0x0c, Buffer.from('fake-echo360')))))
	const time = (s) => der(0x17, Buffer.from(s))
	const tbs = seq(
		der(0xa0, der(0x02, Buffer.from([2]))),
		der(0x02, Buffer.from([1])),
		alg,
		name,
		seq(time('250101000000Z'), time('350101000000Z')),
		name,
		publicKey.export({ type: 'spki', format: 'der' }),
	)
	const sig = crypto.sign(null, tbs, privateKey)
	const cert = seq(tbs, alg, der(0x03, Buffer.from([0]), sig))
	const pem = `-----BEGIN CERTIFICATE-----\n${cert.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`
	return { cert: pem, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }
}

test('https with a self-signed certificate works without disabling TLS checks process-wide', async () => {
	const tls = selfSigned()
	assert.ok(new crypto.X509Certificate(tls.cert).subject.includes('fake-echo360'))
	const dev = makeDevice({ tls })
	const client = await connected(dev)
	assert.equal(client.status, 'ok')
	assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined)
	assert.equal(https.globalAgent.options.rejectUnauthorized, undefined, 'global agent untouched')
	const r = await startAdHoc(makeSelf(client), {})
	assert.equal(r.ok, true)
	assert.equal(dev.posts('/capture/new_capture').length, 1)
})

// ---------- Universal Capture (keyboard shortcuts) ----------

function fakeRunner({ fail } = {}) {
	const calls = []
	const run = (cmd, args, opts, cb) => {
		calls.push({ cmd, args })
		setImmediate(() => (fail ? cb(Object.assign(new Error('Command failed'), { code: 1 }), '', fail) : cb(null, '', '')))
	}
	return { calls, run }
}

function ucSelf({ platform = 'darwin', fail, config = {} } = {}) {
	const runner = fakeRunner({ fail })
	const client = new EchoClient(TIMING)
	const logs = []
	const self = {
		client,
		label: 'echo',
		config: { device: 'uc', ucApp: 'Universal Capture', ucActivate: false, room: 'Studio 2', ...config },
		uc: new UCKeys({ run: runner.run, platform, log: (l, m) => logs.push([l, m]) }),
		blinkOn: true,
	}
	return { self, runner, logs }
}

test('Universal Capture: exact osascript arguments for each shortcut', async () => {
	const { self, runner } = ucSelf()
	const acts = getActions(self)
	for (const id of ['uc_pause_resume', 'uc_finish', 'uc_extend', 'uc_open']) await acts[id].callback({ options: {} })
	assert.deepEqual(
		runner.calls.map((c) => [c.cmd, ...c.args]),
		['6', '8', '1', '4'].map((k) => ['osascript', '-e', `tell application "System Events" to keystroke "${k}" using command down`]),
	)
	assert.match(self.uc.lastMessage, /no status/)
})

test('Universal Capture: activating the app passes its name as an argument, not inside the script', async () => {
	const { self, runner } = ucSelf({ config: { ucActivate: true, ucReturn: false, ucApp: 'Evil" to do shell script "rm -rf ~' } })
	await ucKey(self, 'pause_resume')
	const { args } = runner.calls[0]
	assert.deepEqual(args, [
		'-e',
		'on run argv',
		'-e',
		'tell application (item 1 of argv) to activate',
		'-e',
		'delay 0.3',
		'-e',
		'tell application "System Events" to keystroke "6" using command down',
		'-e',
		'end run',
		'Evil" to do shell script "rm -rf ~',
	])
	assert.ok(args.slice(0, -1).every((a) => !a.includes('Evil')))
	assert.throws(() => osascriptArgs('6; rm'))
})

test('Universal Capture: by default it goes back to the app that was in front (slides stay up)', async () => {
	const { self, runner } = ucSelf({ config: { ucActivate: true } })
	await ucKey(self, 'finish')
	const script = runner.calls[0].args.filter((a, i, all) => all[i - 1] === '-e')
	assert.ok(script.indexOf('tell application "System Events" to set prevApp to name of first application process whose frontmost is true') < script.indexOf('tell application (item 1 of argv) to activate'))
	assert.ok(script.includes('tell application "System Events" to set frontmost of process prevApp to true'))
	assert.equal(script.at(-1), 'end run')
	assert.equal(runner.calls[0].args.at(-1), 'Universal Capture')
})

test('Universal Capture: a refused Automation permission says where to allow it', async () => {
	const { self } = ucSelf({ fail: 'Not authorized to send Apple events to System Events. (-1743)' })
	await ucKey(self, 'extend')
	assert.match(self.uc.lastMessage, /Automation/)
})

test('Universal Capture: double tap on the toggle sends one keystroke', async () => {
	const { self, runner } = ucSelf()
	const [a, b] = await Promise.all([ucKey(self, 'pause_resume'), ucKey(self, 'pause_resume')])
	assert.equal(a.sent, true)
	assert.equal(b.reason, 'debounced')
	assert.equal(runner.calls.length, 1)
})

test('Universal Capture: nothing runs on Linux, with a clear warning', async () => {
	const { self, runner, logs } = ucSelf({ platform: 'linux' })
	const r = await ucKey(self, 'finish')
	assert.equal(r.reason, 'platform')
	assert.equal(runner.calls.length, 0)
	assert.ok(logs.some(([l, m]) => l === 'warn' && /only work when Companion runs on a Mac or Windows PC/.test(m)))
	assert.equal(getFeedbacks(self).error.callback({ options: {} }), true)
})

test('Universal Capture on Windows: Ctrl+number through PowerShell, app name passed safely', async () => {
	const calls = []
	const run = (cmd, args, opts, cb) => {
		calls.push({ cmd, args, env: opts.env, hide: opts.windowsHide })
		setImmediate(() => cb(null, 'OK\r\n', ''))
	}
	const logs = []
	const uc = new UCKeys({ run, platform: 'win32', log: (l, m) => logs.push([l, m]) })
	const r = await uc.send('finish', { activate: true, appName: 'Universal Capture"; Remove-Item C:\\ -Recurse' })
	assert.equal(r.ok, true)
	const [c] = calls
	assert.equal(c.cmd, 'powershell.exe')
	assert.equal(c.hide, true)
	assert.equal(c.args.at(-1), WINDOWS_SCRIPT, 'the script never changes')
	assert.ok(!c.args.some((a) => a.includes('Remove-Item')), 'the app name only travels in the environment')
	assert.equal(c.env.UC_KEY, '8')
	assert.equal(c.env.UC_ACTIVATE, '1')
	assert.equal(c.env.UC_RETURN, '1')
	assert.match(WINDOWS_SCRIPT, /SendKeys\('\^' \+ \$env:UC_KEY\)/)
	assert.match(uc.lastMessage, /Ctrl\+8/)
})

test('Universal Capture on Windows: no window found is reported', async () => {
	const uc = new UCKeys({ run: (c, a, o, cb) => cb(null, 'ERR:not-running\r\n', ''), platform: 'win32' })
	const r = await uc.send('pause_resume', { activate: true })
	assert.equal(r.ok, false)
	assert.match(uc.lastMessage, /couldn't find a Universal Capture window/)
	assert.deepEqual(powershellArgs('6', { activate: false }).env, { UC_KEY: '6', UC_APP: 'Universal Capture', UC_ACTIVATE: '0', UC_RETURN: '1' })
	assert.throws(() => powershellArgs('6; rm'))
})

test('Universal Capture: permission failure explains Accessibility', async () => {
	const { self } = ucSelf({ fail: 'execution error: System Events got an error: osascript is not allowed to send keystrokes. (1002)' })
	const r = await ucKey(self, 'open')
	assert.equal(r.ok, false)
	assert.match(self.uc.lastMessage, /Accessibility/)
})

test('Universal Capture: shortcuts refused in device mode, device actions see no device', async () => {
	const { self, runner } = ucSelf({ config: { device: 'appliance' } })
	assert.equal((await ucKey(self, 'pause_resume')).reason, 'mode')
	assert.equal(runner.calls.length, 0)
})

test('Universal Capture: buttons say NO STATUS, never a timer or REC', () => {
	const { self } = ucSelf()
	const v = getVariableValues(self)
	assert.equal(v.state_label, 'NO STATUS')
	assert.equal(v.elapsed, '')
	assert.equal(v.remaining, '')
	assert.equal(v.room, 'Studio 2')
	const fb = getFeedbacks(self)
	for (const id of ['recording', 'paused', 'waiting', 'idle', 'disconnected']) assert.equal(fb[id].callback({ options: { blink: false } }), false, id)
})

test('Universal Capture presets: own category, finish only from the 2 s hold group', () => {
	const { self } = ucSelf()
	const presets = Object.values(getPresets(self)).filter((p) => p.category === UC_CATEGORY)
	assert.deepEqual(presets.map((p) => p.steps[0].down.map((a) => a.actionId).concat(p.steps[0][2000]?.actions.map((a) => a.actionId) ?? [])).flat().sort(), [
		'uc_extend',
		'uc_finish',
		'uc_open',
		'uc_pause_resume',
	])
	const finish = presets.filter((p) => JSON.stringify(p.steps).includes('uc_finish'))
	assert.equal(finish.length, 1)
	const step = finish[0].steps[0]
	assert.deepEqual(step.down, [])
	assert.deepEqual(step.up, [])
	assert.deepEqual(step[2000], { options: { runWhileHeld: true }, actions: [{ actionId: 'uc_finish', options: {} }] })
	// No feedback in this category pretends to know the recording state.
	for (const p of presets) assert.ok(p.feedbacks.every((f) => f.feedbackId === 'error'))
	// And no device preset ever sends a keystroke.
	for (const p of Object.values(getPresets(self)).filter((p) => p.category !== UC_CATEGORY)) assert.ok(!JSON.stringify(p.steps).includes('"uc_'))
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
