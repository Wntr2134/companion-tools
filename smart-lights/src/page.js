// A ready-to-import Companion page (or pages) for the D200X, built from this connection's own lights:
// Companion's Import → Buttons picks it up like any exported page. Every key is the same as its preset.
//
//   row 0-1: lights, rooms, strips and plugs (tap = on / off, hold = 100%)
//   row 2:   two more, ALL OFF, and the wide key (clock + lights on)
//   row 3:   knob 1-3 turn = brightness of the first three rooms / dimmable lights
//   row 4:   knob 1-3 push = on / off
// More than 12 devices carry on onto "Home 2", "Home 3" and so on.
// No Companion dependency, so it can be tested on its own.

const DARK = 0x181a1e
const WHITE = 0xffffff
const KEY_SPOTS = ['0/0', '0/1', '0/2', '0/3', '0/4', '1/0', '1/1', '1/2', '1/3', '1/4', '2/0', '2/1']
const KNOBS = [1, 2, 3] // columns of knob 1-3 (row 3 turn, row 4 push)

/**
 * targets: [{ id, kind, slug }] in the order they should appear (rooms first suits most homes).
 * presets: the connection's preset definitions (t_<slug>, k_<slug>, k_<slug>__push, all_off, view_clock_lights).
 * connection: { id, label } of this connection.
 */
export function buildHomePages({ targets, presets, connection, moduleId = 'smart-lights' }) {
	const onOff = targets.filter((t) => presets[`t_${t.slug}`])
	const dimmable = targets.filter((t) => presets[`k_${t.slug}`])
	const pages = {}
	const chunks = []
	for (let i = 0; i < Math.max(1, onOff.length); i += KEY_SPOTS.length) chunks.push(onOff.slice(i, i + KEY_SPOTS.length))
	chunks.forEach((chunk, n) => {
		const name = n === 0 ? 'Home' : `Home ${n + 1}`
		const keys = {}
		chunk.forEach((t, i) => (keys[KEY_SPOTS[i]] = presets[`t_${t.slug}`]))
		if (presets.all_off) keys['2/2'] = presets.all_off
		if (presets.view_clock_lights) keys['2/3'] = presets.view_clock_lights
		// knobs: the first three dimmable ones on this page, else the first three overall
		const here = dimmable.filter((t) => chunk.includes(t))
		const knobs = (here.length ? here : dimmable).slice(0, KNOBS.length)
		knobs.forEach((t, i) => {
			keys[`3/${KNOBS[i]}`] = presets[`k_${t.slug}`]
			if (presets[`k_${t.slug}__push`]) keys[`4/${KNOBS[i]}`] = presets[`k_${t.slug}__push`]
		})
		const controls = {}
		for (const [pos, p] of Object.entries(keys)) {
			const [r, c] = pos.split('/').map(Number)
			;(controls[r] ??= {})[c] = toControl(`${name} ${pos}`, p, connection.id)
		}
		pages[n + 1] = { name, controls, gridSize: { minColumn: 0, maxColumn: 4, minRow: 0, maxRow: 4 } }
	})
	return {
		version: 12,
		type: 'full',
		companionBuild: undefined,
		pages,
		instances: { [connection.id]: { label: connection.label, moduleId, lastUpgradeIndex: -1, sortOrder: 0 } },
		connectionCollections: [],
	}
}

const wrap = (options) => Object.fromEntries(Object.entries(options ?? {}).map(([k, v]) => [k, { isExpression: false, value: v }]))

/** A preset as an exported Companion button (the same layout Companion writes in its own exports). */
export function toControl(where, p, connectionId) {
	let n = 0
	const id = () => `${where.replace(/[^a-z0-9]+/gi, '-')}-${n++}`
	const entity = (type, definitionId, options) => ({ id: id(), type, definitionId, connectionId, options: wrap(options), upgradeIndex: -1 })
	const step = p.steps?.[0] ?? { down: [], up: [] }
	const action_sets = {}
	for (const set of ['down', 'up', 'rotate_left', 'rotate_right']) {
		if (set.startsWith('rotate') && !p.options?.rotaryActions) continue
		action_sets[set] = (step[set] ?? []).map((a) => entity('action', a.actionId, a.options))
	}
	// hold actions: `600: { options: { runWhileHeld }, actions }` fires after 600 ms held
	const runWhileHeld = []
	for (const [set, v] of Object.entries(step)) {
		if (!/^\d+$/.test(set)) continue
		action_sets[set] = (v.actions ?? []).map((a) => entity('action', a.actionId, a.options))
		if (v.options?.runWhileHeld) runWhileHeld.push(Number(set))
	}
	const s = p.style ?? {}
	return {
		type: 'button',
		options: { stepProgression: 'auto', rotaryActions: !!p.options?.rotaryActions },
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
		feedbacks: (p.feedbacks ?? []).map((f) => ({
			...entity('feedback', f.feedbackId, f.options),
			isInverted: { isExpression: false, value: !!f.isInverted },
			...(f.style ? { style: f.style } : {}),
		})),
		localVariables: [],
		steps: { 0: { action_sets, options: { runWhileHeld } } },
	}
}
