// The Key Styler: a page System Tools serves from Companion (…/instance/<connection>/styler) for restyling
// many keys at once. It changes only how keys look, through Companion's own HTTP API
// (POST /api/location/<page>/<row>/<column>/style), so their actions stay as they are.
// No Companion dependency, so it can be tested on its own.
import { THEMES, SIZES, PLACES } from './styles.js'

const hex = (n) => `#${Number(n).toString(16).padStart(6, '0')}`

/** The style a selection gets, as the query Companion's style call takes ('' parts are left out). */
export function styleQuery({ theme, size, place, textColour, text } = {}) {
	const q = new URLSearchParams()
	const t = THEMES[theme]
	if (t) {
		q.set('bgcolor', hex(t.bg))
		q.set('color', textColour === 'white' ? '#ffffff' : textColour === 'black' ? '#000000' : hex(t.fg))
	} else if (textColour === 'white' || textColour === 'black') q.set('color', textColour === 'white' ? '#ffffff' : '#000000')
	if (SIZES[size]?.size) q.set('size', SIZES[size].size)
	if (PLACES[place]?.alignment) q.set('alignment', PLACES[place].alignment)
	if (typeof text === 'string' && text !== '') q.set('text', text)
	return q.toString()
}

/** The D200X's keys as Companion's grid positions (row/column), named as on the device. */
export const D200X_KEYS = [
	...[0, 1, 2, 3, 4].map((c) => ({ row: 0, col: c, label: `KEY ${c + 1}` })),
	...[0, 1, 2, 3, 4].map((c) => ({ row: 1, col: c, label: `KEY ${c + 6}` })),
	...[0, 1, 2].map((c) => ({ row: 2, col: c, label: `KEY ${c + 11}` })),
	{ row: 2, col: 3, label: 'WIDE KEY', wide: true },
	...[1, 2, 3].map((c) => ({ row: 3, col: c, label: `KNOB ${c} TURN` })),
	...[1, 2, 3].map((c) => ({ row: 4, col: c, label: `KNOB ${c} PUSH` })),
]

export function stylerHtml() {
	const themes = Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label, bg: hex(t.bg), fg: hex(t.fg) }))
	const sizes = Object.entries(SIZES).map(([id, s]) => ({ id, label: s.label }))
	const places = Object.entries(PLACES).map(([id, p]) => ({ id, label: p.label }))
	const data = JSON.stringify({ themes, sizes, places, d200x: D200X_KEYS }).replace(/</g, '\\u003c')
	return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Key Styler</title>
<style>
:root { --bg: #15161a; --panel: #1f2127; --line: #34363e; --text: #e8e8ec; --dim: #9a9ca6; --accent: #e69600; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 16px; }
h1 { font-size: 20px; margin: 0 0 4px; } p.sub { margin: 0 0 16px; color: var(--dim); }
.bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
label { color: var(--dim); font-size: 13px; }
input, select, button { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
input[type=number] { width: 72px; }
button { cursor: pointer; } button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); color: #111; border-color: var(--accent); font-weight: 600; }
.grid { display: grid; gap: 8px; margin: 6px 0 18px; }
.key { aspect-ratio: 1; border-radius: 10px; border: 2px solid var(--line); background: #24262c; color: var(--dim); font-size: 12px; display: flex; align-items: center; justify-content: center; text-align: center; padding: 4px; user-select: none; cursor: pointer; }
.key.wide { grid-column: span 2; aspect-ratio: auto; }
.key.sel { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; color: var(--text); }
.key.gap { visibility: hidden; }
.swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.sw { padding: 10px 12px; border-radius: 8px; border: 2px solid transparent; font-size: 13px; font-weight: 600; cursor: pointer; }
.sw.on { border-color: var(--text); }
.sw.none { background: var(--panel); color: var(--dim); border-color: var(--line); }
fieldset { border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin: 0 0 12px; }
legend { color: var(--dim); padding: 0 6px; font-size: 13px; }
#log { margin-top: 12px; color: var(--dim); white-space: pre-wrap; font-size: 13px; }
.ok { color: #4cc46c; } .bad { color: #ff6b6b; }
</style></head><body><main>
<h1>Key Styler</h1>
<p class="sub">Pick keys, pick a look, Apply. Only how the keys look changes: their actions stay.</p>
<div class="bar">
	<label>Page <input id="page" type="number" min="1" value="1"></label>
	<label>Layout <select id="layout"><option value="d200x">Ulanzi D200X</option><option value="grid">Plain grid</option></select></label>
	<span id="gridsize"><label>Rows <input id="rows" type="number" min="1" max="16" value="4"></label> <label>Columns <input id="cols" type="number" min="1" max="16" value="8"></label></span>
	<button id="all">Select all</button><button id="none">Clear</button>
</div>
<div id="grid" class="grid"></div>
<fieldset><legend>Colour</legend><div id="themes" class="swatches"></div></fieldset>
<fieldset><legend>Text</legend><div class="bar">
	<label>Size <select id="size"></select></label>
	<label>Sits at <select id="place"></select></label>
	<label>Colour <select id="textColour"><option value="auto">Best for the colour</option><option value="white">White</option><option value="black">Black</option></select></label>
	<label>New text (blank = keep) <input id="text" placeholder="e.g. HOUSE\\nLIGHTS"></label>
</div></fieldset>
<button id="apply" class="primary">Apply to selected keys</button>
<div id="log"></div>
</main>
<script>
const D = ${data}
const $ = (id) => document.getElementById(id)
const sel = new Set()
let theme = ''
function keys() {
	if ($('layout').value === 'd200x') return D.d200x
	const out = []
	for (let r = 0; r < +$('rows').value; r++) for (let c = 0; c < +$('cols').value; c++) out.push({ row: r, col: c, label: (r * +$('cols').value + c + 1) + '' })
	return out
}
function draw() {
	const d200x = $('layout').value === 'd200x'
	$('gridsize').style.display = d200x ? 'none' : ''
	const cols = d200x ? 5 : +$('cols').value
	const g = $('grid')
	g.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))'
	g.innerHTML = ''
	const list = keys()
	const at = new Map(list.map((k) => [k.row + '/' + k.col, k]))
	const rows = Math.max(...list.map((k) => k.row)) + 1
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
		const k = at.get(r + '/' + c)
		if (!k) { if (!(d200x && r === 2 && c === 4)) { const e = document.createElement('div'); e.className = 'key gap'; g.appendChild(e) } continue }
		const e = document.createElement('div')
		const id = r + '/' + c
		e.className = 'key' + (k.wide ? ' wide' : '') + (sel.has(id) ? ' sel' : '')
		e.textContent = k.label
		e.onclick = () => { sel.has(id) ? sel.delete(id) : sel.add(id); draw() }
		g.appendChild(e)
	}
}
for (const t of [{ id: '', label: 'Keep colour' }, ...D.themes]) {
	const b = document.createElement('div')
	b.className = 'sw' + (t.id ? '' : ' none') + (t.id === theme ? ' on' : '')
	if (t.id) { b.style.background = t.bg; b.style.color = t.fg }
	b.textContent = t.label
	b.onclick = () => { theme = t.id; document.querySelectorAll('.sw').forEach((x) => x.classList.remove('on')); b.classList.add('on') }
	$('themes').appendChild(b)
}
for (const s of D.sizes) $('size').add(new Option(s.label, s.id))
for (const p of D.places) $('place').add(new Option(p.label, p.id))
$('layout').onchange = $('rows').onchange = $('cols').onchange = () => { sel.clear(); draw() }
$('all').onclick = () => { keys().forEach((k) => sel.add(k.row + '/' + k.col)); draw() }
$('none').onclick = () => { sel.clear(); draw() }
$('apply').onclick = async () => {
	if (!sel.size) return ($('log').innerHTML = '<span class="bad">Pick some keys first.</span>')
	const q = new URLSearchParams({ theme, size: $('size').value, place: $('place').value, textColour: $('textColour').value, text: $('text').value })
	const style = await (await fetch('style-query?' + q)).text()
	if (!style) return ($('log').innerHTML = '<span class="bad">Nothing to change: pick a colour, size, place or text.</span>')
	const page = +$('page').value
	let ok = 0
	const bad = []
	for (const id of sel) {
		const [r, c] = id.split('/')
		try {
			const res = await fetch('/api/location/' + page + '/' + r + '/' + c + '/style?' + style, { method: 'POST' })
			if (res.ok) ok++
			else bad.push(id + ': ' + res.status)
		} catch (e) { bad.push(id + ': ' + e.message) }
	}
	$('log').innerHTML = '<span class="ok">' + ok + ' key(s) on page ' + page + ' restyled.</span>' + (bad.length ? '\\n<span class="bad">Not changed: ' + bad.join(', ') + '</span>' : '')
}
draw()
</script></body></html>`
}
