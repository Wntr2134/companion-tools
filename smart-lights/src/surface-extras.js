// Makes knob presets work on every surface, not just ones with knobs.
// For each knob (rotary) preset it adds:
//   - a − / + pair of plain buttons doing the same steps (Stream Deck 15-key / XL / Mini, any plain key)
//   - a push key with the knob's press action, when it has one (D200X: the knob push is its own key on
//     row 4; Stream Deck+ dials press the knob itself, which the original preset already handles)
// Keep this file the same in every module that has knobs.

const firstLine = (text) => (typeof text === 'string' ? text : '').split('\\n')[0]

function extrasFor(id, p, category) {
	const step = p.steps?.[0] ?? {}
	if (!step.rotate_left?.length && !step.rotate_right?.length) return []
	const plain = (suffix, name, text, down) => {
		const out = { ...p, name, style: { ...p.style, text }, steps: [{ down, up: [] }], feedbacks: p.feedbacks ?? [] }
		if (out.options) {
			const { rotaryActions: _rotary, ...rest } = out.options
			out.options = rest
		}
		if (category !== undefined) out.category = category
		return [`${id}__${suffix}`, out]
	}
	const label = firstLine(p.style?.text) || p.name
	const extras = [
		plain('minus', `${p.name} −`, `− ${label}`, step.rotate_left ?? []),
		plain('plus', `${p.name} +`, `+ ${label}`, step.rotate_right ?? []),
	]
	if (step.down?.length) extras.push(plain('push', `${p.name}: push`, `${label}\\nPUSH`, step.down))
	return extras
}

/** Presets as one object with a `category` per preset (module API 1.x). Returns a new object. */
export function withSurfaceExtras(presets) {
	const out = { ...presets }
	for (const [id, p] of Object.entries(presets)) {
		for (const [eid, e] of extrasFor(id, p, `${p.category}: − / + buttons and push keys`)) out[eid] = e
	}
	return out
}

/** Presets plus a `structure` of sections (module API 2.x). Returns new { structure, presets }. */
export function withSurfaceExtrasV2(structure, presets) {
	const outPresets = { ...presets }
	const outStructure = []
	for (const section of structure) {
		outStructure.push(section)
		const ids = []
		for (const id of section.definitions ?? []) {
			const p = presets[id]
			if (!p) continue
			for (const [eid, e] of extrasFor(id, p)) {
				outPresets[eid] = e
				ids.push(eid)
			}
		}
		if (ids.length) outStructure.push({ ...section, id: `${section.id}_buttons`, name: `${section.name}: − / + buttons and push keys`, definitions: ids })
	}
	return { structure: outStructure, presets: outPresets }
}
