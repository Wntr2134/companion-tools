import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base'
import { Spotify, toSpotifyUri, fmtTime, permissionHint } from './spotify.js'
import { withSurfaceExtras } from './surface-extras.js'
import { getViewerPresets, cardLines, IDLE_DEFAULTS } from './viewers.js'
import { markPng, withBrand } from './brand.js'
import { ArtCache, CARD_SHAPES, encodePng, withProgressBar } from './artwork.js'

const GREEN = combineRgb(30, 215, 96) // Spotify green (#1ED760)
const GREY = combineRgb(18, 18, 18) // Spotify black (#121212)
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const VOLUME_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20] // % per click, for the 1-10 step size
const ECHO_GUARD_MS = 1500 // after we change the volume, ignore read-backs this long (Spotify lags)

class SpotifyInstance extends InstanceBase {
	state = { running: false }
	idle = { line1: '', line2: '' }
	timer = null
	reading = false
	volTarget = null
	volSetAt = 0
	volSending = false

	async init(config) {
		this.config = config
		this.spotify = new Spotify()
		this.art = new ArtCache({ onReady: () => this.checkFeedbacks('now_playing_art') })
		this.cardPngs = new Map()
		this.updateDefinitions()
		// Our own clock for the "Clock + now playing" viewer: Companion's $(internal:time_hm) shows $NA
		// in the presets list, and this one works there too.
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
		void this.refreshIdle(now)
	}

	/** What the viewers show when nothing is playing: the idle lines from the settings (a clock and date by default). */
	async refreshIdle(now = new Date()) {
		if (this.state.running && this.state.track) return
		const fallback = {
			line1: this.clock ?? '',
			line2: now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }),
		}
		let line1 = fallback.line1
		let line2 = fallback.line2
		try {
			line1 = await this.parseVariablesInString(String(this.config?.idle1 ?? IDLE_DEFAULTS.idle1))
			line2 = await this.parseVariablesInString(String(this.config?.idle2 ?? IDLE_DEFAULTS.idle2))
		} catch {
			// keep the module's own clock and date
		}
		if (/\$NA/.test(line1)) line1 = fallback.line1
		if (/\$NA/.test(line2)) line2 = fallback.line2
		if (line1 === this.idle.line1 && line2 === this.idle.line2) return
		this.idle = { line1, line2 }
		this.setVariableValues(cardLines(this.state, this.idle))
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

	isMac() {
		return process.platform === 'darwin'
	}

	start() {
		if (process.platform !== 'darwin' && process.platform !== 'win32') {
			this.updateStatus(InstanceStatus.BadConfig, 'Spotify control works when Companion runs on a Mac or Windows PC')
			return
		}
		const seconds = Number(this.config.poll ?? (this.isMac() ? 1 : 3))
		if (seconds > 0) this.timer = setInterval(() => void this.poll(), seconds * 1000)
		void this.poll()
	}

	stop() {
		if (this.timer) clearInterval(this.timer)
		this.timer = null
	}

	async poll() {
		if (this.reading) return
		this.reading = true
		try {
			const s = await this.spotify.read()
			// While the volume knob is turning, keep our own target instead of Spotify's slightly late value.
			if (this.volTarget !== null && Date.now() - this.volSetAt < ECHO_GUARD_MS) s.volume = this.volTarget
			else this.volTarget = null
			this.state = s
			this.updateStatus(InstanceStatus.Ok, s.running ? undefined : 'Spotify is not open')
			this.publish()
		} catch (e) {
			const why = String(e.message)
			this.updateStatus(InstanceStatus.UnknownWarning, permissionHint(why) || why.split('\n')[0])
			this.log('debug', `Spotify read failed: ${why}`)
		} finally {
			this.reading = false
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
			uri: s.uri ?? '',
			artwork_url: s.artwork ?? '',
			volume: s.volume ?? '–',
			position: fmtTime(s.position),
			duration: fmtTime(s.duration),
			remaining: remaining === null ? '' : `-${fmtTime(remaining)}`,
			time: s.duration ? `${fmtTime(s.position)} / ${fmtTime(s.duration)}` : '',
			shuffle: s.shuffle ? 'ON' : 'OFF',
			repeat: s.repeat ? 'ON' : 'OFF',
			play_icon: s.playing ? '⏸' : '▶',
			...cardLines({ ...s, time: s.duration ? `${fmtTime(s.position)} / ${fmtTime(s.duration)}` : '' }, this.idle),
		})
		this.checkFeedbacks()
	}

	async send(cmd, arg = '') {
		try {
			const r = await this.spotify.command(cmd, arg)
			if (r === 'NOTRUNNING') this.log('info', 'Spotify is not open')
			setTimeout(() => void this.poll(), 300)
		} catch (e) {
			const why = String(e.message)
			this.log('error', `Spotify ${cmd}: ${permissionHint(why) || why}`)
		}
	}

	/** The now-playing card for one key. Only the progress bar changes each second; the rest is cached. */
	drawCard(fb) {
		const { width: w, height: h } = CARD_SHAPES[fb.options?.shape] ?? CARD_SHAPES.square
		const s = this.state
		this.art.want(s.running ? s.artwork : '')
		const progress = s.running && s.duration ? (s.position ?? 0) / s.duration : null
		// Re-encode only when what's drawn changes (the bar moves a pixel every few seconds).
		const key = [w, h, this.art.url, !!this.art.art, !!s.playing, progress === null ? '' : Math.round(progress * w)].join('|')
		let png = this.cardPngs.get(key)
		if (!png) {
			png = encodePng(withProgressBar(this.art.background(w, h), w, h, progress, !!s.playing), w, h)
			if (this.cardPngs.size > 8) this.cardPngs.clear()
			this.cardPngs.set(key, png)
		}
		return { png64: png, pngalignment: 'center:center', color: combineRgb(255, 255, 255), show_topbar: false }
	}

	/** Fast knob turns: keep a local target and send it, never more than one set at a time. */
	async stepVolume(delta) {
		if (!this.isMac()) return this.send(delta > 0 ? 'volup' : 'voldown')
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
				await this.spotify.command('volume', String(sent)).catch((e) => this.log('error', `Spotify volume: ${e.message}`))
				this.volSetAt = Date.now()
			}
		} finally {
			this.volSending = false
		}
	}

	updateDefinitions() {
		const mac = this.isMac()
		const sizeOption = {
			type: 'dropdown',
			id: 'size',
			label: 'Step size',
			default: 2,
			choices: VOLUME_STEPS.map((pct, i) => ({ id: i + 1, label: `${i + 1} (${pct}%)${i === 1 ? ' default' : ''}` })),
		}
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

		const actions = {
			playpause: { name: 'Play / pause', options: [], callback: () => this.send('playpause') },
			play: {
				name: 'Play',
				options: [],
				callback: () => (mac ? this.send('play') : this.state.playing ? undefined : this.send('playpause')),
			},
			pause: {
				name: 'Pause',
				options: [],
				callback: () => (mac ? this.send('pause') : this.state.playing ? this.send('playpause') : undefined),
			},
			next: { name: 'Next track', options: [], callback: () => this.send('next') },
			previous: { name: 'Previous track', options: [], callback: () => this.send('previous') },
			open: { name: 'Open Spotify', options: [], callback: () => this.send('launch') },
			play_link: {
				name: 'Play a playlist, album or track (Spotify link)',
				description: 'Paste a Share → Copy link (https://open.spotify.com/…) or a spotify: URI. On Windows it opens it in Spotify.',
				options: [{ type: 'textinput', id: 'link', label: 'Spotify link or URI', default: '', useVariables: true }],
				callback: async (a, ctx) => {
					const uri = toSpotifyUri(await ctx.parseVariablesInString(String(a.options.link ?? '')))
					if (!uri) return this.log('warn', "That isn't a Spotify link")
					return this.send('uri', uri)
				},
			},
			volume_step: {
				name: mac ? 'Volume: step (knob)' : 'System volume: step (Windows volume keys)',
				options: [dir(), sizeOption],
				callback: (a) => {
					const pct = VOLUME_STEPS[(Number(a.options.size) || 2) - 1] ?? 3
					return this.stepVolume(a.options.direction === 'down' ? -pct : pct)
				},
			},
		}
		if (mac) {
			Object.assign(actions, {
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
				restart: { name: 'Restart track', options: [], callback: () => this.send('restart') },
				shuffle: { name: 'Shuffle', options: [mode], callback: (a) => this.send('shuffle', String(want(a.options.mode, this.state.shuffle))) },
				repeat: { name: 'Repeat', options: [mode], callback: (a) => this.send('repeat', String(want(a.options.mode, this.state.repeat))) },
			})
		} else {
			actions.mute = { name: 'System mute (Windows mute key)', options: [], callback: () => this.send('mute') }
		}
		this.setActionDefinitions(actions)

		this.setFeedbackDefinitions({
			playing: { type: 'boolean', name: 'Playing', defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [], callback: () => !!this.state.playing },
			shuffle: { type: 'boolean', name: 'Shuffle on (Mac)', defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [], callback: () => !!this.state.shuffle },
			repeat: { type: 'boolean', name: 'Repeat on (Mac)', defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [], callback: () => !!this.state.repeat },
			now_playing_art: {
				type: 'advanced',
				name: 'Now playing card (album art + progress bar)',
				description: 'Album art (darkened, blurred) behind the key text, with a progress bar. Mac shows the cover; Windows uses Spotify black.',
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
			closed: { type: 'boolean', name: 'Spotify is closed', defaultStyle: { bgcolor: GREY, color: combineRgb(150, 150, 150) }, options: [], callback: () => !this.state.running },
		})

		this.setVariableDefinitions([
			{ variableId: 'status', name: 'playing / paused / stopped / closed' },
			{ variableId: 'track', name: 'Track' },
			{ variableId: 'artist', name: 'Artist' },
			{ variableId: 'album', name: 'Album (Mac)' },
			{ variableId: 'uri', name: 'Track URI (Mac)' },
			{ variableId: 'artwork_url', name: 'Album art URL (Mac)' },
			{ variableId: 'volume', name: 'Spotify volume 0-100 (Mac)' },
			{ variableId: 'position', name: 'Position (Mac)' },
			{ variableId: 'duration', name: 'Length (Mac)' },
			{ variableId: 'remaining', name: 'Time left (Mac)' },
			{ variableId: 'time', name: 'Position / length (Mac)' },
			{ variableId: 'shuffle', name: 'Shuffle ON/OFF (Mac)' },
			{ variableId: 'repeat', name: 'Repeat ON/OFF (Mac)' },
			{ variableId: 'clock', name: 'Time now (HH:MM)' },
			{ variableId: 'card_line1', name: 'Viewers: track, or idle line 1 (clock) when nothing is playing' },
			{ variableId: 'card_line2', name: 'Viewers: artist, or idle line 2 (date) when nothing is playing' },
			{ variableId: 'card_line2_time', name: 'Viewers: artist · time, or idle line 2' },
			{ variableId: 'card_track_or_date', name: 'Viewers: track, or idle line 2' },
			{ variableId: 'card_artist', name: 'Viewers: artist, or blank' },
			{ variableId: 'play_icon', name: '▶ or ⏸ for the play/pause key' },
		])

		const label = this.label || 'spotify-local'
		const v = (id) => `$(${label}:${id})`
		const key = (category, name, text, down, feedbacks = [], size = '14') => ({
			type: 'button',
			category,
			name,
			style: { text, size, color: WHITE, bgcolor: GREY, show_topbar: false },
			steps: [{ down, up: [] }],
			feedbacks,
		})
		// When a key lights up green, the mark behind it turns dark so it still shows.
		const ON = { bgcolor: GREEN, color: BLACK, png64: markPng([0, 0, 0], 0.16) }
		const playingFb = [{ feedbackId: 'playing', options: {}, style: ON }]
		const presets = {
			playpause: key('Transport', 'Play / pause', v('play_icon'), [{ actionId: 'playpause', options: {} }], playingFb, '24'),
			previous: key('Transport', 'Previous', '⏮', [{ actionId: 'previous', options: {} }], [], '24'),
			next: key('Transport', 'Next', '⏭', [{ actionId: 'next', options: {} }], [], '24'),
			now: {
				...key('Now playing', 'Track and artist (album art)', `${v('card_line1')}\\n${v('card_line2')}`, [], [{ feedbackId: 'now_playing_art', options: { shape: 'square' } }], 'auto'),
			},
			open: key('Transport', 'Open Spotify', 'OPEN\\nSPOTIFY', [{ actionId: 'open', options: {} }], [{ feedbackId: 'closed', options: {}, style: { color: combineRgb(150, 150, 150) } }]),
			link: key('Playlists', 'Play a playlist (edit the link)', 'PLAYLIST', [{ actionId: 'play_link', options: { link: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' } }]),
			volume_knob: {
				type: 'button',
				category: 'Knobs',
				name: mac ? 'Volume knob (push = play/pause)' : 'System volume knob (push = play/pause)',
				options: { rotaryActions: true },
				style: { text: mac ? `VOL\\n${v('volume')}%` : 'VOLUME', size: '14', color: WHITE, bgcolor: GREY, show_topbar: false },
				steps: [
					{
						down: [{ actionId: 'playpause', options: {} }],
						up: [],
						rotate_left: [{ actionId: 'volume_step', options: { direction: 'down', size: 2 } }],
						rotate_right: [{ actionId: 'volume_step', options: { direction: 'up', size: 2 } }],
					},
				],
				feedbacks: playingFb,
			},
			track_knob: {
				type: 'button',
				category: 'Knobs',
				name: 'Track knob (turn = previous/next, push = play/pause)',
				options: { rotaryActions: true },
				style: { text: `TRACK\\n${v('play_icon')}`, size: '14', color: WHITE, bgcolor: GREY, show_topbar: false },
				steps: [
					{
						down: [{ actionId: 'playpause', options: {} }],
						up: [],
						rotate_left: [{ actionId: 'previous', options: {} }],
						rotate_right: [{ actionId: 'next', options: {} }],
					},
				],
				feedbacks: playingFb,
			},
		}
		if (mac) {
			presets.time = key('Now playing', 'Time', v('time'), [], playingFb, 'auto')
			presets.shuffle = key('Transport', 'Shuffle', 'SHUFFLE', [{ actionId: 'shuffle', options: { mode: 'toggle' } }], [{ feedbackId: 'shuffle', options: {}, style: ON }])
			presets.repeat = key('Transport', 'Repeat', 'REPEAT', [{ actionId: 'repeat', options: { mode: 'toggle' } }], [{ feedbackId: 'repeat', options: {}, style: ON }])
			presets.seek_knob = {
				type: 'button',
				category: 'Knobs',
				name: 'Seek knob (5 s per click, push = restart track)',
				options: { rotaryActions: true },
				style: { text: `SEEK\\n${v('position')}`, size: '14', color: WHITE, bgcolor: GREY, show_topbar: false },
				steps: [
					{
						down: [{ actionId: 'restart', options: {} }],
						up: [],
						rotate_left: [{ actionId: 'seek_step', options: { direction: 'down', seconds: 5 } }],
						rotate_right: [{ actionId: 'seek_step', options: { direction: 'up', seconds: 5 } }],
					},
				],
				feedbacks: [],
			}
		}
		// − / + keys and push keys for Stream Decks without dials, and the D200X's push row.
		// Every key gets the Spotify mark behind its label, to tell it apart from other apps' keys.
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
					'The Spotify app on the computer running Companion. No Spotify login needed.<br><b>Mac:</b> full control and now-playing info. The first time, macOS asks to let Companion control Spotify: click OK (or turn it on in System Settings → Privacy &amp; Security → Automation).<br><b>Windows:</b> play/pause, next and previous use the media keys, and the track comes from Spotify\'s window title. Volume keys change the system volume.',
			},
			{
				type: 'textinput',
				id: 'idle1',
				label: 'When nothing is playing, viewers show (line 1)',
				width: 6,
				default: IDLE_DEFAULTS.idle1,
				useVariables: true,
			},
			{
				type: 'textinput',
				id: 'idle2',
				label: 'When nothing is playing, viewers show (line 2)',
				width: 6,
				default: IDLE_DEFAULTS.idle2,
				useVariables: true,
			},
			{ type: 'number', id: 'poll', label: 'Check Spotify every (seconds, 0 = off)', width: 6, default: process.platform === 'darwin' ? 1 : 3, min: 0, max: 30 },
		]
	}
}

runEntrypoint(SpotifyInstance, [])
