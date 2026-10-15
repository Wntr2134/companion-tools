// Builds D200X-layout.companionconfig: a page that labels every D200X control with what it is,
// so anyone setting up a page can see which Companion button is which key or knob.
// Run: node make-layout.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const C = { key: 0x1f3a5f, wide: 0x2e5e3e, page: 0x5a4a1a, turn: 0x7a1f1f, push: 0x4a2a6a, none: 0x202020 }
function btn(text, bg, rotary = false) {
	const action_sets = { down: [], up: [] }
	if (rotary) {
		action_sets.rotate_left = []
		action_sets.rotate_right = []
	}
	return {
		type: 'button',
		options: { stepProgression: 'auto', rotaryActions: rotary },
		style: {
			text,
			textExpression: false,
			size: 'auto',
			alignment: 'center:center',
			pngalignment: 'center:center',
			color: 0xffffff,
			bgcolor: bg,
			show_topbar: false,
			png64: null,
		},
		feedbacks: [],
		localVariables: [],
		steps: { 0: { action_sets, options: { runWhileHeld: [] } } },
	}
}

const controls = {}
const set = (r, c, b) => ((controls[r] ??= {})[c] = b)

// Keys are numbered the way you read the device: left to right, top to bottom.
let n = 1
for (const r of [0, 1]) for (let c = 0; c < 5; c++) set(r, c, btn(`KEY ${n++}`, C.key))
for (let c = 0; c < 3; c++) set(2, c, btn(`KEY ${n++}`, C.key))
set(2, 3, btn('WIDE KEY\n(clock window)', C.wide))
set(2, 4, btn('(covered by\nwide key)', C.none))
set(3, 0, btn('◀ PAGE\nleft button\n(fixed)', C.page))
set(3, 4, btn('PAGE ▶\nright button\n(fixed)', C.page))
for (let k = 1; k <= 3; k++) set(3, k, btn(`KNOB ${k}\nTURN\n◀ ▶`, C.turn, true))
for (let k = 1; k <= 3; k++) set(4, k, btn(`KNOB ${k}\nPUSH`, C.push))

const out = {
	version: 12,
	type: 'page',
	page: { name: 'D200X Layout', controls, gridSize: { minColumn: 0, maxColumn: 4, minRow: 0, maxRow: 4 } },
	instances: {},
	connectionCollections: [],
	oldPageNumber: 1,
}
writeFileSync(fileURLToPath(new URL('D200X-layout.companionconfig', import.meta.url)), JSON.stringify(out, null, 2) + '\n')
