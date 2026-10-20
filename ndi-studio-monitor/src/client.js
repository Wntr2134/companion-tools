// HTTP client for NDI Studio Monitor's built-in web server (Windows NDI Tools).
// Endpoints: GET /v1/sources, GET/POST /v1/configuration, GET/POST /v1/recording.
// Studio Monitor uses HTTP digest auth (default admin/admin) and sends an empty realm.
import { createHash, randomBytes } from 'node:crypto'

const md5 = (s) => createHash('md5').update(s).digest('hex')

/** Parse a WWW-Authenticate: Digest ... header into { realm, nonce, qop, opaque }. Empty realm allowed. */
export function parseChallenge(header) {
	const out = {}
	const text = String(header ?? '').replace(/^\s*Digest\s+/i, '')
	const re = /(\w+)=(?:"([^"]*)"|([^\s,]*))/g
	let m
	while ((m = re.exec(text))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
	return out
}

/** The Authorization header for one request. */
export function digestHeader({ method, uri, user, pass, challenge, nc, cnonce = randomBytes(8).toString('hex') }) {
	const realm = challenge.realm ?? ''
	const qop = (challenge.qop || '').split(',')[0].trim()
	const ha1 = md5(`${user}:${realm}:${pass}`)
	const ha2 = md5(`${method.toUpperCase()}:${uri}`)
	const ncStr = String(nc).padStart(8, '0')
	const response = qop ? md5(`${ha1}:${challenge.nonce}:${ncStr}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${challenge.nonce}:${ha2}`)
	let h = `Digest username="${user}", realm="${realm}", nonce="${challenge.nonce}", uri="${uri}", response="${response}"`
	if (challenge.opaque) h += `, opaque="${challenge.opaque}"`
	if (qop) h += `, qop="${qop}", nc="${ncStr}", cnonce="${cnonce}"` // quoted like the old Bitfocus module, which Studio Monitor accepts
	return h
}

export class AuthError extends Error {}

export class StudioMonitorClient {
	constructor({ host, port = 80, user = 'admin', pass = 'admin', timeoutMs = 2000 }) {
		this.base = `http://${host}:${port}`
		this.user = user
		this.pass = pass
		this.timeoutMs = timeoutMs
		this.challenge = null
		this.nc = 0
	}

	async #send(method, path, body) {
		const headers = {}
		if (body !== undefined) headers['Content-Type'] = 'application/json'
		if (this.challenge) headers.Authorization = digestHeader({ method, uri: path, user: this.user, pass: this.pass, challenge: this.challenge, nc: ++this.nc })
		return fetch(this.base + path, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(this.timeoutMs),
		})
	}

	/** One request; logs in (or logs in again with a fresh nonce) once if Studio Monitor asks. */
	async request(method, path, body) {
		let res = await this.#send(method, path, body)
		if (res.status === 401) {
			await res.arrayBuffer().catch(() => null)
			const challenge = parseChallenge(res.headers.get('www-authenticate'))
			if (!challenge.nonce) throw new AuthError('Studio Monitor wants a password but sent no login challenge')
			this.challenge = challenge
			this.nc = 0
			res = await this.#send(method, path, body)
			if (res.status === 401) {
				await res.arrayBuffer().catch(() => null)
				this.challenge = null
				throw new AuthError('Wrong web user or password')
			}
		}
		const text = await res.text()
		if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`)
		if (!text) return null
		try {
			return JSON.parse(text)
		} catch {
			return text // e.g. "Configuration updated."
		}
	}

	async sources() {
		const r = await this.request('GET', '/v1/sources')
		return Array.isArray(r?.ndi_sources) ? r.ndi_sources.filter((s) => typeof s === 'string' && s) : []
	}

	configuration() {
		return this.request('GET', '/v1/configuration')
	}

	/** Change part of the configuration, e.g. { NDI_source: 'PC (Cam 1)' }. */
	setConfiguration(changes) {
		return this.request('POST', '/v1/configuration', { version: 1, ...changes })
	}

	recording() {
		return this.request('GET', '/v1/recording')
	}

	setRecording(on) {
		return this.request('POST', '/v1/recording', { recording: !!on })
	}
}
