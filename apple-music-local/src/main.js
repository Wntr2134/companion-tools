import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base'
import { Music, fmtTime, permissionHint } from './music.js'
import { withSurfaceExtras } from './surface-extras.js'
import { getViewerPresets } from './viewers.js'
import { markPng, withBrand } from './brand.js'
import { ArtCache, CARD_SHAPES, encodePng, withProgressBar } from './artwork.js'

const RED = combineRgb(250, 45, 72) // Apple Music red (#FA2D48)
const DARK = combineRgb(20, 20, 22)
const WHITE = combineRgb(255, 255, 255)
const VOLUME_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20] // % per click, for the 1-10 step size
const ECHO_GUARD_MS = 1500 // after we change the volume, ignore read-backs this long (Music lags)
const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' }

class AppleMusicInstance extends InstanceBase {
	state = { running: false }
	timer = null
	reading = false
	volTarget = null
	volSetAt = 0
	volSending = false
	playlists = []

	async init(config) {
		this.config = config
		this.music = new Music()
		this.art = new ArtCache({ fetchBytes: () => this.music.artwork(), onReady: () => this.checkFeedbacks('now_playing_art') })
		this.cardPngs = new Map()
		this.updateDefinitions()
		this.clockTimer = setInterval(() => this.tickClock(), 1000)
		this.tickClock()
		this.start()
	}

	tickClock() {
		const now = new Date()
		const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
		if (clock !== this.clock) {
			this.clock = clock
			this.setVariableValues({ clock })
		}
	}

	async configUpdated(config) {
		this.config = config
		this.stop()
		this.start()
	}

	async destroy() {
		this.stop()
		clearInterval(this.clockTimer)
	}

	start() {
		if (process.platform !== 'darwin') {
			this.updateStatus(InstanceStatus.BadConfig, 'Apple Music control works when Companion runs on a Mac')
			return
		}
		const seconds = Number(this.config.poll ?? 1)
		if (seconds > 0) this.timer = setInterval(() => void this.poll(), seconds * 1000)
		void this.poll()
		void this.refreshPlaylists()
	}

	stop() {
		if (this.timer) clearInterval(this.timer)
		this.timer = null
	}

	async poll() {
		if (this.reading) return
		this.reading = true
		try {
			const s = await this.music.read()
			// While the volume knob is turning, keep our own target instead of Music's slightly late value.
			if (this.volTarget !== null && Date.now() - this.volSetAt < ECHO_GUARD_MS) s.volume = this.volTarget
			else this.volTarget = null
			const opened = s.running && !this.state.running
			this.state = s
			this.updateStatus(InstanceStatus.Ok, s.running ? undefined : 'Music is not open')
			this.publish()
			if (opened && !this.playlists.length) void this.refreshPlaylists()
		} catch (e) {
			const why = String(e.message)
			this.updateStatus(InstanceStatus.UnknownWarning, permissionHint(why) || why.split('\n')[0])
			this.log('debug', `Music read failed: ${why}`)
		} finally {
			this.reading = false
		}
	}

	async refreshPlaylists() {
		try {
			const list = await this.music.playlists()
			if (list.length && list.join('\n') !== this.playlists.join('\n')) {
				this.playlists = list
				this.updateDefinitions()
			}
		} catch (e) {
			this.log('debug', `Music playlists: ${e.message}`)
		}
	}

	publish() {
		const s = this.state
		const remaining = s.duration && s.position !== null && s.position !== undefined ? s.duration - s.position : null
		this.setVariableValues({
			status: s.running ? s.status || '' : 'closed',
			track: s.track ?? '',
			artist: s.artist ?? '',
			album: s.album ?? '',
			volume: s.volume ?? '',
			position: fmtTime(s.position),
			duration: fmtTime(s.duration),
			remaining: remaining === null ? '' : `-${fmtTime(remaining)}`,
			time: s.duration ? `${fmtTime(s.position)} / ${fmtTime(s.duration)}` : '',
			shuffle: s.shuffle ? 'ON' : 'OFF',
			repeat: (s.repeat ?? 'off').toUpperCase(),
			favourite: s.favourite ? '♥' : '♡',
			play_icon: s.playing ? '⏸' : '▶',
		})
		this.checkFeedbacks()
	}

	async send(cmd, arg = '') {
		try {
			const r = await this.music.command(cmd, arg)
			if (r === 'NOTRUNNING') this.log('info', 'Music is not open')
			setTimeout(() => void this.poll(), 300)
		} catch (e) {
			const why = String(e.message)
			this.log('error', `Music ${cmd}: ${permissionHint(why) || why}`)
		}
	}

	/** The now-playing card for one key. Only the progress bar changes each second; the rest is cached. */
	drawCard(fb) {
		const { width: w, height: h } = CARD_SHAPES[fb.options?.shape] ?? CARD_SHAPES.square
		const s = this.state
		this.art.want(s.running && s.id ? s.id : '')
		const progress = s.running && s.duration ? (s.position ?? 0) / s.duration : null
		// Re-encode only when what's drawn changes (the bar moves a pixel every few seconds).
		const key = [w, h, this.art.url, !!this.art.art, !!s.playing, progress === null ? '' : Math.round(progress * w)].join('|')
		let png = this.cardPngs.get(key)
		if (!png) {
			png = encodePng(withProgressBar(this.art.background(w, h), w, h, progress, !!s.playing), w, h)
			if (this.cardPngs.size > 8) this.cardPngs.clear()
			this.cardPngs.set(key, png)
		}
		return { png64: png, pngalignment: 'center:center', color: WHITE, show_topbar: false }
	}

	/** Fast knob turns: keep a local target and send it, never more than one set at a time. */
	async stepVolume(delta) {
		const base = this.volTarget ?? this.state.volume ?? 50
		this.volTarget = Math.max(0, Math.min(100, Math.round(base + delta)))
		this.volSetAt = Date.now()
		this.state.volume = this.volTarget
		this.publish()
		if (this.volSending) return
		this.volSending = true
		try {
			let sent
			while (sent !== this.volTarget) {
				sent = this.volTarget
				await this.music.command('volume', String(sent)).catch((e) => this.log('error', `Music volume: ${e.message}`))
				this.volSetAt = Date.now()
			}
		} finally {
			this.volSending = false
		}
	}

	updateDefinitions() {
		const dir = (up = 'Up', down = 'Down') => ({
			type: 'dropdown',
			id: 'direction',
			label: 'Direction',
			default: 'up',
			choices: [
				{ id: 'up', label: up },
				{ id: 'down', label: down },
			],
		})
		const mode = { type: 'dropdown', id: 'mode', label: 'Mode', default: 'toggle', choices: [{ id: 'toggle', label: 'Toggle' }, { id: 'on', label: 'On' }, { id: 'off', label: 'Off' }] }
		const want = (m, current) => (m === 'on' ? true : m === 'off' ? false : !current)

		this.setActionDefinitions({
			playpause: { name: 'Play / pause', options: [], callback: () => this.send('playpause') },
			play: { name: 'Play', options: [], callback: () => this.send('play') },
			pause: { name: 'Pause', options: [], callback: () => this.send('pause') },
			next: { name: 'Next track', options: [], callback: () => this.send('next') },
			previous: { name: 'Previous track', options: [], callback: () => this.send('previous') },
			back: { name: 'Back (restart the track, or previous if near the start)', options: [], callback: () => this.send('back') },
			restart: { name: 'Restart track', options: [], callback: () => this.send('restart') },
			open: { name: 'Open Music', options: [], callback: () => this.send('launch') },
			playlist: {
				name: 'Play a playlist',
				description: 'Pick one of your playlists, or type its name exactly.',
				options: [
					{
						type: 'dropdown',
						id: 'name',
						label: 'Playlist',
						default: this.playlists[0] ?? '',
						allowCustom: true,
						choices: this.playlists.map((n) => ({ id: n, label: n })),
					},
				],
				callback: async (a, ctx) => {
					const name = (await ctx.parseVariablesInString(String(a.options.name ?? ''))).trim()
					if (!name) return this.log('warn', 'Pick a playlist')
					return this.send('playlist', name)
				},
			},
			refresh_playlists: { name: 'Refresh the playlist list', options: [], callback: () => this.refreshPlaylists() },
			volume_step: {
				name: 'Volume: step (knob)',
				options: [
					dir(),
					{
						type: 'dropdown',
						id: 'size',
						label: 'Step size',
						default: 2,
						choices: VOLUME_STEPS.map((pct, i) => ({ id: i + 1, label: `${i + 1} (${pct}%)${i === 1 ? ' default' : ''}` })),
					},
				],
				callback: (a) => {
					const pct = VOLUME_STEPS[(Number(a.options.size) || 2) - 1] ?? 3
					return this.stepVolume(a.options.direction === 'down' ? -pct : pct)
				},
			},
			volume_set: {
				name: 'Volume: set',
				options: [{ type: 'number', id: 'volume', label: 'Volume (0-100)', default: 50, min: 0, max: 100 }],
				callback: (a) => this.send('volume', String(a.options.volume)),
			},
			seek_step: {
				name: 'Seek: step (knob)',
				options: [dir('Forward', 'Back'), { type: 'number', id: 'seconds', label: 'Seconds per click', default: 5, min: 1, max: 60 }],
				callback: (a) => this.send('seekby', String((a.options.direction === 'down' ? -1 : 1) * (Number(a.options.seconds) || 5))),
			},
			shuffle: { name: 'Shuffle', options: [mode], callback: (a) => this.send('shuffle', String(want(a.options.mode, this.state.shuffle))) },
			repeat: {
				name: 'Repeat',
				options: [
					{
						type: 'dropdown',
						id: 'mode',
						label: 'Mode',
						default: 'cycle',
						choices: [
							{ id: 'cycle', label: 'Cycle: off → all → one' },
							{ id: 'off', label: 'Off' },
							{ id: 'all', label: 'All' },
							{ id: 'one', label: 'One' },
						],
					},
				],
				callback: (a) => this.send('repeat', a.options.mode === 'cycle' ? REPEAT_NEXT[this.state.repeat ?? 'off'] : a.options.mode),
			},
			favourite: { name: 'Favourite the current song', options: [mode], callback: (a) => this.send('favourite', String(want(a.options.mode, this.state.favourite))) },
		})

		// When a key lights up red, the mark behind it turns white so it still shows.
		const ON = { bgcolor: RED, color: WHITE, png64: markPng([255, 255, 255], 0.2) }
		this.setFeedbackDefinitions({
			playing: { type: 'boolean', name: 'Playing', defaultStyle: { bgcolor: RED, color: WHITE }, options: [], callback: () => !!this.state.playing },
			shuffle: { type: 'boolean', name: 'Shuffle on', defaultStyle: { bgcolor: RED, color: WHITE }, options: [], callback: () => !!this.state.shuffle },
			repeat: { type: 'boolean', name: 'Repeat on (all or one)', defaultStyle: { bgcolor: RED, color: WHITE }, options: [], callback: () => this.state.repeat === 'all' || this.state.repeat === 'one' },
			favourite: { type: 'boolean', name: 'Current song is a favourite', defaultStyle: { bgcolor: RED, color: WHITE }, options: [], callback: () => !!this.state.favourite },
			now_playing_art: {
				type: 'advanced',
				name: 'Now playing card (album art + progress bar)',
				description: 'Album art (darkened, blurred) behind the key text, with a progress bar.',
				options: [
					{
						type: 'dropdown',
						id: 'shape',
						label: 'Key shape',
						default: 'square',
						choices: [
							{ id: 'square', label: 'Normal key' },
							{ id: 'wide', label: 'D200X wide key' },
						],
					},
				],
				callback: (fb) => this.drawCard(fb),
			},
			closed: { type: 'boolean', name: 'Music is closed', defaultStyle: { bgcolor: DARK, color: combineRgb(150, 150, 150) }, options: [], callback: () => !this.state.running },
		})

		this.setVariableDefinitions([
			{ variableId: 'status', name: 'playing / paused / stopped / closed' },
			{ variableId: 'track', name: 'Track' },
			{ variableId: 'artist', name: 'Artist' },
			{ variableId: 'album', name: 'Album' },
			{ variableId: 'volume', name: 'Music volume 0-100' },
			{ variableId: 'position', name: 'Position' },
			{ variableId: 'duration', name: 'Length' },
			{ variableId: 'remaining', name: 'Time left' },
			{ variableId: 'time', name: 'Position / length' },
			{ variableId: 'shuffle', name: 'Shuffle ON/OFF' },
			{ variableId: 'repeat', name: 'Repeat OFF/ALL/ONE' },
			{ variableId: 'favourite', name: '♥ when the song is a favourite, else ♡' },
			{ variableId: 'clock', name: 'Time now (HH:MM)' },
			{ variableId: 'play_icon', name: '▶ or ⏸ for the play/pause key' },
		])

		const label = this.label || 'apple-music-local'
		const v = (id) => `$(${label}:${id})`
		const key = (category, name, text, down, feedbacks = [], size = '14') => ({
			type: 'button',
			category,
			name,
			style: { text, size, color: WHITE, bgcolor: DARK, show_topbar: false },
			steps: [{ down, up: [] }],
			feedbacks,
		})
		const lit = (feedbackId) => [{ feedbackId, options: {}, style: ON }]
		const knob = (name, text, down, left, right, feedbacks = []) => ({
			type: 'button',
			category: 'Knobs',
			name,
			options: { rotaryActions: true },
			style: { text, size: '14', color: WHITE, bgcolor: DARK, show_topbar: false },
			steps: [{ down, up: [], rotate_left: left, rotate_right: right }],
			feedbacks,
		})
		const play = [{ actionId: 'playpause', options: {} }]
		const presets = {
			playpause: key('Transport', 'Play / pause', v('play_icon'), play, lit('playing'), '24'),
			previous: key('Transport', 'Previous', '⏮', [{ actionId: 'back', options: {} }], [], '24'),
			next: key('Transport', 'Next', '⏭', [{ actionId: 'next', options: {} }], [], '24'),
			shuffle: key('Transport', 'Shuffle', 'SHUFFLE', [{ actionId: 'shuffle', options: { mode: 'toggle' } }], lit('shuffle')),
			repeat: key('Transport', 'Repeat (off → all → one)', `REPEAT\\n${v('repeat')}`, [{ actionId: 'repeat', options: { mode: 'cycle' } }], lit('repeat')),
			favourite: key('Transport', 'Favourite the current song', `${v('favourite')}\\nFAVE`, [{ actionId: 'favourite', options: { mode: 'toggle' } }], lit('favourite')),
			open: key('Transport', 'Open Music', 'OPEN\\nMUSIC', [{ actionId: 'open', options: {} }], [{ feedbackId: 'closed', options: {} }]),
			now: key('Now playing', 'Track and artist (album art)', `${v('track')}\\n${v('artist')}`, [], [{ feedbackId: 'now_playing_art', options: { shape: 'square' } }], 'auto'),
			time: key('Now playing', 'Time', v('time'), [], lit('playing'), 'auto'),
			volume_knob: knob(
				'Volume knob (push = play/pause)',
				`VOL\\n${v('volume')}%`,
				play,
				[{ actionId: 'volume_step', options: { direction: 'down', size: 2 } }],
				[{ actionId: 'volume_step', options: { direction: 'up', size: 2 } }],
				lit('playing'),
			),
			track_knob: knob(
				'Track knob (turn = previous/next, push = play/pause)',
				`TRACK\\n${v('play_icon')}`,
				play,
				[{ actionId: 'back', options: {} }],
				[{ actionId: 'next', options: {} }],
				lit('playing'),
			),
			seek_knob: knob(
				'Seek knob (5 s per click, push = restart track)',
				`SEEK\\n${v('position')}`,
				[{ actionId: 'restart', options: {} }],
				[{ actionId: 'seek_step', options: { direction: 'down', seconds: 5 } }],
				[{ actionId: 'seek_step', options: { direction: 'up', seconds: 5 } }],
			),
		}
		// One key per playlist (up to 24), and one to edit by hand.
		this.playlists.slice(0, 24).forEach((name, i) => {
			presets[`playlist_${i}`] = key('Playlists', name, name.length > 18 ? `${name.slice(0, 17)}…` : name, [{ actionId: 'playlist', options: { name } }], [], 'auto')
		})
		presets.playlist_any = key('Playlists', 'Play a playlist (pick it in the action)', 'PLAYLIST', [{ actionId: 'playlist', options: { name: this.playlists[0] ?? '' } }])
		// − / + keys and push keys for Stream Decks without dials, and the D200X's push row.
		// Every key gets the Apple Music note behind its label, to tell it apart from other apps' keys.
		this.setPresetDefinitions(withBrand(withSurfaceExtras({ ...presets, ...getViewerPresets(this) })))
		this.publish()
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'What this controls',
				value:
					"Apple's Music app on the Mac running Companion. No Apple login needed. The first time, macOS asks to let Companion control Music: click OK (or turn it on in System Settings → Privacy &amp; Security → Automation). Mac only.",
			},
			{ type: 'number', id: 'poll', label: 'Check Music every (seconds, 0 = off)', width: 6, default: 1, min: 0, max: 30 },
		]
	}
}

runEntrypoint(AppleMusicInstance, [])
