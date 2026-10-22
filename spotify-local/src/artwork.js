// Draws the "now playing" card for a key: the album art, darkened and softly blurred, with a thin
// progress bar along the bottom (Spotify green while playing, grey when paused). Companion puts the
// track text on top. Without album art (Windows, nothing playing) it uses Spotify's dark background.
import { deflateSync } from 'node:zlib'
import jpeg from 'jpeg-js'

export const SPOTIFY_GREEN = [30, 215, 96] // #1ED760
export const SPOTIFY_BLACK = [18, 18, 18] // #121212
const PAUSED_GREY = [150, 150, 150]

/** Spotify serves the same cover at several sizes; 300 px is plenty for a key and decodes fast. */
export function smallerArtUrl(url) {
	return String(url ?? '').replace('ab67616d0000b273', 'ab67616d00001e02')
}

/** Decode JPEG bytes to { width, height, data: RGBA }. */
export function decodeArt(bytes) {
	const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 })
	return { width: img.width, height: img.height, data: img.data }
}

/** Scale `art` to fill width×height (centre crop, like CSS object-fit: cover). Returns RGB. */
export function coverScale(art, width, height) {
	const out = new Uint8Array(width * height * 3)
	const scale = Math.max(width / art.width, height / art.height)
	const offX = (art.width * scale - width) / 2
	const offY = (art.height * scale - height) / 2
	for (let y = 0; y < height; y++) {
		const sy = Math.min(art.height - 1, Math.max(0, Math.floor((y + offY) / scale)))
		for (let x = 0; x < width; x++) {
			const sx = Math.min(art.width - 1, Math.max(0, Math.floor((x + offX) / scale)))
			const si = (sy * art.width + sx) * 4
			const di = (y * width + x) * 3
			out[di] = art.data[si]
			out[di + 1] = art.data[si + 1]
			out[di + 2] = art.data[si + 2]
		}
	}
	return out
}

/** Box blur (two passes), radius in pixels. RGB in, RGB out. */
export function boxBlur(rgb, width, height, radius) {
	if (radius < 1) return rgb
	const tmp = new Uint8Array(rgb.length)
	const out = new Uint8Array(rgb.length)
	const pass = (src, dst, horizontal) => {
		const len = horizontal ? width : height
		const lines = horizontal ? height : width
		for (let l = 0; l < lines; l++) {
			for (let c = 0; c < 3; c++) {
				let sum = 0
				const at = (i) => {
					const j = Math.min(len - 1, Math.max(0, i))
					return horizontal ? src[(l * width + j) * 3 + c] : src[(j * width + l) * 3 + c]
				}
				for (let i = -radius; i <= radius; i++) sum += at(i)
				for (let i = 0; i < len; i++) {
					const idx = horizontal ? (l * width + i) * 3 + c : (i * width + l) * 3 + c
					dst[idx] = sum / (radius * 2 + 1)
					sum += at(i + radius + 1) - at(i - radius)
				}
			}
		}
	}
	pass(rgb, tmp, true)
	pass(tmp, out, false)
	return out
}

/** The background without the progress bar: art (blurred, darkened) or Spotify black. */
export function cardBackground(art, width, height) {
	if (!art) {
		const out = new Uint8Array(width * height * 3)
		for (let y = 0; y < height; y++) {
			// a faint lift towards the top, like Spotify's own panels
			const lift = Math.round(14 * (1 - y / height))
			for (let x = 0; x < width; x++) {
				const i = (y * width + x) * 3
				out[i] = SPOTIFY_BLACK[0] + lift
				out[i + 1] = SPOTIFY_BLACK[1] + lift
				out[i + 2] = SPOTIFY_BLACK[2] + lift
			}
		}
		return out
	}
	const scaled = coverScale(art, width, height)
	const blurred = boxBlur(scaled, width, height, Math.max(1, Math.round(Math.min(width, height) / 12)))
	for (let i = 0; i < blurred.length; i++) blurred[i] = Math.round(blurred[i] * 0.42) // darken so white text reads
	return blurred
}

/** Copy of the background with the progress bar drawn on. progress 0-1, or null for no bar. */
export function withProgressBar(background, width, height, progress, playing) {
	const out = Uint8Array.from(background)
	if (progress === null || progress === undefined || !Number.isFinite(progress)) return out
	const barH = Math.max(2, Math.round(height * 0.035))
	const filled = Math.round(width * Math.min(1, Math.max(0, progress)))
	const fill = playing ? SPOTIFY_GREEN : PAUSED_GREY
	for (let y = height - barH; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3
			if (x < filled) {
				out[i] = fill[0]
				out[i + 1] = fill[1]
				out[i + 2] = fill[2]
			} else {
				// the unplayed part: a faint light line
				out[i] = Math.round(out[i] * 0.6 + 255 * 0.18)
				out[i + 1] = Math.round(out[i + 1] * 0.6 + 255 * 0.18)
				out[i + 2] = Math.round(out[i + 2] * 0.6 + 255 * 0.18)
			}
		}
	}
	return out
}

/**
 * Keeps the decoded cover for the current track and the drawn backgrounds per key size,
 * so the per-second redraw only adds the progress bar.
 */
export class ArtCache {
	constructor({ fetchBytes = defaultFetch, onReady = () => {} } = {}) {
		this.fetchBytes = fetchBytes
		this.onReady = onReady
		this.url = ''
		this.art = null
		this.loading = false
		this.backgrounds = new Map() // `${w}x${h}` -> RGB
	}

	/** Start loading the cover for this URL (once). Returns the decoded art if it's ready. */
	want(url) {
		const u = smallerArtUrl(url)
		if (u !== this.url) {
			this.url = u
			this.art = null
			this.backgrounds.clear()
			if (u) void this.#load(u)
		}
		return this.art
	}

	async #load(url) {
		this.loading = true
		try {
			const bytes = await this.fetchBytes(url)
			if (url !== this.url) return // the track changed meanwhile
			this.art = decodeArt(bytes)
			this.backgrounds.clear()
			this.onReady()
		} catch {
			// no cover: the plain Spotify background is used
		} finally {
			this.loading = false
		}
	}

	background(width, height) {
		const key = `${width}x${height}${this.art ? '' : ':plain'}`
		let bg = this.backgrounds.get(key)
		if (!bg) {
			bg = cardBackground(this.art, width, height)
			this.backgrounds.set(key, bg)
		}
		return bg
	}
}

async function defaultFetch(url) {
	if (!/^https:\/\/i\.scdn\.co\//.test(url)) throw new Error('not a Spotify image')
	const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
	if (!res.ok) throw new Error(`HTTP ${res.status}`)
	return new Uint8Array(await res.arrayBuffer())
}

// Companion 5 draws an advanced feedback's imageBuffer ON TOP of the key text, but a `png64` goes on
// the image layer underneath it, so the card is sent as a PNG. Either way Companion fits the picture
// inside the key without stretching, and it reports 72×58 for every key (even the D200X wide key),
// so the card is drawn at the shape the user picks rather than the size Companion reports.
export const CARD_SHAPES = {
	wide: { width: 229, height: 98 }, // D200X wide key, 458×196 at half size (blurred, so it scales up fine)
	square: { width: 98, height: 98 }, // normal keys
}

const CRC_TABLE = (() => {
	const t = new Int32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		t[n] = c
	}
	return t
})()

function crc32(buf) {
	let c = -1
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
	return (c ^ -1) >>> 0
}

function pngChunk(type, data) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(body))
	return Buffer.concat([len, body, crc])
}

/** Encode RGB pixels as a PNG. Returns base64 (what Companion's png64 style wants). */
export function encodePng(rgb, width, height) {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 2 // colour type: RGB
	const rows = Buffer.alloc((width * 3 + 1) * height)
	for (let y = 0; y < height; y++) {
		rows[y * (width * 3 + 1)] = 0 // filter: none
		Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(rows, y * (width * 3 + 1) + 1)
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', deflateSync(rows)),
		pngChunk('IEND', Buffer.alloc(0)),
	]).toString('base64')
}
