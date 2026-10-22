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
