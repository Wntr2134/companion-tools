// Knob-friendly step actions: one knob click = one fixed step, however fast the knob is turned.
//
// Zoom and focus move to an exact position (#AXZ / #AXF). The module reads where the lens is
// once, then keeps its own running target while the knob is turning, so fast spins add up
// instead of being lost. Pan/tilt use relative moves (#RPC); clicks that arrive while a
// command is waiting are merged into one move.
import { baseUrl } from './transport.js'

export const LENS_MIN = 0x555
export const LENS_MAX = 0xfff
const PT_CENTRE = 0x8000

// After this long without a step, re-read the camera position before the next step
// (someone may have moved the lens from another controller in the meantime).
const TARGET_STALE_MS = 1500

const hex = (n, width) => Math.round(n).toString(16).toUpperCase().padStart(width, '0')
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

export function lensToPercent(raw) {
	return Math.round(((raw - LENS_MIN) / (LENS_MAX - LENS_MIN)) * 1000) / 10
}

export function percentToLens(pct) {
	return Math.round(LENS_MIN + (clamp(pct, 0, 100) / 100) * (LENS_MAX - LENS_MIN))
}

/** Parse a camera reply (or a camdata.html line) into position fields. */
export function parsePosition(text) {
	const out = {}
	for (const line of String(text).split(/\r?\n/)) {
		const t = line.trim()
		let m
		if ((m = /^(?:gz|axz)([0-9A-F]{3})$/i.exec(t))) out.zoom = parseInt(m[1], 16)
		else if ((m = /^(?:gf|axf)([0-9A-F]{3})$/i.exec(t))) out.focus = parseInt(m[1], 16)
		else if ((m = /^aPC([0-9A-F]{4})([0-9A-F]{4})$/i.exec(t))) {
			out.pan = parseInt(m[1], 16)
			out.tilt = parseInt(m[2], 16)
		}
	}
	return out
}

export class StepController {
	#self
	#lens = {
		zoom: { target: null, lastStep: 0, reading: null, sendQueued: false, query: 'GZ', set: 'AXZ' },
		focus: { target: null, lastStep: 0, reading: null, sendQueued: false, query: 'GF', set: 'AXF' },
	}
	#pending = { pan: 0, tilt: 0, queued: false }
	#unsupported = new Set()

	constructor(self) {
		this.#self = self
	}

	// ---------- positions ----------

	/** Store positions and publish them as variables. */
	store(pos) {
		const self = this.#self
		const values = {}
		if (pos.zoom !== undefined) {
			self.data.zoomPosition = pos.zoom
			values.zoomPosition = lensToPercent(pos.zoom)
			values.zoomPositionRaw = hex(pos.zoom, 3)
		}
		if (pos.focus !== undefined) {
			self.data.focusPosition = pos.focus
			values.focusPosition = lensToPercent(pos.focus)
			values.focusPositionRaw = hex(pos.focus, 3)
		}
		if (pos.pan !== undefined) {
			self.data.panPosition = pos.pan
			values.panPosition = hex(pos.pan, 4)
		}
		if (pos.tilt !== undefined) {
			self.data.tiltPosition = pos.tilt
			values.tiltPosition = hex(pos.tilt, 4)
		}
		if (Object.keys(values).length) self.setVariableValues(values)
	}

	async #command(cmd) {
		const self = this.#self
		return self.transport.get(`${baseUrl(self)}/cgi-bin/aw_ptz?cmd=%23${cmd}&res=1`)
	}

	/** Read one lens axis: direct query first, then camdata.html as a fallback. */
	async #readLens(axis) {
		const lens = this.#lens[axis]
		try {
			if (this.#unsupported.has(lens.query)) throw new Error('unsupported')
			const reply = await this.#command(lens.query)
			this.#markIfUnsupported(lens.query, reply)
			const pos = parsePosition(reply)
			if (pos[axis] !== undefined) {
				this.store(pos)
				return pos[axis]
			}
		} catch {
			// fall through to camdata
		}
		const pos = parsePosition(await this.#self.transport.get(`${baseUrl(this.#self)}/live/camdata.html`))
		this.store(pos)
		if (pos[axis] === undefined) throw new Error(`Camera did not report its ${axis} position`)
		return pos[axis]
	}

	/** Refresh every position the camera will report. Errors are logged, not thrown. */
	async refreshPositions() {
		const self = this.#self
		let needCamdata = false
		for (const [axis, lens] of Object.entries(this.#lens)) {
			// Don't overwrite a target that is mid-knob-turn.
			if (Date.now() - lens.lastStep < TARGET_STALE_MS) continue
			if (this.#unsupported.has(lens.query)) {
				needCamdata = true
				continue
			}
			try {
				const reply = await this.#command(lens.query)
				if (this.#markIfUnsupported(lens.query, reply)) needCamdata = true
				else this.store(parsePosition(reply))
			} catch (e) {
				if (self.config.debug) self.log('debug', `Position read (${axis}) failed: ${e.message}`)
			}
		}
		if (needCamdata) {
			try {
				const pos = parsePosition(await self.transport.get(`${baseUrl(self)}/live/camdata.html`))
				for (const axis of Object.keys(this.#lens)) {
					if (Date.now() - this.#lens[axis].lastStep < TARGET_STALE_MS) delete pos[axis]
				}
				this.store(pos)
			} catch (e) {
				if (self.config.debug) self.log('debug', `Position read (camdata) failed: ${e.message}`)
			}
		}
		if (!this.#unsupported.has('APC')) {
			try {
				const reply = await this.#command('APC')
				if (!this.#markIfUnsupported('APC', reply)) this.store(parsePosition(reply))
			} catch (e) {
				if (self.config.debug) self.log('debug', `Position read (pan/tilt) failed: ${e.message}`)
			}
		}
	}

	/** Remember queries the camera rejects (er1), so polling doesn't keep asking. */
	#markIfUnsupported(query, reply) {
		if (!/^er1/i.test(String(reply).trim())) return false
		if (!this.#unsupported.has(query)) {
			this.#unsupported.add(query)
			this.#self.log('info', `Camera doesn't support #${query}; using fallbacks for position reads`)
		}
		return true
	}

	// ---------- zoom / focus ----------

	async #baseTarget(axis) {
		const lens = this.#lens[axis]
		if (lens.target !== null && Date.now() - lens.lastStep < TARGET_STALE_MS) return lens.target
		// Several clicks may arrive before the first read finishes: share one read.
		if (!lens.reading) {
			lens.reading = this.#readLens(axis).finally(() => {
				lens.reading = null
			})
		}
		const current = await lens.reading
		// Another click may have set a fresh target while we waited.
		if (lens.target !== null && Date.now() - lens.lastStep < TARGET_STALE_MS) return lens.target
		return current
	}

	/** Move zoom or focus by `delta` raw units (positive = tele / far). */
	async stepLens(axis, delta) {
		const lens = this.#lens[axis]
		const base = await this.#baseTarget(axis)
		lens.target = clamp(base + delta, LENS_MIN, LENS_MAX)
		lens.lastStep = Date.now()
		this.#queueLensSend(axis)
	}

	/** Move zoom or focus to an absolute raw position. */
	async setLens(axis, raw) {
		const lens = this.#lens[axis]
		lens.target = clamp(raw, LENS_MIN, LENS_MAX)
		lens.lastStep = Date.now()
		this.#queueLensSend(axis)
	}

	#queueLensSend(axis) {
		const lens = this.#lens[axis]
		if (lens.sendQueued) return // the queued send will pick up the newest target
		lens.sendQueued = true
		this.#self.transport
			.enqueue(async (fetch) => {
				lens.sendQueued = false
				const target = lens.target
				const reply = await fetch(`${baseUrl(this.#self)}/cgi-bin/aw_ptz?cmd=%23${lens.set}${hex(target, 3)}&res=1`)
				const pos = parsePosition(reply)
				this.store(pos[axis] !== undefined ? pos : { [axis]: target })
			})
			.catch((e) => {
				lens.sendQueued = false
				this.#self.log('error', `${axis} step failed: ${e.message}`)
			})
	}

	// ---------- pan / tilt ----------

	/** Relative pan/tilt step in raw units (positive pan = right, positive tilt = up). */
	stepPanTilt(dPan, dTilt) {
		const p = this.#pending
		p.pan += dPan
		p.tilt += dTilt
		if (p.queued) return
		p.queued = true
		this.#self.transport
			.enqueue(async (fetch) => {
				p.queued = false
				const pan = clamp(PT_CENTRE + p.pan, 1, 0xffff)
				const tilt = clamp(PT_CENTRE + p.tilt, 1, 0xffff)
				p.pan = 0
				p.tilt = 0
				if (pan === PT_CENTRE && tilt === PT_CENTRE) return // clicks cancelled out
				await fetch(`${baseUrl(this.#self)}/cgi-bin/aw_ptz?cmd=%23RPC${hex(pan, 4)}${hex(tilt, 4)}&res=1`)
			})
			.catch((e) => {
				p.queued = false
				this.#self.log('error', `Pan/tilt step failed: ${e.message}`)
			})
	}
}

// ---------- action definitions ----------

// Step size 1 (tiny, smooth when turned continuously) to 10 (huge). Default 2.
export const STEP_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
export const DEFAULT_STEP_SIZE = 2
// Pan/tilt: camera units per click (1280 = hex 0500).
export const PAN_TILT_STEP_UNITS = [256, 640, 1024, 1280, 1920, 2560, 3584, 5120, 7168, 10240]
// Zoom/focus: % of the full lens range per click.
export const LENS_STEP_PERCENT = [0.4, 1, 1.5, 2, 3, 4, 6, 8, 12, 16]

export function stepLevel(options) {
	const n = Math.round(Number(options?.size))
	return STEP_SIZES.includes(n) ? n : DEFAULT_STEP_SIZE
}

const sizeOption = {
	type: 'dropdown',
	id: 'size',
	label: 'Step size',
	default: DEFAULT_STEP_SIZE,
	choices: STEP_SIZES.map((n) => ({
		id: n,
		label: n === 1 ? '1 (tiny, smoothest)' : n === DEFAULT_STEP_SIZE ? `${n} (default)` : n === 10 ? '10 (huge)' : String(n),
	})),
	tooltip: 'How far one knob click moves. 1 = tiny steps for smooth continuous turning, 10 = big jumps.',
}

// ---------- selected camera ----------
// Several cameras can share the same knobs: each knob action is put on the button once per
// camera, with "Only when this camera is selected" ticked. A Companion custom variable
// (default $(custom:ptz_cam)) holds the selected camera number; each connection has its own
// number in its settings.

export const DEFAULT_SELECT_VARIABLE = '$(custom:ptz_cam)'

export async function isSelectedCamera(self, context) {
	const parse = context?.parseVariablesInString ?? self.parseVariablesInString?.bind(self)
	if (!parse) return true
	const value = String(await parse(self.config.selectVariable || DEFAULT_SELECT_VARIABLE)).trim()
	return value === String(self.config.cameraNumber ?? 1).trim()
}

const onlySelectedOption = {
	type: 'checkbox',
	id: 'onlyIfSelected',
	label: 'Only when this camera is selected',
	default: false,
	tooltip: 'Tick this to share one knob between several cameras. See "Selected camera" in the help.',
}

export function getStepActionDefinitions(self) {
	const steps = () => self.steps
	const lensUnits = (options) =>
		Math.max(1, Math.round((LENS_STEP_PERCENT[stepLevel(options) - 1] / 100) * (LENS_MAX - LENS_MIN)))

	return {
		knobPanTiltStep: {
			name: 'Knob - Pan/Tilt step',
			description: 'One fixed pan or tilt step per click. Put Left/Down on Rotate left and Right/Up on Rotate right.',
			options: [
				{
					type: 'dropdown',
					id: 'direction',
					label: 'Direction',
					default: 'right',
					choices: [
						{ id: 'left', label: 'Pan left' },
						{ id: 'right', label: 'Pan right' },
						{ id: 'up', label: 'Tilt up' },
						{ id: 'down', label: 'Tilt down' },
					],
				},
				sizeOption,
				onlySelectedOption,
			],
			callback: async (action, context) => {
				if (action.options.onlyIfSelected && !(await isSelectedCamera(self, context))) return
				const n = PAN_TILT_STEP_UNITS[stepLevel(action.options) - 1]
				const d = action.options.direction
				steps().stepPanTilt(d === 'right' ? n : d === 'left' ? -n : 0, d === 'up' ? n : d === 'down' ? -n : 0)
			},
		},

		knobZoomStep: {
			name: 'Knob - Zoom step',
			description: 'One fixed zoom step per click, to an exact lens position. Fast spins add up instead of running away.',
			options: [
				{
					type: 'dropdown',
					id: 'direction',
					label: 'Direction',
					default: 'in',
					choices: [
						{ id: 'in', label: 'Zoom in (tele)' },
						{ id: 'out', label: 'Zoom out (wide)' },
					],
				},
				sizeOption,
				{
					type: 'dropdown',
					id: 'method',
					label: 'Method',
					default: 'position',
					choices: [
						{ id: 'position', label: 'Exact position (recommended)' },
						{ id: 'web', label: 'Camera web step (directctrl zoom=±1)' },
					],
					tooltip: 'Use "Camera web step" only if exact position does not work on your camera. Step size does not apply to it.',
				},
				onlySelectedOption,
			],
			callback: async (action, context) => {
				if (action.options.onlyIfSelected && !(await isSelectedCamera(self, context))) return
				const sign = action.options.direction === 'out' ? -1 : 1
				if (action.options.method === 'web') {
					await self.transport.get(`${baseUrl(self)}/cgi-bin/directctrl?zoom=${sign}`)
					return
				}
				await steps().stepLens('zoom', sign * lensUnits(action.options))
			},
		},

		knobFocusStep: {
			name: 'Knob - Focus step',
			description: 'One fixed focus step per click. Focus only moves in manual focus mode.',
			options: [
				{
					type: 'dropdown',
					id: 'direction',
					label: 'Direction',
					default: 'far',
					choices: [
						{ id: 'far', label: 'Focus far' },
						{ id: 'near', label: 'Focus near' },
					],
				},
				sizeOption,
				{
					type: 'checkbox',
					id: 'manual',
					label: 'Switch camera to manual focus first',
					default: true,
				},
				onlySelectedOption,
			],
			callback: async (action, context) => {
				if (action.options.onlyIfSelected && !(await isSelectedCamera(self, context))) return
				if (action.options.manual && self.data.oaf !== 'Manual') {
					await self.transport.get(`${baseUrl(self)}/cgi-bin/aw_ptz?cmd=%23D10&res=1`)
					self.data.oaf = 'Manual'
				}
				const sign = action.options.direction === 'near' ? -1 : 1
				await steps().stepLens('focus', sign * lensUnits(action.options))
			},
		},

		lensGoToPosition: {
			name: 'Lens - Go to zoom/focus position (%)',
			description: '0% = wide / near, 100% = tele / far.',
			options: [
				{
					type: 'dropdown',
					id: 'axis',
					label: 'Lens',
					default: 'zoom',
					choices: [
						{ id: 'zoom', label: 'Zoom' },
						{ id: 'focus', label: 'Focus' },
					],
				},
				{ type: 'number', id: 'percent', label: 'Position (%)', default: 0, min: 0, max: 100, step: 0.1 },
				onlySelectedOption,
			],
			callback: async (action, context) => {
				if (action.options.onlyIfSelected && !(await isSelectedCamera(self, context))) return
				await steps().setLens(action.options.axis, percentToLens(Number(action.options.percent)))
			},
		},

		refreshPositions: {
			name: 'Position - Refresh zoom/focus/pan/tilt variables',
			options: [],
			callback: async () => {
				await steps().refreshPositions()
			},
		},
	}
}
