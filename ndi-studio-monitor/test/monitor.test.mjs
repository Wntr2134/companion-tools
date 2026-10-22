// Run with: node --test test/monitor.test.mjs
// A fake Studio Monitor web server with digest auth (empty realm, like the real one).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { StudioMonitorClient, parseChallenge, digestHeader, AuthError } from '../src/client.js'

const md5 = (s) => createHash('md5').update(s).digest('hex')
const sm = {
	sources: ['STUDIO-PC (Cam 1)', 'STUDIO-PC (Cam 2)', 'GFX (Lower third)'],
	config: { version: 1, NDI_source: '', NDI_overlay: '', decorations: { picture_in_picture: true, mute_audio: false } },
	rec: { recording: false, duration: 0 },
	posts: [],
	nonce: 'abc123',
	requireAuth: true,
}

function authorised(req) {
	if (!sm.requireAuth) return true
	const h = req.headers.authorization
	if (!h) return false
	const p = parseChallenge(h)
	const ha1 = md5(`admin::admin`)
	const ha2 = md5(`${req.method}:${p.uri}`)
	const expected = p.qop ? md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`)
	return p.nonce === sm.nonce && p.response === expected && p.realm === ''
}

let server
before(async () => {
	server = http.createServer((req, res) => {
		if (!authorised(req)) {
			res.writeHead(401, { 'WWW-Authenticate': `Digest realm="", qop="auth", nonce="${sm.nonce}", opaque="xyz"` })
			return res.end('Unauthorized')
		}
		let body = ''
		req.on('data', (c) => (body += c))
		req.on('end', () => {
			const json = (o) => {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify(o))
			}
			if (req.method === 'GET' && req.url === '/v1/sources') return json({ ndi_sources: sm.sources })
			if (req.method === 'GET' && req.url === '/v1/configuration') return json(sm.config)
			if (req.method === 'GET' && req.url === '/v1/recording') return json(sm.rec)
			if (req.method === 'POST' && req.url === '/v1/configuration') {
				const o = JSON.parse(body)
				sm.posts.push(o)
				const { decorations, ...rest } = o
				Object.assign(sm.config, rest)
				if (decorations) Object.assign(sm.config.decorations, decorations)
				return res.end('Configuration updated.')
			}
			if (req.method === 'POST' && req.url === '/v1/recording') {
				sm.rec.recording = JSON.parse(body).recording
				return res.end('Recording updated.')
			}
			res.writeHead(404)
			res.end()
		})
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
})
after(() => server.close())

const client = (extra = {}) => new StudioMonitorClient({ host: '127.0.0.1', port: server.address().port, ...extra })

test('challenge parsing keeps an empty realm', () => {
	const c = parseChallenge('Digest realm="", qop="auth", nonce="n1", opaque="o"')
	assert.deepEqual(c, { realm: '', qop: 'auth', nonce: 'n1', opaque: 'o' })
	const h = digestHeader({ method: 'GET', uri: '/v1/sources', user: 'admin', pass: 'admin', challenge: c, nc: 1, cnonce: 'cn' })
	assert.match(h, /realm=""/)
	assert.match(h, /nc="00000001"/)
})

test('logs in with digest auth and reads sources, configuration, recording', async () => {
	const c = client()
	assert.deepEqual(await c.sources(), sm.sources)
	assert.equal((await c.configuration()).NDI_source, '')
	assert.equal((await c.recording()).recording, false)
	assert.ok(c.challenge, 'challenge cached for later requests')
})

test('changes the source, overlay, mute and recording', async () => {
	const c = client()
	sm.posts = []
	assert.equal(await c.setConfiguration({ NDI_source: 'STUDIO-PC (Cam 2)' }), 'Configuration updated.')
	await c.setConfiguration({ NDI_overlay: 'GFX (Lower third)', decorations: { picture_in_picture: false } })
	await c.setConfiguration({ decorations: { mute_audio: true } })
	await c.setRecording(true)
	assert.deepEqual(sm.posts[0], { version: 1, NDI_source: 'STUDIO-PC (Cam 2)' })
	assert.equal(sm.config.NDI_source, 'STUDIO-PC (Cam 2)')
	assert.equal(sm.config.NDI_overlay, 'GFX (Lower third)')
	assert.deepEqual(sm.config.decorations, { picture_in_picture: false, mute_audio: true })
	assert.equal(sm.rec.recording, true)
})

test('a new nonce from Studio Monitor is handled; a wrong password is reported', async () => {
	const c = client()
	await c.sources()
	sm.nonce = 'fresh-nonce'
	assert.equal((await c.sources()).length, 3, 'logs in again with the new nonce')
	await assert.rejects(client({ pass: 'wrong' }).sources(), AuthError)
})

test('works when the web password is switched off', async () => {
	sm.requireAuth = false
	const c = client()
	assert.equal((await c.sources()).length, 3)
	assert.equal(c.challenge, null)
	sm.requireAuth = true
})

test('no Studio Monitor running: fails quickly', async () => {
	const c = new StudioMonitorClient({ host: '127.0.0.1', port: 1, timeoutMs: 500 })
	await assert.rejects(c.sources())
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
