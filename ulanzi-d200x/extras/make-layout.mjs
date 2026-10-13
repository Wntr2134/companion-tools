import { writeFileSync } from 'node:fs'
const C = { key: 0x1f3a5f, wide: 0x2e5e3e, page: 0x5a4a1a, knob: 0x7a1f1f, turn: 0x4a2a6a, none: 0x202020 }
function btn(text, bg, rotary = false) {
  const action_sets = { down: [], up: [] }
  if (rotary) { action_sets.rotate_left = []; action_sets.rotate_right = [] }
  return {
    type: 'button',
    options: { stepProgression: 'auto', rotaryActions: rotary },
    style: { text, textExpression: false, size: 'auto', alignment: 'center:center', pngalignment: 'center:center',
      color: 0xffffff, bgcolor: bg, show_topbar: false, png64: null },
    feedbacks: [], localVariables: [],
    steps: { 0: { action_sets, options: { runWhileHeld: [] } } },
  }
}
const controls = {}
const set = (r, c, b) => ((controls[r] ??= {})[c] = b)
for (const r of [0, 1]) for (let c = 0; c < 5; c++) set(r, c, btn(`KEY\nrow ${r} col ${c}`, C.key))
for (let c = 0; c < 3; c++) set(2, c, btn(`KEY\nrow 2 col ${c}`, C.key))
set(2, 3, btn('WIDE KEY\nrow 2 col 3', C.wide))
set(2, 4, btn('(no key on\nD200X)', C.none))
set(3, 0, btn('PAGE ◀\nhardware\n(auto)', C.page))
set(3, 4, btn('PAGE ▶\nhardware\n(auto)', C.page))
for (let k = 1; k <= 3; k++) set(3, k, btn(`KNOB ${k}\n◀ TURN ▶`, C.knob, true))
for (let k = 1; k <= 3; k++) set(4, k, btn(`KNOB ${k}\nPUSH`, C.turn))
const out = {
  version: 12, type: 'page', companionBuild: undefined,
  page: { name: 'D200X Layout', controls, gridSize: { minColumn: 0, maxColumn: 4, minRow: 0, maxRow: 4 } },
  instances: {}, connectionCollections: [], oldPageNumber: 1,
}
writeFileSync('D200X-layout.companionconfig', JSON.stringify(out, null, 2))
