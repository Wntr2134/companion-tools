import got from 'got'
import { InstanceStatus } from '@companion-module/base'

// Panasonic asks for at least 130 ms between commands to the same camera.
// Commands sent faster than that can be silently dropped (fast knob spins).
export const DEFAULT_COMMAND_INTERVAL = 130

const REQUEST_TIMEOUT = 2000

// The camera answers bad commands with an error string in the body instead of an HTTP error.
const CAMERA_ERRORS = {
	er1: 'unsupported command',
	er2: 'camera busy',
	er3: 'value out of range',
}

/**
 * One queue per camera: every HTTP command goes through here, in order, spaced
 * by the command interval. Jobs are functions, so a job can build its command
 * at the moment it is sent (used by the step actions to merge fast knob spins).
 */
export class CameraTransport {
	#self
	#chain = Promise.resolve()
	#lastSentAt = 0

	constructor(self) {
		this.#self = self
	}

	get #interval() {
		const n = Number(this.#self.config?.commandInterval)
		return Number.isFinite(n) && n >= 0 ? n : DEFAULT_COMMAND_INTERVAL
	}

	/** Queue a job. `job` is an async function that may call `this.get()`-style raw requests via the passed fetcher. */
	enqueue(job) {
		const run = this.#chain.then(async () => {
			const wait = this.#lastSentAt + this.#interval - Date.now()
			if (wait > 0) await new Promise((r) => setTimeout(r, wait))
			this.#lastSentAt = Date.now()
			return job((url) => this.#request(url))
		})
		this.#chain = run.catch(() => undefined)
		return run
	}

	/** Queue a plain GET of `url`, resolving to the response body. */
	get(url) {
		return this.enqueue((fetch) => fetch(url))
	}

	async #request(url) {
		const self = this.#self
		if (self.config.debug) self.log('debug', `Sending : ${url}`)

		let body
		try {
			// No automatic retries: a retried relative move (#RPC) would move the camera twice.
			const response = await got.get(url, { timeout: { request: REQUEST_TIMEOUT }, retry: { limit: 0 } })
			body = String(response.body ?? '').trim()
		} catch (err) {
			setStatus(self, InstanceStatus.ConnectionFailure, String(err?.code ?? err?.message ?? err))
			throw new Error(`Action failed: ${url} (${err?.message ?? err})`)
		}

		setStatus(self, InstanceStatus.Ok)
		if (self.config.debug) self.log('debug', `Received: ${body}`)

		const code = body.slice(0, 3).toLowerCase()
		if (CAMERA_ERRORS[code]) {
			self.log('warn', `Camera replied ${body} (${CAMERA_ERRORS[code]}) to ${url}`)
		}
		return body
	}
}

export function baseUrl(self) {
	return `http://${self.config.host}:${self.config.httpPort}`
}

/** Only report status changes, so every command doesn't spam Companion. */
export function setStatus(self, status, message) {
	const key = `${status}|${message ?? ''}`
	if (self._lastStatusKey === key) return
	self._lastStatusKey = key
	self.updateStatus(status, message)
}
