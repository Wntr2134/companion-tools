// The Key Styler: a page System Tools serves from Companion (…/instance/<connection>/styler) for restyling
// many keys at once: colour, text, size and an icon (searched online or uploaded). The look is saved in
// System Tools, and each key's Key style feedback ("From the Key Styler") shows it, so it works on every
// kind of key and their actions stay. Keys without that feedback get Companion's own style call
// (POST /api/location/…/style), which only older-format keys take.
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

/**
 * The Styler's request as Companion hands it over: the text the page sent, or already read (an object,
 * or bytes) when Companion's web server unpacked it first. null if it isn't JSON.
 */
export function readBody(body) {
	if (body && typeof body === 'object' && !ArrayBuffer.isView(body) && !(body instanceof ArrayBuffer)) {
		if (body.type === 'Buffer' && Array.isArray(body.data)) return readBody(Buffer.from(body.data).toString('utf8'))
		return body
	}
	const text = ArrayBuffer.isView(body) || body instanceof ArrayBuffer ? Buffer.from(body).toString('utf8') : String(body ?? '')
	if (!text.trim()) return {}
	try {
		const v = JSON.parse(text)
		return v && typeof v === 'object' ? v : null
	} catch {
		return null
	}
}

const MAX_IMAGE = 5 * 1024 * 1024

/**
 * A picture from the web, for an image dragged in from another site: http(s) only, an image type, at
 * most 5 MB, 10 s. Returns { base64, type }.
 */
export async function fetchImage(url, { fetchFn = fetch } = {}) {
	let u
	try {
		u = new URL(url)
	} catch {
		throw new Error("that isn't a web address")
	}
	if (!/^https?:$/.test(u.protocol)) throw new Error('only http and https pictures')
	const res = await fetchFn(u.href, { signal: AbortSignal.timeout(10000), redirect: 'follow' })
	if (!res.ok) throw new Error(`the site said ${res.status}`)
	const type = String(res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
	if (!/^image\/(png|jpeg|gif|webp|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon|avif)$/.test(type)) throw new Error(`that's not a picture (${type || 'unknown type'})`)
	const buf = Buffer.from(await res.arrayBuffer())
	if (buf.length > MAX_IMAGE) throw new Error('that picture is over 5 MB')
	return { base64: buf.toString('base64'), type }
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
	return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Key Styler</title>
<style>
:root { --bg: #15161a; --panel: #1f2127; --line: #34363e; --text: #e8e8ec; --dim: #9a9ca6; --accent: #e69600; --ok: #4cc46c; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 16px; }
h1 { font-size: 20px; margin: 0 0 4px; } p.sub { margin: 0 0 16px; color: var(--dim); }
.bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
label { color: var(--dim); font-size: 13px; }
input, select, button { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
input[type=number] { width: 72px; }
button { cursor: pointer; } button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); color: #111; border-color: var(--accent); font-weight: 600; }
.grid { display: grid; gap: 8px; margin: 6px 0 6px; max-width: 640px; }
.key { position: relative; aspect-ratio: 1; border-radius: 10px; border: 2px solid var(--line); background: #24262c; color: var(--dim); font-size: 12px; display: flex; align-items: center; justify-content: center; text-align: center; padding: 4px; user-select: none; cursor: pointer; }
.key.wide { grid-column: span 2; aspect-ratio: auto; }
.key.sel { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; color: var(--text); }
.key.ready::after { content: ''; position: absolute; top: 6px; right: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--ok); }
.key.gap { visibility: hidden; }
.legend { color: var(--dim); font-size: 13px; margin: 0 0 16px; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--ok); margin-right: 4px; }
.swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.sw { padding: 10px 12px; border-radius: 8px; border: 2px solid transparent; font-size: 13px; font-weight: 600; cursor: pointer; }
.sw.on { border-color: var(--text); }
.sw.none { background: var(--panel); color: var(--dim); border-color: var(--line); }
fieldset { border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin: 0 0 12px; }
legend { color: var(--dim); padding: 0 6px; font-size: 13px; }
.icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 6px; margin-top: 10px; max-height: 240px; overflow: auto; }
.ic { background: #2a2c33; border: 2px solid transparent; border-radius: 8px; padding: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.ic img { width: 32px; height: 32px; }
.ic.on { border-color: var(--accent); }
#preview { width: 72px; height: 72px; border-radius: 10px; border: 1px solid var(--line); background: #24262c; }
body.drag::after { content: 'Drop the picture to use it as the icon'; position: fixed; inset: 12px; border: 3px dashed var(--accent); border-radius: 16px; background: rgba(21,22,26,.85); color: var(--text); font-size: 22px; display: flex; align-items: center; justify-content: center; pointer-events: none; }
#log { margin-top: 12px; color: var(--dim); white-space: pre-wrap; font-size: 13px; }
.ok { color: var(--ok); } .bad { color: #ff6b6b; }
</style></head><body><main>
<h1>Key Styler</h1>
<p class="sub">Pick keys, pick a look, Apply. Only how the keys look changes: their actions stay.</p>
<div class="bar">
	<label>Page <input id="page" type="number" min="1" value="1"></label>
	<label>Layout <select id="layout"><option value="d200x">Ulanzi D200X</option><option value="grid">Plain grid</option></select></label>
	<span id="gridsize"><label>Rows <input id="rows" type="number" min="1" max="16" value="4"></label> <label>Columns <input id="cols" type="number" min="1" max="16" value="8"></label></span>
	<button id="all">Select all</button><button id="none">Clear selection</button>
</div>
<div id="grid" class="grid"></div>
<p class="legend"><span class="dot"></span>Styler-ready: the key has a System Tools <b>Key style</b> feedback set to "From the Key Styler" (System Tools presets come with one). Keys without it only change if they're the older kind.</p>
<fieldset><legend>Colour</legend><div id="themes" class="swatches"></div></fieldset>
<fieldset><legend>Text</legend><div class="bar">
	<label>Size <select id="size"></select></label>
	<label>Sits at <select id="place"></select></label>
	<label>Colour <select id="textColour"><option value="auto">Best for the colour</option><option value="white">White</option><option value="black">Black</option></select></label>
	<label>New text (blank = keep) <input id="text" placeholder="e.g. HOUSE\\nLIGHTS"></label>
</div></fieldset>
<fieldset><legend>Icon</legend>
	<div class="bar">
		<input id="q" placeholder="Search icons: microphone, camera, lights…" size="30"><button id="search">Search</button>
		<label>or <input id="upload" type="file" accept="image/*"></label>
		<span class="legend">…or drag a picture onto this page from anywhere (a file, or an image on a web page), or paste one (⌘V / Ctrl+V).</span>
		<label>Icon <select id="iconAt"><option value="top">At the top, text underneath</option><option value="middle">Big in the middle</option></select></label>
		<label>Colour <select id="iconColour"><option value="white">White</option><option value="black">Black</option><option value="original">As it comes</option></select></label>
		<button id="noicon">No icon</button>
		<canvas id="preview" width="144" height="144"></canvas>
	</div>
	<div id="icons" class="icons"></div>
</fieldset>
<div class="bar"><button id="apply" class="primary">Apply to selected keys</button><button id="reset">Remove the Styler's look from selected keys</button></div>
<div id="log"></div>
</main>
<script src="styler.js"></script>
</body></html>`
}

/** The page's script, served as its own file (styler.js): Companion may not allow scripts written into a page. */
export function stylerJs() {
	const themes = Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label, bg: hex(t.bg), fg: hex(t.fg) }))
	const sizes = Object.entries(SIZES).map(([id, s]) => ({ id, label: s.label }))
	const places = Object.entries(PLACES).map(([id, p]) => ({ id, label: p.label }))
	const data = JSON.stringify({ themes, sizes, places, d200x: D200X_KEYS })
	return `'use strict'
const D = ${data}
const $ = (id) => document.getElementById(id)
const sel = new Set()
let ready = new Set()
let theme = ''
let icon = '' // '' = keep, 'none' = take off, else base64 PNG
let iconName = ''
function keys() {
	if ($('layout').value === 'd200x') return D.d200x
	const out = []
	for (let r = 0; r < +$('rows').value; r++) for (let c = 0; c < +$('cols').value; c++) out.push({ row: r, col: c, label: String(r * +$('cols').value + c + 1) })
	return out
}
async function loadReady() {
	try {
		const r = await (await fetch('linked?page=' + (+$('page').value || 1))).json()
		ready = new Set(r.linked || [])
	} catch (e) { ready = new Set() }
	draw()
}
function draw() {
	const d200x = $('layout').value === 'd200x'
	$('gridsize').style.display = d200x ? 'none' : ''
	const cols = d200x ? 5 : +$('cols').value
	const g = $('grid')
	g.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))'
	g.textContent = ''
	const list = keys()
	const at = new Map(list.map((k) => [k.row + '/' + k.col, k]))
	const rows = Math.max(...list.map((k) => k.row)) + 1
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
		const k = at.get(r + '/' + c)
		if (!k) { if (!(d200x && r === 2 && c === 4)) { const e = document.createElement('div'); e.className = 'key gap'; g.appendChild(e) } continue }
		const e = document.createElement('div')
		const id = r + '/' + c
		e.className = 'key' + (k.wide ? ' wide' : '') + (sel.has(id) ? ' sel' : '') + (ready.has(id) ? ' ready' : '')
		e.textContent = k.label
		e.onclick = () => { sel.has(id) ? sel.delete(id) : sel.add(id); draw() }
		g.appendChild(e)
	}
}
for (const t of [{ id: '', label: 'Keep colour' }, ...D.themes]) {
	const b = document.createElement('div')
	b.className = 'sw' + (t.id ? '' : ' none on')
	if (t.id) { b.style.background = t.bg; b.style.color = t.fg }
	b.textContent = t.label
	b.onclick = () => { theme = t.id; document.querySelectorAll('.sw').forEach((x) => x.classList.remove('on')); b.classList.add('on'); drawIcon() }
	$('themes').appendChild(b)
}
for (const s of D.sizes) $('size').add(new Option(s.label, s.id))
for (const p of D.places) $('place').add(new Option(p.label, p.id))

// ---------- icons: Iconify's free library (searched online), or a picture of your own ----------
let iconImg = null
function drawIcon() {
	const cv = $('preview'), g = cv.getContext('2d')
	g.clearRect(0, 0, 144, 144)
	const t = D.themes.find((x) => x.id === theme)
	g.fillStyle = t ? t.bg : '#24262c'
	g.fillRect(0, 0, 144, 144)
	if (!iconImg) return
	const top = $('iconAt').value === 'top'
	const s = top ? 84 : 112
	g.drawImage(iconImg, (144 - s) / 2, top ? 10 : (144 - s) / 2, s, s)
}
function pngOfIcon() {
	// the icon alone on a clear background, at the key's shape: the key's colour shows behind it
	const cv = document.createElement('canvas'); cv.width = 144; cv.height = 144
	const g = cv.getContext('2d')
	const top = $('iconAt').value === 'top'
	const s = top ? 84 : 112
	g.drawImage(iconImg, (144 - s) / 2, top ? 10 : (144 - s) / 2, s, s)
	return cv.toDataURL('image/png').split(',')[1]
}
function useImage(src, name) {
	const img = new Image()
	img.onload = () => { iconImg = img; iconName = name; icon = pngOfIcon(); drawIcon() }
	img.onerror = () => { $('log').innerHTML = '<span class="bad">That picture could not be read.</span>' }
	img.src = src
}
async function pickIconify(name, cell) {
	document.querySelectorAll('.ic').forEach((x) => x.classList.remove('on'))
	cell.classList.add('on')
	const colour = $('iconColour').value
	const [set, id] = name.split(':')
	const url = 'https://api.iconify.design/' + set + '/' + id + '.svg?height=128' + (colour === 'original' ? '' : '&color=' + (colour === 'white' ? '%23ffffff' : '%23000000'))
	try {
		const svg = await (await fetch(url)).text()
		useImage(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), name)
	} catch (e) { $('log').innerHTML = '<span class="bad">Could not load that icon (is this computer online?).</span>' }
}
async function search() {
	const q = $('q').value.trim()
	if (!q) return
	$('icons').textContent = 'Searching…'
	try {
		const r = await (await fetch('https://api.iconify.design/search?limit=96&query=' + encodeURIComponent(q))).json()
		$('icons').textContent = ''
		if (!r.icons || !r.icons.length) { $('icons').textContent = 'No icons found for "' + q + '"'; return }
		for (const name of r.icons) {
			const [set, id] = name.split(':')
			const cell = document.createElement('div')
			cell.className = 'ic'
			cell.title = name
			const img = document.createElement('img')
			img.src = 'https://api.iconify.design/' + set + '/' + id + '.svg?height=32&color=%23e8e8ec'
			img.alt = name
			cell.appendChild(img)
			cell.onclick = () => pickIconify(name, cell)
			$('icons').appendChild(cell)
		}
	} catch (e) { $('icons').textContent = 'Icon search needs this computer to be online.' }
}
// Drag and drop from anywhere: a file, or an image dragged from a web page (fetched by System Tools,
// because the browser won't let this page read another site's picture itself). Paste works too.
async function useUrl(url) {
	if (!/^https?:\\/\\//i.test(url)) return
	try {
		const res = await fetch('fetch-image?url=' + encodeURIComponent(url))
		const text = await res.text()
		if (!res.ok) throw new Error(text)
		useImage(text, url)
	} catch (e) { $('log').innerHTML = '<span class="bad">Couldn\\'t get that picture: ' + e.message + '</span>' }
}
function urlFrom(dt) {
	const html = dt.getData('text/html')
	const m = html && /<img[^>]+src=["']([^"']+)["']/i.exec(html)
	if (m) return m[1].replace(/&amp;/g, '&')
	const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split(/\\r?\\n/).find((l) => /^https?:/i.test(l))
	return uri || ''
}
let dragDepth = 0
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('drag') })
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drag') } })
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => {
	e.preventDefault()
	dragDepth = 0
	document.body.classList.remove('drag')
	const f = [...(e.dataTransfer.files || [])].find((x) => x.type.startsWith('image/'))
	if (f) return useImage(URL.createObjectURL(f), f.name)
	const url = urlFrom(e.dataTransfer)
	if (url.startsWith('data:image/')) return useImage(url, 'dropped picture')
	if (url) return useUrl(url)
	$('log').innerHTML = '<span class="bad">That wasn\\'t a picture.</span>'
})
document.addEventListener('paste', (e) => {
	const item = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'))
	if (item) { e.preventDefault(); return useImage(URL.createObjectURL(item.getAsFile()), 'pasted picture') }
	const text = e.clipboardData?.getData('text') || ''
	if (/^https?:\\/\\/\\S+\\.(png|jpe?g|gif|webp|svg)(\\?\\S*)?$/i.test(text.trim()) && document.activeElement?.tagName !== 'INPUT') useUrl(text.trim())
})
$('search').onclick = search
$('q').onkeydown = (e) => { if (e.key === 'Enter') search() }
$('upload').onchange = () => { const f = $('upload').files[0]; if (f) useImage(URL.createObjectURL(f), f.name) }
$('iconAt').onchange = () => { if (iconImg) { icon = pngOfIcon(); drawIcon() } }
$('iconColour').onchange = () => { const on = document.querySelector('.ic.on'); if (on) pickIconify(on.title, on) }
$('noicon').onclick = () => { iconImg = null; icon = 'none'; iconName = ''; document.querySelectorAll('.ic').forEach((x) => x.classList.remove('on')); drawIcon() }

$('layout').onchange = $('rows').onchange = $('cols').onchange = () => { sel.clear(); draw() }
$('page').onchange = () => { sel.clear(); loadReady() }
$('all').onclick = () => { keys().forEach((k) => sel.add(k.row + '/' + k.col)); draw() }
$('none').onclick = () => { sel.clear(); draw() }
async function post(path, body) {
	// Plain text, so Companion passes it on as it is
	const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) })
	if (!res.ok) throw new Error('System Tools said ' + res.status + ': ' + (await res.text()).slice(0, 200))
	return res.json()
}
$('apply').onclick = async () => {
	if (!sel.size) return ($('log').innerHTML = '<span class="bad">Pick some keys first.</span>')
	const page = +$('page').value || 1
	let place = $('place').value
	if (icon && icon !== 'none' && $('iconAt').value === 'top' && place === 'keep') place = 'bottom' // text under the icon
	const look = { theme, size: $('size').value, place, textColour: $('textColour').value, text: $('text').value, icon }
	try {
		await post('apply', { page, keys: [...sel], look })
	} catch (e) { return ($('log').innerHTML = '<span class="bad">' + e.message + '</span>') }
	// Keys without the linked feedback: Companion's own style call (older keys take it; it can't set an icon)
	const style = await (await fetch('style-query?' + new URLSearchParams({ theme, size: $('size').value, place, textColour: $('textColour').value, text: $('text').value }))).text()
	const others = [...sel].filter((id) => !ready.has(id))
	if (style) for (const id of others) { const [r, c] = id.split('/'); await fetch('/api/location/' + page + '/' + r + '/' + c + '/style?' + style, { method: 'POST' }).catch(() => null) }
	const readyN = [...sel].filter((id) => ready.has(id)).length
	$('log').innerHTML = (readyN ? '<span class="ok">' + readyN + ' Styler-ready key(s) on page ' + page + ' restyled.</span>' : '') +
		(others.length ? '\\n<span class="bad">' + others.length + ' key(s) aren\\'t Styler-ready: they only change if they\\'re the older kind. To make a key ready, add the System Tools "Key style" feedback to it once (leave it on "From the Key Styler").</span>' : '')
	setTimeout(loadReady, 800)
}
$('reset').onclick = async () => {
	if (!sel.size) return ($('log').innerHTML = '<span class="bad">Pick some keys first.</span>')
	const r = await post('clear', { page: +$('page').value || 1, keys: [...sel] })
	$('log').innerHTML = '<span class="ok">The Styler\\'s look came off ' + r.saved + ' key(s).</span>'
}
drawIcon()
loadReady()
`
}
