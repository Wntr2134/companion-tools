// Apple Music branding for every key: a faint music note behind the label, in Apple Music red, so these
// keys stand apart from other apps' keys (Spotify's are green) at a glance. Sent as the preset's png64,
// which Companion draws under the text.
import { encodePng } from './artwork.js'

const SIZE = 72
const SS = 4 // supersampling per axis, for smooth edges
const TILT = (-20 * Math.PI) / 180

function inHead(x, y, cx, cy) {
	const dx = x - cx
	const dy = y - cy
	const u = dx * Math.cos(TILT) + dy * Math.sin(TILT)
	const v = -dx * Math.sin(TILT) + dy * Math.cos(TILT)
	return (u / 0.155) ** 2 + (v / 0.11) ** 2 <= 1
}

/** A beamed pair of notes (♫) in a unit square. */
function inNote(x, y) {
	if (inHead(x, y, 0.3, 0.8) || inHead(x, y, 0.74, 0.72)) return true
	const beamTop = 0.2 - 0.16 * (x - 0.385)
	if (x >= 0.385 && x <= 0.885 && y >= beamTop && y <= beamTop + 0.13) return true // beam
	if (x >= 0.385 && x <= 0.445 && y >= 0.2 && y <= 0.78) return true // left stem
	if (x >= 0.825 && x <= 0.885 && y >= 0.13 && y <= 0.7) return true // right stem
	return false
}

/** Coverage 0-1 of the mark at each pixel of a size×size square (the mark fills `scale` of it). */
export function markCoverage(size = SIZE, scale = 0.7) {
	const out = new Float32Array(size * size)
	const pad = (1 - scale) / 2
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			let hit = 0
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const x = ((px + (sx + 0.5) / SS) / size - pad) / scale
					const y = ((py + (sy + 0.5) / SS) / size - pad) / scale
					if (inNote(x, y)) hit++
				}
			}
			out[py * size + px] = hit / (SS * SS)
		}
	}
	return out
}

/** The mark as a transparent PNG (base64): Apple Music red at `opacity`, the key colour shows through. */
export function markPng(rgb = [250, 45, 72], opacity = 0.3, size = SIZE) {
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
