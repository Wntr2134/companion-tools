// Key styles: colours and text sizes for any key, without Companion's layer editor.
// The "Key style" feedback restyles a key you've already made (its actions and text stay as they are);
// the "Key styles" presets are ready-styled blank keys for new ones.
// No Companion dependency, so it can be tested on its own.

const rgb = (r, g, b) => ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
const WHITE = rgb(255, 255, 255)
const BLACK = rgb(0, 0, 0)

/** Colours, named for what they usually mean on a show desk. Text colour picked to read on each. */
export const THEMES = {
	red: { label: 'Red (stop / alert)', bg: rgb(200, 30, 30), fg: WHITE },
	green: { label: 'Green (go / live)', bg: rgb(0, 140, 60), fg: WHITE },
	amber: { label: 'Amber (standby)', bg: rgb(230, 150, 0), fg: BLACK },
	yellow: { label: 'Yellow', bg: rgb(240, 210, 0), fg: BLACK },
	blue: { label: 'Blue', bg: rgb(10, 110, 230), fg: WHITE },
	teal: { label: 'Teal', bg: rgb(0, 140, 150), fg: WHITE },
	purple: { label: 'Purple', bg: rgb(120, 60, 200), fg: WHITE },
	pink: { label: 'Pink', bg: rgb(220, 60, 140), fg: WHITE },
	orange: { label: 'Orange', bg: rgb(235, 100, 20), fg: WHITE },
	grey: { label: 'Grey', bg: rgb(70, 70, 76), fg: WHITE },
	dark: { label: 'Dark (the usual key)', bg: rgb(24, 26, 30), fg: WHITE },
	white: { label: 'White', bg: rgb(240, 240, 240), fg: BLACK },
	black: { label: 'Black', bg: BLACK, fg: WHITE },
}

/** Text sizes that fit a 72 px Stream Deck key as well as the D200X. */
export const SIZES = {
	keep: { label: "Keep the key's text size" },
	auto: { label: 'Fit the text (auto)', size: 'auto' },
	one: { label: 'Big: one short word', size: '30' },
	two: { label: 'Two lines', size: '18' },
	three: { label: 'Three lines (small)', size: '14' },
}

export const PLACES = {
	keep: { label: 'Keep where the text is' },
	top: { label: 'Top', alignment: 'center:top' },
	middle: { label: 'Middle', alignment: 'center:center' },
	bottom: { label: 'Bottom', alignment: 'center:bottom' },
}

/**
 * The style the "Key style" feedback puts on a key (only what was picked; the rest of the key stays).
 * theme '' keeps the key's colours; text and icon (a PNG, base64) come from the Key Styler.
 */
export function keyStyle({ theme = 'dark', size = 'keep', place = 'keep', textColour = 'auto', text, icon, hideText } = {}) {
	const out = {}
	if (theme !== '') {
		const t = THEMES[theme] ?? THEMES.dark
		out.bgcolor = t.bg
		out.color = textColour === 'white' ? WHITE : textColour === 'black' ? BLACK : t.fg
	} else if (textColour === 'white' || textColour === 'black') out.color = textColour === 'white' ? WHITE : BLACK
	if (SIZES[size]?.size) out.size = SIZES[size].size
	if (PLACES[place]?.alignment) out.alignment = PLACES[place].alignment
	if (typeof text === 'string' && text !== '') out.text = text
	if (hideText === true || hideText === 'true') out.text = ' ' // a logo key: no name under it
	if (typeof icon === 'string' && icon !== '') {
		out.png64 = icon
		out.pngalignment = 'center:center'
	}
	return out
}

// ---------- the Key Styler's saved looks ----------

const PICKED = ['theme', 'size', 'place', 'textColour', 'text', 'icon']
const MAX_ICON = 200 * 1024 // base64 characters: a key's picture is small

/** Keys as "page/row/column". */
export const keyAt = (page, row, col) => `${Number(page)}/${Number(row)}/${Number(col)}`

/**
 * Saves a look for keys in the Styler's store: { "page/row/col": { theme, size, … } }. Only what was
 * picked changes ('keep' and blank leave the saved value); icon: 'none' takes the icon off.
 * Returns the keys changed.
 */
export function applyLook(store, page, keys, look = {}) {
	const changed = []
	for (const k of keys ?? []) {
		const [row, col] = String(k).split('/').map(Number)
		if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row > 99 || col > 99) continue
		const at = keyAt(page, row, col)
		const cur = { ...(store[at] ?? {}) }
		for (const f of PICKED) {
			const v = look[f]
			if (v === undefined || v === null || v === '' || v === 'keep') continue
			if (f === 'icon') {
				if (v === 'none') delete cur.icon
				else if (typeof v === 'string' && v.length <= MAX_ICON && /^[A-Za-z0-9+/=]+$/.test(v)) cur.icon = v
				continue
			}
			if (f === 'text' && v === 'none') {
				// the key's own text back
				delete cur.text
				delete cur.hideText
				continue
			}
			if (f === 'text') delete cur.hideText
			cur[f] = String(v).slice(0, 200)
		}
		if (look.hideText === 'yes') {
			cur.hideText = true
			delete cur.text
		}
		if (cur.theme === undefined) cur.theme = '' // nothing picked: keep the key's own colours
		store[at] = cur
		changed.push(at)
	}
	return changed
}

/** Takes the Styler's look off keys. */
export function clearLook(store, page, keys) {
	let n = 0
	for (const k of keys ?? []) {
		const [row, col] = String(k).split('/').map(Number)
		const at = keyAt(page, row, col)
		if (at in store) {
			delete store[at]
			n++
		}
	}
	return n
}

/** Ready-styled blank keys: every colour as a two-line key, and a few labels for naming rows. */
export function stylePresets() {
	const presets = {}
	const key = (name, text, style) => ({
		type: 'button',
		category: 'Key styles (drag onto an empty key, then add actions)',
		name,
		style: { text, show_topbar: false, ...style },
		steps: [{ down: [], up: [] }],
		feedbacks: [],
	})
	for (const [id, t] of Object.entries(THEMES)) {
		presets[`style_${id}`] = key(`${t.label}: two lines`, 'TWO\\nLINES', { size: '18', color: t.fg, bgcolor: t.bg })
	}
	presets.style_big = key('Big word (green)', 'GO', { size: '30', color: WHITE, bgcolor: THEMES.green.bg })
	presets.style_small = key('Three small lines (dark)', 'THREE\\nSMALL\\nLINES', { size: '14', color: WHITE, bgcolor: THEMES.dark.bg })
	presets.style_header = key('Row label (no background)', 'ROW\\nLABEL', { size: '14', color: rgb(180, 180, 190), bgcolor: BLACK, alignment: 'center:bottom' })
	return presets
}
