// Apple Music module tests. The Music app is faked: these check the scripts, parsing and presets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Music, parseState, parsePlaylists, MAC_READ, MAC_COMMAND, MAC_ARTWORK, permissionHint } from '../src/music.js'

const fakeExec = (reply, calls = []) => (file, args, opts, cb) => {
	calls.push({ file, args })
	setImmediate(() => cb(null, typeof reply === 'function' ? reply(file, args) : reply, ''))
}

test('reads state, the current track and favourites (comma decimals tolerated)', () => {
	const s = parseState('playing\t64\ttrue\tall\t83,5\tBlinding Lights\tThe Weeknd\tAfter Hours\t200,04\tABC123\ttrue\n')
	assert.deepEqual(s, {
		running: true,
		playing: true,
		status: 'playing',
		volume: 64,
		shuffle: true,
		repeat: 'all',
		position: 83.5,
		track: 'Blinding Lights',
		artist: 'The Weeknd',
		album: 'After Hours',
		duration: 200.04,
		id: 'ABC123',
		favourite: true,
	})
	assert.deepEqual(parseState('NOTRUNNING'), { running: false })
	const stopped = parseState('stopped\t50\tfalse\toff\t')
	assert.equal(stopped.track, undefined)
	assert.equal(stopped.repeat, 'off')
	// radio: the song is the stream title, the station goes in the artist line
	const radio = parseState('playing\t50\tfalse\toff\t10\tApple Music 1\t\t\t0\tR1\tfalse\tSong - Singer')
	assert.equal(radio.track, 'Song - Singer')
	assert.equal(radio.artist, 'Apple Music 1')
	assert.equal(radio.duration, null)
})

test('reading never starts Music; commands pass the argument separately', async () => {
	assert.match(MAC_READ, /if application "Music" is not running then return "NOTRUNNING"/)
	assert.match(MAC_COMMAND, /set starters to \{"play", "playpause", "playlist", "launch"\}/)
	assert.match(MAC_ARTWORK, /raw data of artwork 1 of current track/)
	const calls = []
	const m = new Music({ exec: fakeExec('OK\n', calls) })
	assert.equal(await m.command('playlist', 'Walk-in "mix"'), 'OK')
	assert.deepEqual(calls[0].args.slice(2), ['playlist', 'Walk-in "mix"'])
	await assert.rejects(m.command('rm -rf', ''), /Unknown command/)
})

test('playlists: one per line, duplicates dropped', async () => {
	assert.deepEqual(parsePlaylists('Walk-in\nInterval\n\nWalk-in\n'), ['Walk-in', 'Interval'])
	assert.deepEqual(parsePlaylists('NOTRUNNING'), [])
	const m = new Music({ exec: fakeExec('A\nB\n') })
	assert.deepEqual(await m.playlists(), ['A', 'B'])
})

test('artwork: saved by Music, made a small JPEG by sips, temp files cleaned up', async () => {
	const { writeFile, access } = await import('node:fs/promises')
	const { tmpdir } = await import('node:os')
	const { join } = await import('node:path')
	const base = join(tmpdir(), `am-test-${process.pid}`)
	const calls = []
	const m = new Music({
		artPath: base,
		exec: (file, args, opts, cb) => {
			calls.push(file)
			if (file === 'sips') writeFile(args.at(-1), Buffer.from([0xff, 0xd8, 0xff])).then(() => cb(null, '', ''))
			else setImmediate(() => cb(null, 'OK\n', ''))
		},
	})
	const bytes = await m.artwork()
	assert.deepEqual([...bytes], [0xff, 0xd8, 0xff])
	assert.deepEqual(calls, ['osascript', 'sips'])
	await assert.rejects(access(`${base}.jpg`), 'cleaned up')
	const none = new Music({ artPath: base, exec: fakeExec('NOART\n') })
	await assert.rejects(none.artwork(), /no artwork/)
	assert.match(permissionHint('execution error: Not authorized to send Apple events to Music. (-1743)'), /Automation/)
})

test('surface extras: knobs also get − / + keys and a push key', async () => {
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

test('wide key viewers: display only, wide card, short enough for a normal key too', async () => {
	const { getViewerPresets } = await import('../src/viewers.js')
	const presets = getViewerPresets({ label: 'x' })
	assert.ok(Object.keys(presets).length > 0)
	for (const p of Object.values(presets)) {
		assert.equal(p.category, 'Wide key viewers')
		assert.deepEqual(p.steps, [{ down: [], up: [] }], 'viewers never do anything when pressed')
		assert.equal(p.style.size, 'auto')
		assert.ok(p.style.text.split('\\n').length <= 3, `at most 3 lines: ${p.name}`)
		assert.ok(!p.style.text.includes('$(internal:'), 'internal variables show $NA in the presets list')
		for (const fb of p.feedbacks) if (fb.feedbackId === 'now_playing_art') assert.equal(fb.options.shape, 'wide')
	}
})

test('now-playing card: art cache keyed by track, plain background without a cover', async () => {
	const { ArtCache, CARD_SHAPES, withProgressBar, MUSIC_RED } = await import('../src/artwork.js')
	const jpeg = (await import('jpeg-js')).default
	const raw = Buffer.alloc(16 * 16 * 4, 200)
	const bytes = jpeg.encode({ data: raw, width: 16, height: 16 }, 90).data
	let fetched = 0
	let ready = 0
	const cache = new ArtCache({ fetchBytes: async () => (fetched++, bytes), onReady: () => ready++ })
	assert.equal(cache.want('TRACK1'), null)
	await new Promise((res) => setImmediate(res))
	assert.equal(ready, 1)
	assert.ok(cache.want('TRACK1'))
	assert.equal(fetched, 1, 'same track is not fetched again')
	const { width: w, height: h } = CARD_SHAPES.wide
	assert.ok(Math.abs(w / h - 458 / 196) < 0.01)
	const card = withProgressBar(cache.background(w, h), w, h, 0.5, true)
	assert.deepEqual([...card.slice((h - 1) * w * 3, (h - 1) * w * 3 + 3)], MUSIC_RED, 'played part is Apple Music red')
	const failing = new ArtCache({ fetchBytes: async () => Promise.reject(new Error('no artwork')) })
	failing.want('T2')
	await new Promise((res) => setImmediate(res))
	assert.equal(failing.art, null)
})

test('branding: a red note behind every key that has no image of its own', async () => {
	const { withBrand, markCoverage, markPng } = await import('../src/brand.js')
	const cov = markCoverage(72)
	assert.equal(cov[0], 0, 'corners are clear')
	const filled = [...cov].filter((c) => c > 0.5).length
	assert.ok(filled > 72 * 72 * 0.08 && filled < 72 * 72 * 0.4, 'a note, not a block')
	assert.equal(Buffer.from(markPng(), 'base64')[25], 6, 'RGBA, so the key colour shows through')
	const out = withBrand({ a: { style: { text: 'A' } }, b: { style: { text: 'B', png64: 'x' } } })
	assert.ok(out.a.style.png64.length > 100)
	assert.equal(out.b.style.png64, 'x')
})

test('viewers never go blank: a clock and date (or the idle lines) when nothing is playing', async () => {
	const { cardLines, IDLE_DEFAULTS } = await import('../src/viewers.js')
	const idle = { line1: '14:05', line2: 'Wednesday 22 October' }
	const closed = cardLines({ running: false }, idle)
	assert.equal(closed.card_line1, '14:05')
	assert.equal(closed.card_line2, 'Wednesday 22 October')
	assert.equal(closed.card_artist, '')
	const playing = cardLines({ running: true, track: 'Song', artist: 'Band', time: '0:10 / 3:00' }, idle)
	assert.deepEqual([playing.card_line1, playing.card_line2_time], ['Song', 'Band  ·  0:10 / 3:00'])
	assert.match(IDLE_DEFAULTS.idle1, /time_hm/)
})

test('every on/off feedback in a preset carries a style (without one, Companion 5.1 blanks the key)', async () => {
	const { readFile } = await import('node:fs/promises')
	const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8')
	for (const m of src.matchAll(/\{ feedbackId: '(\w+)', options: \{[^}]*\}( \})?/g)) {
		if (m[1] === 'now_playing_art') continue // advanced: draws its own style
		assert.ok(!m[2], `preset feedback "${m[1]}" has no style`)
	}
})
