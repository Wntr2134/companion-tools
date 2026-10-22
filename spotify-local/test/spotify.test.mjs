// Run with: node --test test/spotify.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Spotify, parseMacState, parseWinState, toSpotifyUri, fmtTime, permissionHint, MAC_COMMAND, MAC_READ, WIN_KEY } from '../src/spotify.js'

const fakeExec = (reply) => {
	const calls = []
	const exec = (file, args, opts, cb) => {
		calls.push({ file, args, env: opts.env })
		setImmediate(() => cb(null, typeof reply === 'function' ? reply(file, args) : reply, ''))
	}
	return { calls, exec }
}

test('Mac: reads state and the current track (duration in ms, comma decimals tolerated)', () => {
	const s = parseMacState('playing\t65\ttrue\tfalse\t83,4\tWalk-In Song\tSome Band\tThe Album\t215000\tspotify:track:abc\thttps://i.scdn.co/image/x\n')
	assert.deepEqual(s, {
		running: true,
		playing: true,
		status: 'playing',
		volume: 65,
		shuffle: true,
		repeat: false,
		position: 83.4,
		track: 'Walk-In Song',
		artist: 'Some Band',
		album: 'The Album',
		duration: 215,
		uri: 'spotify:track:abc',
		artwork: 'https://i.scdn.co/image/x',
	})
	assert.deepEqual(parseMacState('NOTRUNNING\n'), { running: false })
	assert.equal(parseMacState('paused\t40\tfalse\tfalse\t0').track, undefined, 'no track loaded is fine')
})

test('Mac: reading never starts Spotify; commands pass the argument separately', async () => {
	assert.match(MAC_READ, /if application "Spotify" is not running then return "NOTRUNNING"/)
	assert.match(MAC_COMMAND, /starters does not contain cmd then return "NOTRUNNING"/)
	const { calls, exec } = fakeExec('OK\n')
	const sp = new Spotify({ platform: 'darwin', exec })
	assert.equal(await sp.command('uri', 'spotify:playlist:123" & do shell script "rm'), 'OK')
	assert.deepEqual(calls[0].args.slice(0, 2), ['-e', MAC_COMMAND])
	assert.deepEqual(calls[0].args.slice(2), ['uri', 'spotify:playlist:123" & do shell script "rm'], 'the odd link is data, not script')
	await sp.command('volume', '70')
	assert.deepEqual(calls[1].args.slice(2), ['volume', '70'])
})

test('Windows: media keys, the track from the window title, nothing unsupported', async () => {
	assert.deepEqual(parseWinState('TITLE:Some Band - Walk-In Song\r\n'), { running: true, playing: true, status: 'playing', artist: 'Some Band', track: 'Walk-In Song' })
	assert.equal(parseWinState('TITLE:Spotify Premium').playing, false)
	assert.equal(parseWinState('TITLE:Spotify Free').playing, false)
	assert.equal(parseWinState('RUNNING').running, true)
	assert.deepEqual(parseWinState('NOTRUNNING'), { running: false })
	const { calls, exec } = fakeExec('OK\r\n')
	const sp = new Spotify({ platform: 'win32', exec })
	await sp.command('next')
	assert.equal(calls[0].file, 'powershell.exe')
	assert.equal(calls[0].args.at(-1), WIN_KEY)
	assert.equal(calls[0].env.SP_VK, String(0xb0))
	await assert.rejects(sp.command('shuffle', 'true'), /isn't available on Windows/)
	await assert.rejects(sp.command('uri', 'spotify:x; calc'), /Not a Spotify link/)
	await sp.command('uri', 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')
	assert.deepEqual([calls.at(-1).file, calls.at(-1).args], ['explorer.exe', ['spotify:playlist:37i9dQZF1DXcBWIGoYBM5M']])
})

test('links, times and permission messages', () => {
	assert.equal(toSpotifyUri('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'), 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')
	assert.equal(toSpotifyUri('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC'), 'spotify:track:4uLU6hMCjMI75M1A2tKUQC')
	assert.equal(toSpotifyUri('spotify:album:1'), 'spotify:album:1')
	assert.equal(toSpotifyUri('https://example.com'), '')
	assert.equal(fmtTime(83.4), '1:23')
	assert.equal(fmtTime(null), '')
	assert.match(permissionHint('Not authorized to send Apple events to Spotify. (-1743)'), /Automation/)
})

test('surface extras: the volume knob also gets − / + keys and a push key', async () => {
	const { withSurfaceExtras } = await import('../src/surface-extras.js')
	const out = withSurfaceExtras({
		k: {
			type: 'button',
			category: 'Knobs',
			name: 'Volume knob',
			options: { rotaryActions: true },
			style: { text: 'VOL' },
			steps: [{ down: [{ actionId: 'playpause' }], up: [], rotate_left: [{ actionId: 'volume_step' }], rotate_right: [{ actionId: 'volume_step' }] }],
			feedbacks: [],
		},
	})
	assert.deepEqual(Object.keys(out).sort(), ['k', 'k__minus', 'k__plus', 'k__push'])
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

test('now-playing card: cover decoded, cropped to the key, darkened, progress bar drawn', async () => {
	const jpeg = (await import('jpeg-js')).default
	const { ArtCache, decodeArt, coverScale, withProgressBar, cardBackground, smallerArtUrl, SPOTIFY_GREEN } = await import('../src/artwork.js')
	// a 64×64 test cover: left half red, right half blue
	const raw = Buffer.alloc(64 * 64 * 4)
	for (let y = 0; y < 64; y++)
		for (let x = 0; x < 64; x++) {
			const i = (y * 64 + x) * 4
			raw[i] = x < 32 ? 255 : 0
			raw[i + 2] = x < 32 ? 0 : 255
			raw[i + 3] = 255
		}
	const bytes = jpeg.encode({ data: raw, width: 64, height: 64 }, 95).data
	const art = decodeArt(bytes)
	assert.deepEqual([art.width, art.height], [64, 64])

	// wide key 458×196: cover crop keeps the middle, so the left edge is red and the right edge blue
	const scaled = coverScale(art, 458, 196)
	assert.ok(scaled[0] > 200 && scaled[2] < 60, 'left edge red')
	const r = (196 * 458 - 1) * 3
	assert.ok(scaled[r + 2] > 200 && scaled[r] < 60, 'right edge blue')

	const bg = cardBackground(art, 72, 72)
	assert.ok(bg[0] < 255 * 0.5, 'darkened so white text reads')

	const card = withProgressBar(bg, 72, 72, 0.5, true)
	const bottomLeft = ((72 - 1) * 72 + 0) * 3
	assert.deepEqual([...card.slice(bottomLeft, bottomLeft + 3)], SPOTIFY_GREEN, 'played part is Spotify green')
	const bottomRight = ((72 - 1) * 72 + 71) * 3
	assert.notDeepEqual([...card.slice(bottomRight, bottomRight + 3)], SPOTIFY_GREEN, 'unplayed part is not')
	const paused = withProgressBar(bg, 72, 72, 0.5, false)
	assert.notDeepEqual([...paused.slice(bottomLeft, bottomLeft + 3)], SPOTIFY_GREEN, 'grey while paused')
	assert.deepEqual(withProgressBar(bg, 72, 72, null, true), Uint8Array.from(bg), 'no bar without a track')

	// cache: fetches once per cover, falls back to Spotify black meanwhile, then redraws
	let fetched = 0
	let ready = 0
	const cache = new ArtCache({ fetchBytes: async () => (fetched++, bytes), onReady: () => ready++ })
	assert.equal(cache.want('https://i.scdn.co/image/ab67616d0000b273abc'), null)
	assert.equal(cache.background(10, 10)[0], 18 + 14, 'plain Spotify background until the cover arrives')
	await new Promise((res) => setImmediate(res))
	assert.equal(ready, 1)
	assert.ok(cache.want('https://i.scdn.co/image/ab67616d0000b273abc'))
	assert.equal(fetched, 1, 'same cover is not fetched again')
	assert.equal(smallerArtUrl('https://i.scdn.co/image/ab67616d0000b273abc'), 'https://i.scdn.co/image/ab67616d00001e02abc')
})

test('now-playing card goes under the text as a PNG, at the shape picked (Companion reports 72×58 for every key)', async () => {
	const { inflateSync } = await import('node:zlib')
	const { encodePng, CARD_SHAPES } = await import('../src/artwork.js')
	const { getViewerPresets } = await import('../src/viewers.js')
	const w = 3
	const h = 2
	const rgb = Uint8Array.from({ length: w * h * 3 }, (_, i) => i * 10)
	const png = Buffer.from(encodePng(rgb, w, h), 'base64')
	assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	assert.equal(png.readUInt32BE(16), w)
	assert.equal(png.readUInt32BE(20), h)
	const idatLen = png.readUInt32BE(33)
	assert.equal(png.toString('ascii', 37, 41), 'IDAT')
	const rows = inflateSync(png.subarray(41, 41 + idatLen))
	assert.deepEqual([...rows.subarray(1, 1 + w * 3)], [...rgb.subarray(0, w * 3)], 'first row round-trips')

	// the wide shape matches the D200X wide key (458×196), so Companion's "fit" fills it
	assert.ok(Math.abs(CARD_SHAPES.wide.width / CARD_SHAPES.wide.height - 458 / 196) < 0.01)
	assert.equal(CARD_SHAPES.square.width, CARD_SHAPES.square.height)
	const viewers = getViewerPresets({ label: 'x' })
	for (const p of Object.values(viewers)) {
		for (const fb of p.feedbacks) if (fb.feedbackId === 'now_playing_art') assert.equal(fb.options.shape, 'wide')
		assert.ok(!p.style.text.includes('$(internal:'), 'internal variables show $NA in the presets list')
	}
})

test('branding: the Spotify mark goes behind every key that has no image of its own', async () => {
	const { withBrand, markCoverage, markPng } = await import('../src/brand.js')
	const cov = markCoverage(72)
	assert.equal(cov[0], 0, 'corners are clear')
	assert.ok(cov[36 * 72 + 8] > 0.9, 'the circle fills the middle row')
	const arcsCut = [...cov].filter((c) => c === 0).length
	assert.ok(arcsCut > 72 * 72 * 0.5 - 1, 'transparent outside the circle and in the arcs')
	const png = Buffer.from(markPng(), 'base64')
	assert.equal(png[25], 6, 'RGBA, so the key colour shows through')

	const out = withBrand({
		a: { type: 'button', style: { text: 'A' }, feedbacks: [] },
		b: { type: 'button', style: { text: 'B', png64: 'x' }, feedbacks: [] },
	})
	assert.ok(out.a.style.png64.length > 100)
	assert.equal(out.b.style.png64, 'x', 'a key with its own image keeps it')
})
