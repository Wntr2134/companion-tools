// Spotify branding for every key: a faint Spotify mark behind the label, so Spotify keys stand apart
// from other apps' keys at a glance. Sent as the preset's png64, which Companion draws under the text.
import { encodePng } from './artwork.js'

const SIZE = 72
const SS = 4 // supersampling per axis, for smooth edges

// The mark in a unit square: a circle (radius 0.5) with three arcs cut out of it.
// Each arc: a stroke of a circle centred below (cx 0.5, cy), radius r, width t, spanning ±half degrees.
const ARCS = [
	{ cy: 0.95, r: 0.62, t: 0.105, half: 31 },
	{ cy: 0.98, r: 0.47, t: 0.09, half: 31 },
	{ cy: 1.0, r: 0.335, t: 0.075, half: 31 },
]

function inArc(x, y, { cy, r, t, half }) {
	const dx = x - 0.5
	const dy = y - cy
	const angle = (Math.atan2(dx, -dy) * 180) / Math.PI // 0 = straight up
	if (Math.abs(angle) <= half) return Math.abs(Math.hypot(dx, dy) - r) <= t / 2
	// rounded ends
	const end = ((Math.sign(angle) * half) * Math.PI) / 180
	return Math.hypot(x - (0.5 + r * Math.sin(end)), y - (cy - r * Math.cos(end))) <= t / 2
}

/** Coverage 0-1 of the mark at each pixel of a size×size square (the mark fills `scale` of it). */
export function markCoverage(size = SIZE, scale = 0.8) {
	const out = new Float32Array(size * size)
	const pad = (1 - scale) / 2
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			let hit = 0
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const x = ((px + (sx + 0.5) / SS) / size - pad) / scale
					const y = ((py + (sy + 0.5) / SS) / size - pad) / scale
					if (Math.hypot(x - 0.5, y - 0.5) > 0.5) continue
					if (ARCS.some((a) => inArc(x, y, a))) continue
					hit++
				}
			}
			out[py * size + px] = hit / (SS * SS)
		}
	}
	return out
}

/** The mark as a transparent PNG (base64): Spotify green at `opacity`, the key colour shows through. */
export function markPng(rgb = [30, 215, 96], opacity = 0.22, size = SIZE) {
	const cov = markCoverage(size)
	const px = new Uint8Array(size * size * 4)
	for (let i = 0; i < cov.length; i++) {
		px[i * 4] = rgb[0]
		px[i * 4 + 1] = rgb[1]
		px[i * 4 + 2] = rgb[2]
		px[i * 4 + 3] = Math.round(255 * opacity * cov[i])
	}
	return encodePng(px, size, size, 4)
}

let cached = null

/** Adds the mark behind every preset that doesn't already set its own image. Returns a new object. */
export function withBrand(presets) {
	cached ??= markPng()
	const out = {}
	for (const [id, p] of Object.entries(presets)) {
		out[id] = p.style && p.style.png64 === undefined ? { ...p, style: { ...p.style, png64: cached, pngalignment: 'center:center' } } : p
	}
	return out
}
