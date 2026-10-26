// Builds ready-to-import D200X pages (system-tools/extras/pages/D200X-pages.companionconfig, every page in
// one file) from the modules' own presets, so every key looks and behaves exactly like the preset it came from.
//
// On every Mac page, Spotify keeps the same spots: KEY 9 / KEY 10 = ⏮ / ⏭, knob 3 = Spotify volume
// (push = play/pause), and the wide key shows now playing (a clock and the date when nothing plays).
// Everything else is System Tools. The PTZ Camera page is Panasonic PTZ only.
//
// Run from the repo root (after `npm install` in system-tools/, spotify-local/ and panasonic-ptz/):
//   node tools/make-pages.mjs          writes the pages
//   node tools/make-pages.mjs --check  checks they're up to date (CI)
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// The pages are for a Mac: build the Mac versions of the presets.
Object.defineProperty(process, 'platform', { value: 'darwin' })
const { loadModule, checkButton, root } = await import('./module-host.mjs')

// Connection ids inside the files, and the labels Companion gives these connections by default.
// On import Companion matches them to your connections (and lets you pick), and rewrites the labels in
// key text to yours.
const CONN = {
	sys: { id: 'system-tools', label: 'System_Tools', moduleId: 'system-tools' },
	sp: { id: 'spotify-local', label: 'Spotify__local_', moduleId: 'spotify-local' },
	ptz: { id: 'panasonic-ptz', label: 'Panasonic-PTZ', moduleId: 'panasonic-ptz' },
}
const DARK = 0x181a1e
const WHITE = 0xffffff
const GREEN = 0x008c3c

const mods = {}
for (const [key, c] of Object.entries(CONN)) {
	const loaded = await loadModule(c.moduleId, { label: c.label })
	if (loaded.skipped) throw new Error(`${c.moduleId}: ${loaded.skipped}`)
	mods[key] = loaded.defs
}

/** A key taken from a module's preset. */
const preset = (mod, id) => {
	const p = mods[mod].presets[id]
	if (!p) throw new Error(`${CONN[mod].moduleId} has no preset "${id}"`)
	return { mod, ...structuredClone(p) }
}

/** A key made here: text plus press actions (and optional turn actions and feedbacks). */
const key = (mod, text, down, { left, right, feedbacks = [], size = '14' } = {}) => ({
	mod,
	type: 'button',
	style: { text, size, color: WHITE, bgcolor: DARK, show_topbar: false },
	options: left || right ? { rotaryActions: true } : {},
	steps: [{ down, up: [], ...(left || right ? { rotate_left: left ?? [], rotate_right: right ?? [] } : {}) }],
	feedbacks,
})
const act = (actionId, options = {}) => ({ actionId, options })
const front = (position, screen = 'same') => act('window_place', { app: 'front', custom: '', screen, position, launch: false })
const keys = (k, mods = [], target = '') => act('send_keys', { key: k, command: mods.includes('command'), option: mods.includes('option'), control: mods.includes('control'), shift: mods.includes('shift'), target })
const app = (name, label, id) =>
	key('sys', label, [act('launch', { app: 'custom', custom: name })], {
		size: 'auto',
		feedbacks: [{ feedbackId: 'app_running', options: { app: id }, style: { bgcolor: GREEN, color: WHITE } }],
	})

// Spotify's spots, the same on every page.
const spotify = () => ({
	'1/3': preset('sp', 'previous'),
	'1/4': preset('sp', 'next'),
	'2/3': preset('sp', 'view_clock'),
	'3/3': preset('sp', 'volume_knob'),
	'4/3': preset('sp', 'volume_knob__push'),
})
const systemVolume = () => ({ turn: preset('sys', 'volume_knob'), push: preset('sys', 'volume_knob__push') })
const knobs = (k1, k2) => ({ '3/1': k1.turn, '4/1': k1.push, '3/2': k2.turn, ...(k2.push ? { '4/2': k2.push } : {}) })
const desktopKnob = () => ({
	turn: key('sys', 'DESKTOP\\n◀ ▶', [], { left: [act('space', { direction: 'left' })], right: [act('space', { direction: 'right' })] }),
	push: key('sys', 'MISSION\\nCONTROL', [act('mission_control', { view: 'mission' })]),
})

const screenKnob = () => ({ turn: key('sys', 'SCREEN\\n◀ ▶', [], { left: [front('keep', 'previous')], right: [front('keep', 'next')] }), push: key('sys', 'FILL', [front('full')], { size: '18' }) })
const halfKnob = () => ({ turn: key('sys', 'HALF\\n◀ ▶', [], { left: [front('left')], right: [front('right')] }), push: key('sys', 'CENTRE', [front('centre')], { size: '18' }) })
/** Dock keys for these spots, starting at Dock position `first`. */
const dockKeys = (spots, first) => Object.fromEntries(spots.map((pos, i) => [pos, preset('sys', `dock_${first + i}`)]))

const PAGES = {
	'Dock Apps': {
		about: 'Your Dock as keys: Finder then your Dock apps in order (11 keys), each named after its app and green while it runs. Rearrange the Dock and the keys follow. Knob 1 = Mac volume (push = mute), knob 2 = move the front window to the previous / next screen (push = fill).',
		keys: {
			...spotify(),
			...dockKeys(['0/0', '0/1', '0/2', '0/3', '0/4', '1/0', '1/1', '1/2', '2/0', '2/1', '2/2'], 1),
			...knobs(systemVolume(), screenKnob()),
		},
	},
	'Dock Apps 2': {
		about: 'Dock apps 12 to 16 (for a long Dock) on the top row, then front window left / fill / right and next screen, and Open Companion. Knob 1 = Mac volume, knob 2 = left / right half (push = centre).',
		keys: {
			...spotify(),
			...dockKeys(['0/0', '0/1', '0/2', '0/3', '0/4'], 12),
			'1/0': preset('sys', 'win_left'),
			'1/1': preset('sys', 'win_full'),
			'1/2': preset('sys', 'win_right'),
			'2/0': preset('sys', 'win_prev'),
			'2/1': preset('sys', 'win_next'),
			'2/2': preset('sys', 'open_companion'),
			...knobs(systemVolume(), halfKnob()),
		},
	},
	'Apps and Windows': {
		about: 'The first five Dock apps on the top row, then the front window: left / fill / right, previous / next screen, centre. Knob 1 = Mac volume (push = mute), knob 2 = move the front window between screens (push = fill).',
		keys: {
			...spotify(),
			...dockKeys(['0/0', '0/1', '0/2', '0/3', '0/4'], 1),
			'1/0': preset('sys', 'win_left'),
			'1/1': preset('sys', 'win_full'),
			'1/2': preset('sys', 'win_right'),
			'2/0': preset('sys', 'win_prev'),
			'2/1': preset('sys', 'win_next'),
			'2/2': preset('sys', 'win_centre'),
			...knobs(systemVolume(), screenKnob()),
		},
	},
	'Mac Desk': {
		about: 'Everyday Mac: Mission Control, show desktop, screenshot, Spotlight, lock; front window left / fill / right and onto the other screen; keep awake. Knob 1 = Mac volume (push = mute), knob 2 = desktops (push = Mission Control).',
		keys: {
			...spotify(),
			'0/0': preset('sys', 'mission'),
			'0/1': preset('sys', 'show_desktop'),
			'0/2': preset('sys', 'key_screenshot'),
			'0/3': preset('sys', 'key_spotlight'),
			'0/4': preset('sys', 'lock'),
			'1/0': preset('sys', 'win_left'),
			'1/1': preset('sys', 'win_full'),
			'1/2': preset('sys', 'win_right'),
			'2/0': preset('sys', 'win_prev'),
			'2/1': preset('sys', 'win_next'),
			'2/2': preset('sys', 'keep_awake'),
			...knobs(systemVolume(), desktopKnob()),
		},
	},
	Windows: {
		about: 'Window layouts for the window in front: thirds, two-thirds, quarters, centre, minimise. Knob 1 = move it to the previous / next screen (push = fill the screen), knob 2 = left / right half (push = centre).',
		keys: {
			...spotify(),
			'0/0': preset('sys', 'win_left_third'),
			'0/1': preset('sys', 'win_centre_third'),
			'0/2': preset('sys', 'win_right_third'),
			'0/3': preset('sys', 'win_left_two_thirds'),
			'0/4': preset('sys', 'win_right_two_thirds'),
			'1/0': preset('sys', 'win_top_left'),
			'1/1': preset('sys', 'win_top_right'),
			'1/2': preset('sys', 'win_big_centre'),
			'2/0': preset('sys', 'win_bottom_left'),
			'2/1': preset('sys', 'win_bottom_right'),
			'2/2': preset('sys', 'win_min'),
			...knobs(screenKnob(), halfKnob()),
		},
	},
	'Show Machine': {
		about: 'Window layouts 1–4 (arrange your windows, press SAVE, then the LAYOUT key puts them back), keep awake, sleep screens, eject disks, dark mode. Knob 1 = Mac volume (push = mute), knob 2 = microphone level.',
		keys: {
			...spotify(),
			'0/0': preset('sys', 'layout_1'),
			'0/1': preset('sys', 'layout_2'),
			'0/2': preset('sys', 'layout_3'),
			'0/3': preset('sys', 'layout_4'),
			'0/4': preset('sys', 'keep_awake'),
			'1/0': preset('sys', 'layout_1_save'),
			'1/1': preset('sys', 'layout_2_save'),
			'1/2': preset('sys', 'layout_3_save'),
			'2/0': preset('sys', 'display_sleep'),
			'2/1': preset('sys', 'eject'),
			'2/2': preset('sys', 'dark_mode'),
			...knobs(systemVolume(), { turn: preset('sys', 'mic_knob') }),
		},
	},
	'Show Apps': {
		about: 'Open your show apps (green while running), arrange them across screens in one press (edit ARRANGE SHOW to suit), hide everything else, and push the front window to screen 1 or 2. Knob 1 = Mac volume (push = mute), knob 2 = desktops.',
		keys: {
			...spotify(),
			'0/0': app('Dante Controller', 'DANTE\\nCTRL', 'dante_controller'),
			'0/1': app('Dante Virtual Soundcard', 'DANTE\\nDVS', 'dante_virtual_soundcard'),
			'0/2': app('Resolume Arena', 'RESOLUME', 'resolume_arena'),
			'0/3': app('MagicQ', 'MAGICQ', 'magicq'),
			'0/4': app('Universal Capture', 'ECHO360\\nCAPTURE', 'universal_capture'),
			'1/0': key('sys', 'ARRANGE\\nSHOW', [act('layout_apply', { layout: 'Resolume Arena, 2, fill\nDante Controller, 1, left\nMagicQ, 1, right', launch: true })]),
			'1/1': preset('sys', 'hide_others'),
			'1/2': preset('sys', 'show_all'),
			'2/0': preset('sys', 'win_screen_1'),
			'2/1': preset('sys', 'win_screen_2'),
			'2/2': preset('sys', 'keep_awake'),
			...knobs(systemVolume(), desktopKnob()),
		},
	},
	'PTZ Camera': {
		about: 'Panasonic PTZ: camera presets 1–5 on the top row (press = recall, hold 5 s = save over it; red SAVED when done, green for the last one recalled). The wide key flips the camera between Desktop and Hanging (amber while hanging). Knob 1 = pan (push = home), knob 2 = tilt, knob 3 = zoom. The second and third rows are left free for you.',
		keys: {
			'0/0': preset('ptz', 'save-recall-presets-0'),
			'0/1': preset('ptz', 'save-recall-presets-1'),
			'0/2': preset('ptz', 'save-recall-presets-2'),
			'0/3': preset('ptz', 'save-recall-presets-3'),
			'0/4': preset('ptz', 'save-recall-presets-4'),
			'2/3': preset('ptz', 'system-ins-flip'),
			'3/1': preset('ptz', 'knob-pan'),
			'4/1': preset('ptz', 'pan-tilt-home'),
			'3/2': preset('ptz', 'knob-tilt'),
			'3/3': preset('ptz', 'knob-zoom'),
		},
	},
}

// ---------- to Companion's page format ----------

const idFor = (...parts) => createHash('sha1').update(parts.join('|')).digest('base64url').slice(0, 21)
const wrap = (options = {}) => Object.fromEntries(Object.entries(options).map(([k, v]) => [k, { isExpression: false, value: v }]))

function toControl(page, pos, b) {
	const conn = CONN[b.mod]
	const entity = (type, n, definitionId, options) => ({ id: idFor(page, pos, type, n), type, definitionId, connectionId: conn.id, options: wrap(options), upgradeIndex: -1 })
	const step = b.steps?.[0] ?? { down: [], up: [] }
	const action_sets = {}
	for (const set of ['down', 'up', 'rotate_left', 'rotate_right']) {
		if (set.startsWith('rotate') && !b.options?.rotaryActions) continue
		action_sets[set] = (step[set] ?? []).map((a, i) => entity('action', `${set}${i}`, a.actionId, a.options))
	}
	// Hold actions: a preset's `5000: { options, actions }` is the set that fires after 5 s held.
	const runWhileHeld = []
	for (const [set, v] of Object.entries(step)) {
		if (!/^\d+$/.test(set)) continue
		action_sets[set] = (v.actions ?? []).map((a, i) => entity('action', `${set}_${i}`, a.actionId, a.options))
		if (v.options?.runWhileHeld) runWhileHeld.push(Number(set))
	}
	const s = b.style ?? {}
	return {
		type: 'button',
		options: { stepProgression: 'auto', rotaryActions: !!b.options?.rotaryActions },
		style: {
			text: s.text ?? '',
			textExpression: false,
			size: s.size ?? 'auto',
			alignment: s.alignment ?? 'center:center',
			pngalignment: s.pngalignment ?? 'center:center',
			color: s.color ?? WHITE,
			bgcolor: s.bgcolor ?? DARK,
			show_topbar: s.show_topbar ?? false,
			png64: s.png64 ?? null,
		},
		feedbacks: (b.feedbacks ?? []).map((f, i) => ({
			...entity('feedback', i, f.feedbackId, f.options),
			isInverted: { isExpression: false, value: !!f.isInverted },
			// On/off feedbacks carry their style; advanced ones (the album-art card) draw their own.
			...(f.style ? { style: f.style } : {}),
		})),
		localVariables: [],
		steps: { 0: { action_sets, options: { runWhileHeld } } },
	}
}

const outDir = path.join(root, 'system-tools', 'extras', 'pages')
const check = process.argv.includes('--check')
const problems = []
const written = []
const instances = Object.fromEntries(Object.values(CONN).map((c, i) => [c.id, { label: c.label, moduleId: c.moduleId, lastUpgradeIndex: -1, sortOrder: i }]))
const pages = {}
Object.entries(PAGES).forEach(([name, page], i) => {
	const controls = {}
	for (const [pos, b] of Object.entries(page.keys)) {
		const defs = mods[b.mod]
		problems.push(...checkButton(`${name} ${pos}`, b, defs.actions, defs.feedbacks))
		const [r, c] = pos.split('/').map(Number)
		;(controls[r] ??= {})[c] = toControl(name, pos, b)
	}
	pages[i + 1] = { name, controls, gridSize: { minColumn: 0, maxColumn: 4, minRow: 0, maxRow: 4 } }
})

// Every page in one file: Companion's Import → Buttons tab picks a page from it and where it goes.
const bundle = { version: 12, type: 'full', companionBuild: undefined, pages, instances, connectionCollections: [] }
const files = {
	'D200X-pages.companionconfig': JSON.stringify(bundle, null, 1) + '\n',
	'pages.md':
		Object.entries(PAGES)
			.map(([name, p], i) => `${i + 1}. **${name}**: ${p.about}`)
			.join('\n') + '\n',
}
for (const [name, text] of Object.entries(files)) {
	const file = path.join(outDir, name)
	if (check) {
		if (!existsSync(file) || readFileSync(file, 'utf8') !== text) problems.push(`${path.relative(root, file)} is out of date: run node tools/make-pages.mjs`)
	} else {
		mkdirSync(outDir, { recursive: true })
		writeFileSync(file, text)
		written.push(path.relative(root, file))
	}
}
for (const w of written) console.log(`wrote ${w}`)
if (problems.length) {
	console.log(problems.join('\n'))
	process.exit(1)
}
console.log(check ? 'pages are up to date' : 'pages written')
process.exit(0)
