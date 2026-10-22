// Run with: node --test test/ma2.test.mjs
// A fake grandMA2 Telnet server (login prompt, echo, Telnet negotiation bytes, drops) and a fake
// Web Remote (a tiny WebSocket server on node:http), driven through the real clients and actions.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { TelnetFilter, MA2Telnet, loginLine, quoteArg, cleanCommand } from '../src/telnet.js'
import { WebRemote, pollRanges, parsePlaybacks, parseCues, faderPercent, md5hex, playbacksRequest } from '../src/webremote.js'
import { MA2Console, parseExecList, stepPercent, stepDelta, fillTemplate } from '../src/console.js'
import { getActions } from '../src/actions.js'
import { getFeedbacks } from '../src/feedbacks.js'
import { getVariableDefinitions, getVariableValues } from '../src/variables.js'
import { getPresets } from '../src/presets.js'
import { overallStatus } from '../src/status.js'
import { UpgradeScripts } from '../src/upgrades.js'

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 3000, what = 'condition') {
	const end = Date.now() + ms
	while (Date.now() < end) {
		if (fn()) return
		await tick(10)
	}
	assert.fail(`timed out waiting for ${what}`)
}
const cleanups = []
after(() => {
	for (const c of cleanups.reverse()) c()
})

// ---------- fake Telnet server ----------

const IAC = 255
function fakeTelnet({ login = true, guest = false, password = 'admin' } = {}) {
	const srv = {
		lines: [],
		raw: [],
		sockets: new Set(),
		connections: 0,
		mute: false,
		login,
	}
	srv.server = net.createServer((sock) => {
		srv.connections++
		srv.sockets.add(sock)
		sock.on('close', () => srv.sockets.delete(sock))
		sock.on('error', () => null)
		// Negotiation first, split across two packets to prove the filter keeps state.
		sock.write(Buffer.from([IAC, 253, 1, IAC]))
		setTimeout(() => {
			if (sock.destroyed) return
			sock.write(Buffer.from([251, 3, IAC, 250, 24, 1, IAC, 240]))
			sock.write('\x1b[32mWelcome to grandMA2\x1b[0m\r\n')
			sock.write(srv.login ? 'Please login !\r\n[Channel]>' : '[Channel]>')
		}, 5)
		let buf = Buffer.alloc(0)
		sock.on('data', (d) => {
			srv.raw.push(...d)
			buf = Buffer.concat([buf, d])
			// drop our negotiation replies (IAC WONT/DONT x)
			while (buf[0] === IAC && buf.length >= 3) buf = buf.subarray(3)
			let i
			while ((i = buf.indexOf('\r\n')) !== -1) {
				const line = buf.subarray(0, i).toString()
				buf = buf.subarray(i + 2)
				srv.lines.push(line)
				if (srv.mute) continue
				const m = /^Login "([^"]*)" "([^"]*)"$/.exec(line)
				if (m) {
					if (m[2] === password) sock.write(`Logged in as User '${guest ? 'guest' : m[1]}'\r\n[Channel]>`)
					else sock.write('Error #72: no login\r\n[Channel]>')
				} else sock.write(`${line}\r\n[Channel]>`) // echo, like the console
			}
		})
	})
	return new Promise((r) =>
		srv.server.listen(0, '127.0.0.1', () => {
			srv.port = srv.server.address().port
			cleanups.push(() => {
				for (const s of srv.sockets) s.destroy()
				srv.server.close()
			})
			r(srv)
		}),
	)
}

const fastTelnet = (extra = {}) => new MA2Telnet({ reconnectSteps: [50, 50], nudgeMs: 100, ...extra })

async function telnetUp(srvOpts, cfg = {}) {
	const srv = await fakeTelnet(srvOpts)
	const t = fastTelnet()
	cleanups.push(() => t.stop())
	t.start({ host: '127.0.0.1', port: srv.port, user: 'administrator', pass: 'admin', spacingMs: 5, ...cfg })
	return { srv, t }
}

// ---------- pure helpers ----------

test('login is quoted and cannot be broken out of', () => {
	assert.equal(loginLine('Al', 'bundy'), 'Login "Al" "bundy"')
	assert.equal(loginLine('a"b', 'x\r\ny'), 'Login "ab" "xy"')
	assert.equal(quoteArg(undefined), '""')
	assert.equal(cleanCommand('Go\r\nOff'), 'Go Off')
})

test('Telnet filter answers DO/WILL, skips sub-negotiation, keeps escaped 255, survives splits', () => {
	const replies = []
	const f = new TelnetFilter((b) => replies.push([...b]))
	const a = f.push(Buffer.from([65, IAC, 253]))
	const b = f.push(Buffer.from([1, 66, IAC, 251, 3, IAC, 250, 24, 1, 2, IAC, 240, IAC, IAC, 67, IAC, 254, 5]))
	assert.equal(Buffer.concat([a, b]).toString('latin1'), 'AB\xffC')
	assert.deepEqual(replies, [
		[IAC, 252, 1],
		[IAC, 254, 3],
	])
})

test('step sizes, clamp and exec list parsing', () => {
	assert.equal(stepDelta({ size: 2, direction: 'up' }), 2)
	assert.equal(stepDelta({ size: 10, direction: 'down' }), -20)
	assert.equal(stepDelta({ size: 'junk' }), 2, 'bad size falls back to default')
	assert.equal(stepDelta({ size: 7 }), 8)
	assert.equal(stepPercent(99, 2), 100)
	assert.equal(stepPercent(1, -2), 0)
	assert.equal(stepPercent(undefined, 3), 3)
	assert.deepEqual(parseExecList('1-3, 101-102 7 junk 5-4'), [1, 2, 3, 4, 5, 7, 101, 102])
	assert.equal(parseExecList('1-999').length, 120, 'capped')
	assert.equal(fillTemplate('Fader {page}.{exec} At {level}', { page: 2, exec: 5, level: 40 }), 'Fader 2.5 At 40')
})

test('Web Remote poll ranges are 0-based blocks of 5, split by fader/button executors', () => {
	assert.deepEqual(pollRanges(parseExecList('1-15')), [{ start: 0, count: 15, type: 2 }])
	assert.deepEqual(
		pollRanges([1, 15]),
		[
			{ start: 0, count: 5, type: 2 },
			{ start: 10, count: 5, type: 2 },
		],
		'unused blocks in between are skipped',
	)
	assert.deepEqual(pollRanges([1, 12, 101, 105]), [
		{ start: 0, count: 5, type: 2 },
		{ start: 10, count: 5, type: 2 },
		{ start: 100, count: 5, type: 3 },
	])
	const req = playbacksRequest(7, 0, pollRanges([1, 2]))
	assert.deepEqual([req.startIndex, req.itemsCount, req.itemsType, req.pageIndex, req.session], [[0], [5], [2], 0, 7])
})

// A reply shaped like the community type definitions (xtouchgma2 gma2ws/types.go).
const fx = (name, v, run = 0, cues = ['1 Preset', '2 Verse', '3 Chorus'], width = 1) => ({
	i: { t: '' },
	tt: { t: name },
	isRun: run,
	combinedItems: width,
	cues: { items: cues.map((t) => ({ t })) },
	executorBlocks: Array.from({ length: width }, () => ({
		button1: { id: 0, t: 'Go' },
		button2: { id: 1, t: 'Flash' },
		button3: { id: 2, t: 'Pause' },
		fader: { v, min: 0, max: 1, vT: `${Math.round(v * 100)}%`, tt: 'Master' },
	})),
})
function playbacksReply(items) {
	// items: array of 5-blocks
	return { responseType: 'playbacks', responseSubType: 2, iPage: 0, itemGroups: [{ itemsType: 2, cntPages: 1, items }] }
}

test('playbacks reply parsing: names, levels, running, cues, combined executors, junk', () => {
	const msg = playbacksReply([
		[fx('Wash', 0.5, 1), fx('Spots', 1), fx('Wide', 0.25, 0, ['A', 'B'], 2), fx('Last', 0)],
		[fx('Six', 0.1), null, 'junk'],
	])
	const s = parsePlaybacks(msg, [{ start: 0, count: 10, type: 2 }])
	assert.deepEqual(s.get(1), {
		exec: 1,
		name: 'Wash',
		level: 50,
		levelText: '50%',
		running: true,
		prev: '1 Preset',
		cur: '2 Verse',
		next: '3 Chorus',
		buttons: ['Go', 'Flash', 'Pause'],
	})
	assert.equal(s.get(2).level, 100)
	assert.equal(s.get(3).name, 'Wide')
	assert.equal(s.get(4).name, 'Wide', 'combined executor covers two numbers')
	assert.equal(s.get(5).name, 'Last')
	assert.equal(s.get(6).name, 'Six')
	assert.equal(s.get(3).cur, 'A')
	assert.equal(parsePlaybacks({ itemGroups: 'nope' }, []).size, 0)
	assert.equal(parsePlaybacks(null, []).size, 0)
	assert.deepEqual(parseCues({ items: [{ t: ' 1 Only ' }] }), { prev: '', cur: '1 Only', next: '' })
	assert.equal(faderPercent({ v: 50, min: 0, max: 100 }), 50)
	assert.equal(faderPercent({ v: 'x' }), undefined)
	assert.equal(md5hex('abc'), '900150983cd24fb0d6963f7d28e17f72')
})

// ---------- Telnet against the fake console ----------

test('Telnet: connecting until the console answers, IAC answered, quoted login, then ok', async () => {
	const { srv, t } = await telnetUp()
	const states = []
	t.on('state', (s) => states.push(s))
	await until(() => t.ok, 3000, 'login')
	assert.ok(srv.lines.includes('Login "administrator" "admin"'))
	// our replies: WONT 1 (to DO 1) and DONT 3 (to WILL 3)
	const raw = Buffer.from(srv.raw)
	assert.ok(raw.includes(Buffer.from([IAC, 252, 1])))
	assert.ok(raw.includes(Buffer.from([IAC, 254, 3])))
	assert.match(t.message, /Logged in as administrator/)
	assert.equal(t.lastResponse.includes('\x1b'), false, 'ANSI stripped')
})

test('Telnet: wrong password = login refused; guest = warning', async () => {
	const { t } = await telnetUp({ password: 'other' })
	await until(() => t.state === 'failed', 3000, 'refusal')
	const [status] = overallStatus(t, { state: 'off', ok: false }, false)
	assert.equal(status, 'authentication_failure')
	t.stop()
	const g = await telnetUp({ guest: true })
	await until(() => g.t.ok)
	assert.equal(g.t.guest, true)
	assert.equal(overallStatus(g.t, { state: 'off' }, false)[0], 'unknown_warning')
})

test('Telnet: login switched off = ok when the prompt shows', async () => {
	const { srv, t } = await telnetUp({ login: false }, { login: false })
	await until(() => t.ok)
	assert.ok(!srv.lines.some((l) => l.startsWith('Login')))
	assert.equal(overallStatus(t, { state: 'off' }, false)[0], 'ok')
})

test('Telnet: commands are spaced, fader sets coalesce to the newest value', async () => {
	const { srv, t } = await telnetUp(undefined, { spacingMs: 40 })
	await until(() => t.ok)
	srv.lines.length = 0
	const sentAt = []
	t.on('sent', () => sentAt.push(Date.now()))
	t.send('Go Executor 1.1')
	for (let v = 1; v <= 20; v++) t.send(`Fader 1.1 At ${v}`, { key: 'fader:1.1' })
	t.send('Go Executor 1.2')
	await until(() => srv.lines.includes('Go Executor 1.2'))
	const faders = srv.lines.filter((l) => l.startsWith('Fader'))
	assert.deepEqual(faders, ['Fader 1.1 At 20'], 'only the newest fader value is sent')
	assert.deepEqual(
		srv.lines.filter((l) => l.startsWith('Go')),
		['Go Executor 1.1', 'Go Executor 1.2'],
	)
	for (let i = 1; i < sentAt.length; i++) assert.ok(sentAt[i] - sentAt[i - 1] >= 35, 'spacing kept')
})

test('Telnet: Go is never retried; reconnects after a drop and logs in again', async () => {
	const { srv, t } = await telnetUp()
	await until(() => t.ok)
	const logs = []
	t.on('log', (l, m) => logs.push(m))
	for (const s of srv.sockets) s.destroy()
	await until(() => !t.ok, 2000, 'drop noticed')
	assert.equal(t.send('Go Executor 1.5'), false, 'dropped while down')
	t.send('Fader 1.5 At 30', { key: 'fader:1.5' }) // latest fader value is kept
	assert.ok(logs.some((m) => /dropped "Go Executor 1.5"/i.test(m)))
	await until(() => t.ok, 3000, 'reconnect')
	assert.equal(srv.connections, 2)
	await until(() => srv.lines.includes('Fader 1.5 At 30'))
	await tick(100)
	assert.ok(!srv.lines.includes('Go Executor 1.5'), 'Go not sent after reconnect')
})

test('Telnet: silence counts as disconnected; stop() ends the reconnect loop', async () => {
	const { srv, t } = await telnetUp(undefined, { heartbeatMs: 150, silenceMs: 400 })
	await until(() => t.ok)
	srv.mute = true
	await until(() => !t.ok, 3000, 'silence detected')
	assert.ok(['disconnected', 'connecting'].includes(t.state))
	srv.mute = false
	await until(() => t.ok, 3000, 'back after silence')
	assert.ok(srv.lines.includes(''), 'heartbeat is an empty line')
	t.stop()
	const n = srv.connections
	for (const s of srv.sockets) s.destroy()
	await tick(300)
	assert.equal(srv.connections, n, 'no reconnect after stop')
	assert.equal(t.state, 'disconnected')
})

// ---------- fake Web Remote ----------

function wsFrame(text) {
	const payload = Buffer.from(text)
	const len = payload.length
	const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : null
	return Buffer.concat([head, payload])
}
function wsParse(buf) {
	const frames = []
	let off = 0
	while (buf.length - off >= 2) {
		const op = buf[off] & 0x0f
		let len = buf[off + 1] & 0x7f
		let p = off + 2
		if (len === 126) {
			if (buf.length - p < 2) break
			len = buf.readUInt16BE(p)
			p += 2
		} else if (len === 127) {
			if (buf.length - p < 8) break
			len = Number(buf.readBigUInt64BE(p))
			p += 8
		}
		if (buf.length - p < 4 + len) break
		const mask = buf.subarray(p, p + 4)
		const data = Buffer.from(buf.subarray(p + 4, p + 4 + len))
		for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4]
		frames.push({ op, data })
		off = p + 4 + len
	}
	return { frames, rest: buf.subarray(off) }
}

function fakeWebRemote({ user = 'companion', pass = 'secret', session = 42, mute = false } = {}) {
	const wr = { mute, received: [], sockets: new Set(), connections: 0, levels: { 1: 0.5, 2: 1, 3: 0, 4: 0, 5: 0 }, running: { 1: 1 } }
	const server = http.createServer((_q, res) => res.end('no'))
	server.on('upgrade', (req, sock) => {
		wr.connections++
		wr.url = req.url
		const accept = createHash('sha1')
			.update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
			.digest('base64')
		sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
		wr.sockets.add(sock)
		sock.on('close', () => wr.sockets.delete(sock))
		sock.on('error', () => null)
		const send = (o) => !sock.destroyed && sock.write(wsFrame(typeof o === 'string' ? o : JSON.stringify(o)))
		send({ status: 'server ready', appType: 'gma2' })
		let buf = Buffer.alloc(0)
		sock.on('data', (d) => {
			const { frames, rest } = wsParse(Buffer.concat([buf, d]))
			buf = rest
			for (const f of frames) {
				if (f.op === 8) {
					sock.end()
					continue
				}
				if (f.op !== 1) continue
				const msg = JSON.parse(f.data.toString())
				wr.received.push(msg)
				if (wr.mute) continue
				if (msg.session === 0 && !msg.requestType) send({ realtime: false, session, forceLogin: true, worldIndex: 0 })
				else if (msg.requestType === 'login') {
					send({ realtime: false, responseType: 'login', result: msg.username === user && msg.password === md5hex(pass), worldIndex: 0 })
					send('not json {') // junk must not hurt
				} else if (msg.requestType === 'playbacks') {
					const items = [[1, 2, 3, 4, 5].map((n) => fx(`Exec ${n} name`, wr.levels[n], wr.running[n] ?? 0))]
					send({ ...playbacksReply(items), iPage: msg.pageIndex })
				} else if (msg.requestType === 'playbacks_userInput' && msg.type === 1) {
					wr.levels[msg.execIndex + 1] = msg.faderValue
				}
			}
		})
	})
	wr.server = server
	return new Promise((r) =>
		server.listen(0, '127.0.0.1', () => {
			wr.port = server.address().port
			cleanups.push(() => {
				for (const s of wr.sockets) s.destroy()
				server.close()
			})
			r(wr)
		}),
	)
}

test('Web Remote: handshake, MD5 login, polling fills executor state', async () => {
	const fake = await fakeWebRemote()
	const w = new WebRemote({ reconnectSteps: [50] })
	cleanups.push(() => w.stop())
	w.start({ host: '127.0.0.1', port: fake.port, user: 'companion', pass: 'secret', pollMs: 60, page: 1, execs: [1, 2, 3] })
	await until(() => w.ok, 3000, 'web remote login')
	assert.equal(fake.url, '/?ma=1')
	const login = fake.received.find((m) => m.requestType === 'login')
	assert.equal(login.password, md5hex('secret'))
	assert.equal(login.session, 42)
	await until(() => w.executors.get(1)?.name === 'Exec 1 name', 3000, 'poll')
	assert.equal(w.executors.get(1).level, 50)
	assert.equal(w.executors.get(1).running, true)
	assert.ok(fake.received.filter((m) => m.requestType === 'playbacks').length >= 1)
	// press / release
	w.button(1, 3, 2, true)
	w.button(1, 3, 2, false)
	await until(() => fake.received.filter((m) => m.requestType === 'playbacks_userInput').length === 2)
	const [p, r] = fake.received.filter((m) => m.requestType === 'playbacks_userInput')
	assert.deepEqual([p.execIndex, p.pageIndex, p.buttonId, p.pressed, p.released, p.type], [2, 0, 1, true, false, 0])
	assert.deepEqual([r.pressed, r.released], [false, true])
	w.stop()
	assert.equal(w.state, 'off')
})

test('Web Remote: wrong password is reported, not hammered', async () => {
	const fake = await fakeWebRemote()
	const w = new WebRemote({ reconnectSteps: [50, 400] })
	cleanups.push(() => w.stop())
	w.start({ host: '127.0.0.1', port: fake.port, user: 'companion', pass: 'nope', pollMs: 60, page: 1, execs: [1] })
	await until(() => w.state === 'refused', 3000, 'refused')
	assert.match(w.message, /Administrator/)
	await tick(200)
	assert.equal(fake.connections, 1, 'waits the long step before retrying')
	w.stop()
})

test('Web Remote: switched off on the console (session -1), and silence, are reported', async () => {
	const fake = await fakeWebRemote({ session: -1 })
	const w = new WebRemote({ reconnectSteps: [50, 400] })
	cleanups.push(() => w.stop())
	w.start({ host: '127.0.0.1', port: fake.port, user: 'companion', pass: 'secret', pollMs: 60, page: 1, execs: [1] })
	await until(() => w.state === 'refused', 3000, 'remotes off')
	assert.match(w.message, /Remotes/)
	assert.ok(!fake.received.some((m) => m.requestType === 'login'))
	w.stop()

	const quiet = await fakeWebRemote()
	const q = new WebRemote({ reconnectSteps: [50], keepAliveMs: 50, silenceMs: 200 })
	cleanups.push(() => q.stop())
	q.start({ host: '127.0.0.1', port: quiet.port, user: 'companion', pass: 'secret', pollMs: 60, page: 1, execs: [1] })
	await until(() => q.ok)
	quiet.mute = true
	await until(() => !q.ok, 3000, 'silence noticed')
	quiet.mute = false
	await until(() => q.ok, 3000, 'back again')
	assert.ok(quiet.connections >= 2)
	q.stop()
})

test('Web Remote: fader sends merge per executor, newest value wins', async () => {
	const fake = await fakeWebRemote()
	const w = new WebRemote({ reconnectSteps: [50], faderGapMs: 60 })
	cleanups.push(() => w.stop())
	w.start({ host: '127.0.0.1', port: fake.port, user: 'companion', pass: 'secret', pollMs: 1000, page: 2, execs: [1] })
	await until(() => w.ok)
	for (let v = 1; v <= 10; v++) w.setFader(2, 4, v * 10)
	await tick(200)
	const sets = fake.received.filter((m) => m.requestType === 'playbacks_userInput' && m.type === 1)
	assert.ok(sets.length <= 3, `merged (${sets.length} sends)`)
	assert.equal(sets.at(-1).faderValue, 1)
	assert.equal(sets.at(-1).execIndex, 3)
	assert.equal(sets.at(-1).pageIndex, 1)
	w.stop()
})

// ---------- the whole module: console model + actions ----------

async function moduleUp(config = {}, { web = false } = {}) {
	const srv = await fakeTelnet()
	const fake = web ? await fakeWebRemote() : null
	const ma = new MA2Console({
		telnetOptions: { reconnectSteps: [50], nudgeMs: 100 },
		webRemoteOptions: { reconnectSteps: [50], faderGapMs: 20 },
		echoGuardMs: 300,
	})
	cleanups.push(() => ma.stop())
	const logs = []
	const self = { ma, label: 'ma2', log: (l, m) => logs.push([l, m]), logs }
	ma.on('log', (l, m) => logs.push([l, m]))
	ma.configure({
		host: '127.0.0.1',
		telnet_port: srv.port,
		user: 'administrator',
		pass: 'admin',
		spacing_ms: 5,
		execs: '1-5',
		page: 1,
		...(web ? { wr_enable: true, wr_port: fake.port, wr_user: 'companion', wr_pass: 'secret', poll_ms: 60 } : {}),
		...config,
	})
	await until(() => ma.telnet.ok, 3000, 'telnet up')
	if (web) await until(() => ma.wr.ok, 3000, 'web remote up')
	srv.lines.length = 0
	const actions = getActions(self)
	const run = (id, options = {}) => actions[id].callback({ options }, { parseVariablesInString: async (s) => s })
	return { srv, fake, ma, self, actions, run, logs }
}

test('knob: fast turns all count, clamp at 100 and 0, sent by Telnet as absolute values', async () => {
	const { srv, ma, run } = await moduleUp()
	for (let i = 0; i < 20; i++) await run('exec_fader_step', { which: 'fixed', exec: 3, page: 0, direction: 'up', size: 2 })
	assert.equal(ma.levelOf(1, 3), 40, 'every click counted')
	await until(() => srv.lines.at(-1) === 'Fader 1.3 At 40', 2000, 'final value sent')
	assert.ok(srv.lines.filter((l) => l.startsWith('Fader')).length < 20, 'coalesced on the wire')
	for (let i = 0; i < 10; i++) await run('exec_fader_step', { which: 'fixed', exec: 3, direction: 'up', size: 10 })
	assert.equal(ma.levelOf(1, 3), 100)
	for (let i = 0; i < 30; i++) await run('exec_fader_step', { which: 'fixed', exec: 3, direction: 'down', size: 5 })
	assert.equal(ma.levelOf(1, 3), 0)
	await until(() => srv.lines.at(-1) === 'Fader 1.3 At 0')
	await run('gm_step', { direction: 'down', size: 3 })
	await until(() => srv.lines.at(-1) === 'SpecialMaster "grandmaster"."grand" At 97')
	await run('exec_fader_set', { which: 'fixed', exec: 2, page: 4, level: 150 })
	await until(() => srv.lines.at(-1) === 'Fader 4.2 At 100')
})

test('selected executor: choose, step with wrap, Go/Pause/Flash act on it, never retried', async () => {
	const { srv, ma, run, self } = await moduleUp({ select_follow: true })
	assert.equal(ma.selected, 1)
	await run('select_step', { direction: 'down' })
	assert.equal(ma.selected, 5, 'wraps to the last executor')
	await run('select_step', { direction: 'up' })
	await run('select_step', { direction: 'up' })
	assert.equal(ma.selected, 2)
	await run('exec_go', { which: 'selected', page: 0 })
	await run('exec_pause', { which: 'selected', page: 0 })
	await run('exec_goback', { which: 'next', page: 0 })
	await run('exec_flash', { which: 'selected', page: 0, state: 'press', via: 'button2' }) // no Web Remote: falls back
	await run('exec_flash', { which: 'selected', page: 0, state: 'release', via: 'button2' })
	await run('exec_temp', { which: 'fixed', exec: 4, page: 3, state: 'press' })
	await run('exec_goto', { which: 'selected', page: 0, cue: 7.5 })
	await run('exec_fader_step', { which: 'selected', page: 0, direction: 'up', size: 5 })
	await run('page_step', { direction: 'up', console: 'FaderPage' })
	await until(() => srv.lines.includes('FaderPage 2'))
	assert.deepEqual(srv.lines, [
		'Select Executor 1.5',
		'Select Executor 1.1',
		'Select Executor 1.2',
		'Go Executor 1.2',
		'Pause Executor 1.2',
		'GoBack Executor 1.3',
		'Flash On Executor 1.2',
		'Flash Off Executor 1.2',
		'Temp On Executor 3.4',
		'Goto Cue 7.5 Executor 1.2',
		'Fader 1.2 At 5',
		'FaderPage 2',
	])
	const vals = getVariableValues(self)
	assert.equal(vals.page, '2')
	assert.equal(vals.sel_label, '2.2')
	assert.equal(getFeedbacks(self).exec_selected.callback({ options: { exec: 2 } }), true)
	// link drops: a Go is dropped, not queued
	for (const s of srv.sockets) s.destroy()
	await until(() => !ma.telnet.ok)
	srv.lines.length = 0
	await run('exec_go', { which: 'selected', page: 0 })
	await until(() => ma.telnet.ok, 3000, 'reconnect')
	await tick(150)
	assert.ok(!srv.lines.some((l) => l.startsWith('Go ')), 'Go not retried after reconnect')
	// bad executor numbers send nothing
	srv.lines.length = 0
	await run('exec_go', { which: 'fixed', exec: 'abc', page: 0 })
	await tick(60)
	assert.deepEqual(srv.lines, [])
})

test('upstream actions keep their ids and no longer send NaN', async () => {
	const { srv, run, actions } = await moduleUp()
	for (const id of ['command', 'button', 'wheel', 'encoder', 'encoder_p']) assert.ok(actions[id], id)
	await run('encoder', { encoder_from_variable: false, enc: 5, steps: 3 }) // no direction (old default)
	await run('wheel', { steps: 'abc' })
	await run('wheel', { steps: '-2' })
	await run('button', { button: '11', dir: 'true' })
	await run('button', { button: '9999', dir: 'true' })
	await run('encoder_p', { encoder_from_variable: true, encoder_variable: '3', dir: 'false' })
	await run('command', { command: 'Blackout\r\nOff' })
	await until(() => srv.lines.length >= 5)
	await tick(50)
	assert.deepEqual(srv.lines, [
		"LUA 'gma.canbus.encoder(5, 3, nil)'",
		"LUA 'gma.canbus.wheel(-2)'",
		"LUA 'gma.canbus.hardkey(11, true, false)'",
		"LUA 'gma.canbus.encoder(2, nil, false)'",
		'Blackout Off',
	])
	assert.ok(!srv.lines.some((l) => l.includes('NaN')))
	// the upgrade script fills a missing encoder direction
	const up = UpgradeScripts[1]({}, { actions: [{ actionId: 'encoder', options: {} }], feedbacks: [], config: null })
	assert.equal(up.updatedActions[0].options.dir, '1')
})

test('with the Web Remote: readback drives variables and feedbacks; faders go over the Web Remote', async () => {
	const { srv, fake, ma, run, self } = await moduleUp({}, { web: true })
	await until(() => ma.info(1).known, 3000, 'readback')
	let vals = getVariableValues(self)
	assert.equal(vals.exec_1_name, 'Exec 1 name')
	assert.equal(vals.exec_1_level, '50')
	assert.equal(vals.exec_1_running, 'on')
	assert.equal(vals.exec_1_cue, '2 Verse')
	assert.equal(vals.exec_1_next, '3 Chorus')
	assert.equal(vals.sel_name, 'Exec 1 name')
	assert.equal(vals.nxt_name, 'Exec 2 name')
	assert.equal(vals.webremote, 'ok')
	const fb = getFeedbacks(self)
	assert.equal(fb.exec_running.callback({ options: { which: 'selected', page: 0 } }), true)
	assert.equal(fb.exec_full.callback({ options: { which: 'fixed', exec: 2, page: 0 } }), true)
	assert.equal(fb.exec_level_above.callback({ options: { which: 'fixed', exec: 1, page: 0, level: 40 } }), true)
	assert.equal(fb.exec_level_above.callback({ options: { which: 'fixed', exec: 3, page: 0, level: 0 } }), false)
	assert.equal(fb.connected.callback({ options: { link: 'both' } }), true)

	// knob starts from the read-back level (50), every click counts, goes out on the Web Remote
	for (let i = 0; i < 5; i++) await run('exec_fader_step', { which: 'selected', page: 0, direction: 'up', size: 2 })
	assert.equal(ma.levelOf(1, 1), 60)
	await until(() => fake.levels[1] === 0.6, 2000, 'fader on the web remote')
	assert.ok(!srv.lines.some((l) => l.startsWith('Fader')), 'not sent on Telnet too')
	// someone moves it on the console: readback wins once our echo guard has passed
	await tick(400)
	fake.levels[1] = 0.2
	await until(() => ma.levelOf(1, 1) === 20, 2000, 'external move picked up')
	vals = getVariableValues(self)
	assert.equal(vals.sel_level, '20')

	// Flash by the real executor button
	await run('exec_flash', { which: 'selected', page: 0, state: 'press', via: 'button2' })
	await run('exec_flash', { which: 'selected', page: 0, state: 'release', via: 'button2' })
	await until(() => fake.received.filter((m) => m.type === 0).length === 2)
	assert.deepEqual(
		fake.received.filter((m) => m.type === 0).map((m) => [m.execIndex, m.buttonId, m.pressed]),
		[
			[0, 1, true],
			[0, 1, false],
		],
	)
	// Telnet down: custom commands go through the Web Remote
	srv.server.close()
	for (const s of srv.sockets) s.destroy()
	await until(() => !ma.telnet.ok)
	assert.equal(overallStatus(ma.telnet, ma.wr, true)[0], 'unknown_warning')
	await run('command', { command: 'Go Executor 1.1' })
	await until(() => fake.received.some((m) => m.requestType === 'command' && m.command === 'Go Executor 1.1'))
})

test('variables and presets are built from the executor setting', async () => {
	const { ma, self } = await moduleUp({ execs: '1-3, 101' })
	assert.deepEqual(ma.execs, [1, 2, 3, 101])
	const ids = getVariableDefinitions(self).map((d) => d.variableId)
	for (const id of ['exec_3_name', 'exec_101_level', 'sel_next', 'nxt_level', 'gm_level', 'telnet', 'webremote', 'response']) assert.ok(ids.includes(id), id)
	assert.ok(!ids.includes('exec_4_name'))
	const presets = getPresets(self)
	for (const id of [
		'knob_sel_fader',
		'knob_next_fader',
		'knob_gm',
		'push_sel_go',
		'push_sel_flash',
		'sel_prev',
		'sel_next',
		'sel_go',
		'sel_goback',
		'sel_pause',
		'sel_flash',
		'sel_temp',
		'sel_off',
		'q_1',
		'q_101',
		'knob_3',
	]) {
		assert.ok(presets[id], id)
	}
	assert.ok(!presets.q_4)
	assert.match(presets.sel_go.style.text, /\$\(ma2:sel_next\)/)
	assert.equal(presets.knob_sel_fader.options.rotaryActions, true)
	assert.equal(presets.sel_flash.steps[0].up[0].options.state, 'release')
	// every preset action and feedback exists
	const actions = getActions(self)
	const feedbacks = getFeedbacks(self)
	for (const p of Object.values(presets)) {
		for (const s of p.steps) for (const list of Object.values(s)) for (const a of list) assert.ok(actions[a.actionId], a.actionId)
		for (const f of p.feedbacks) assert.ok(feedbacks[f.feedbackId], f.feedbackId)
	}
	const vals = getVariableValues(self)
	assert.equal(vals.exec_2_name, 'Exec 1.2', 'fallback name without the Web Remote')
	assert.equal(vals.exec_2_level, '', 'unknown level is blank')
	assert.equal(vals.telnet, 'ok')
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
