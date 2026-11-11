// Signing in with a Grid Connect account to list its devices and their local keys, the way the Grid
// Connect app does (Tuya's mobile "api.json" protocol). Used once, or when devices change: after that
// the lights are controlled straight over the LAN (tuya.js), not through the cloud.
// The protocol was worked out by the community (github.com/rickevans86/HomeAssistant_GridConnect); this
// is our own implementation of it. The constants identify the Grid Connect app (they're in its public
// download), not any person. No Companion dependency, so it can be tested on its own.
import crypto from 'node:crypto'
import { gunzipSync } from 'node:zlib'

export const APP = {
	package: 'com.arlec.gridconnect',
	version: '3.0.0',
	sdk: '7.8.0',
	ttid: 'gridconnect',
	key: 'k584ttaqt7f4huakhtgp',
	secret: 'c5t98m3kp7atcnspggcqewp5cqhnfuum',
	cert: 'D2:2E:4F:CC:03:E0:91:F6:42:55:8A:AC:5A:D9:63:E6:8D:AD:C0:83:5D:D0:BD:DE:FC:ED:AD:29:5B:46:41:3F',
	hidden: 'yg7pds9ap4vd3vj8t8cjy5agvj4jygay',
}
const SIGN_KEY = `${APP.package}_${APP.cert}_${APP.hidden}_${APP.secret}`
const SIGNED = new Set(['a', 'v', 'lat', 'lon', 'lang', 'deviceId', 'appVersion', 'ttid', 'isH5', 'h5Token', 'os', 'clientId', 'postData', 'time', 'requestId', 'et', 'n4h5', 'sid', 'chKey', 'sp'])

/** Tuya's data centres: an account lives on one; the others say it doesn't exist. Australian ones are mostly first. */
export const REGIONS = {
	us: 'https://a1.tuyaus.com/api.json',
	eu: 'https://a1.tuyaeu.com/api.json',
	in: 'https://a1.tuyain.com/api.json',
	'us-az': 'https://a1-ueaz.tuyaus.com/api.json',
	'eu-az': 'https://a1-weaz.tuyaeu.com/api.json',
	cn: 'https://a1.tuyacn.com/api.json',
}

const hmacHex = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex')
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

/** The request's signature: the signed fields sorted, "k=v" joined with "||"; postData by a shuffled MD5. */
export function signParams(params, key = SIGN_KEY) {
	const fold = (s) => {
		const h = md5(s)
		return h.slice(8, 16) + h.slice(0, 8) + h.slice(24, 32) + h.slice(16, 24)
	}
	const pre = Object.keys(params)
		.filter((k) => SIGNED.has(k) && params[k])
		.sort()
		.map((k) => `${k}=${k === 'postData' ? fold(params[k]) : params[k]}`)
		.join('||')
	return hmacHex(key, pre)
}

/** The app's channel key, sent with every request. */
export const channelKey = () => hmacHex(APP.key, `${APP.package}_${APP.cert}`).slice(8, 16)

/** Each request's body key: from its id, and after sign-in the session's ecode. */
export const bodyKey = (requestId, ecode) => Buffer.from(hmacHex(requestId, ecode ? `${SIGN_KEY}_${ecode}` : SIGN_KEY).slice(0, 16), 'ascii')

/** AES-128-GCM: nonce(12) + ciphertext + tag(16), base64. */
export function sealBody(key, text, nonce = crypto.randomBytes(12)) {
	const c = crypto.createCipheriv('aes-128-gcm', key, nonce)
	const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
	return Buffer.concat([nonce, body, c.getAuthTag()]).toString('base64')
}

export function openBody(key, b64) {
	const blob = Buffer.from(b64, 'base64')
	if (blob.length < 28) throw new Error('reply too short')
	const d = crypto.createDecipheriv('aes-128-gcm', key, blob.subarray(0, 12))
	d.setAuthTag(blob.subarray(blob.length - 16))
	let plain = Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()])
	if (plain[0] === 0x1f && plain[1] === 0x8b) plain = gunzipSync(plain)
	return plain.toString('utf8')
}

const b64url = (n) => {
	let hex = BigInt(n).toString(16)
	if (hex.length % 2) hex = `0${hex}`
	return Buffer.from(hex, 'hex').toString('base64url')
}

/** The password as the app sends it: RSA (PKCS#1 v1.5, the server's one-off key, decimal) of its MD5 in hex. */
export function wrapPassword(password, modulusDecimal, exponentDecimal) {
	const key = crypto.createPublicKey({ key: { kty: 'RSA', n: b64url(modulusDecimal), e: b64url(exponentDecimal) }, format: 'jwk' })
	return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(md5(password), 'utf8')).toString('hex')
}

export class GridConnectCloud {
	constructor({ region = 'us', country = '61', fetchFn = fetch, timeout = 20000 } = {}) {
		if (!REGIONS[region]) throw new Error(`unknown region ${region}`)
		this.region = region
		this.endpoint = REGIONS[region]
		this.country = String(country)
		this.fetch = fetchFn
		this.timeout = timeout
		this.deviceId = crypto.randomBytes(22).toString('hex')
		this.sid = ''
		this.ecode = null
	}

	async call(api, version, postData, { session = true, extra = {} } = {}) {
		const requestId = crypto.randomUUID()
		const params = {
			a: api.startsWith('thing') ? `smartlife${api.slice(5)}` : api,
			v: version,
			clientId: APP.key,
			os: 'Android',
			lang: 'en',
			ttid: APP.ttid,
			appVersion: APP.version,
			sdkVersion: APP.sdk,
			time: String(Math.floor(Date.now() / 1000)),
			requestId,
			deviceId: this.deviceId,
			et: '3',
			cp: 'gzip',
			chKey: channelKey(),
			...(session && this.sid ? { sid: this.sid } : {}),
			...extra,
		}
		const ecode = session ? this.ecode : null
		if (postData !== undefined) params.postData = sealBody(bodyKey(requestId, ecode), JSON.stringify(postData))
		params.sign = signParams(params)
		const res = await this.fetch(this.endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(params).toString(),
			signal: AbortSignal.timeout(this.timeout),
		})
		if (!res.ok) throw new Error(`${api}: the server said ${res.status}`)
		const outer = await res.json()
		const fail = (e) => {
			const err = new Error(`${api}: ${[e.errorCode, e.errorMsg].filter(Boolean).join(' / ') || 'failed'}`)
			err.code = e.errorCode
			return err
		}
		if (outer.success === false || outer.errorCode) throw fail(outer)
		if (typeof outer.result !== 'string' || !outer.result) return outer.result
		const inner = JSON.parse(openBody(bodyKey(requestId, ecode), outer.result))
		if (inner && typeof inner === 'object' && 'success' in inner) {
			if (!inner.success || inner.errorCode) throw fail(inner)
			return inner.result
		}
		return inner
	}

	async login(email, password) {
		const t = await this.call('thing.m.user.email.token.create', '1.0', { countryCode: this.country, email }, { session: false })
		if (!t?.publicKey || !t?.exponent || !t?.token) throw new Error('the sign-in step returned something unexpected')
		const user = await this.call(
			'thing.m.user.email.password.login',
			'3.0',
			{ countryCode: this.country, email, passwd: wrapPassword(password, t.publicKey, t.exponent), token: t.token, ifencrypt: 1, options: '{"group": 1}' },
			{ session: false },
		)
		if (!user?.sid) throw new Error('signed in but got no session')
		this.sid = user.sid
		this.ecode = user.ecode ?? null
	}

	/** Every device in every home: [{ name, id, key, category, productId, online, dps }]. */
	async devices() {
		const homes = await this.call('m.life.home.space.list', '1.0', {})
		const list = Array.isArray(homes) ? homes : (homes?.list ?? [])
		const out = []
		for (const h of list) {
			if (h?.gid === undefined) continue
			const items = (await this.call('thing.m.my.group.device.list', '2.1', {}, { extra: { gid: String(h.gid) } })) ?? []
			for (const d of items) out.push({ name: d.name ?? '', id: d.devId ?? d.id ?? '', key: d.localKey ?? '', category: d.category ?? '', productId: d.productId ?? '', online: !!(d.isOnline ?? d.online), dps: d.dps ?? {} })
		}
		return out.filter((d) => d.id && d.key)
	}
}

/** Signs in on whichever data centre has the account. Returns the signed-in client. */
export async function signIn(email, password, { country = '61', fetchFn = fetch, regions = Object.keys(REGIONS) } = {}) {
	const why = []
	for (const region of regions) {
		const c = new GridConnectCloud({ region, country, fetchFn })
		try {
			await c.login(email, password)
			return c
		} catch (e) {
			why.push(`${region}: ${e.message}`)
			// a wrong password is the same everywhere: no point trying other data centres
			if (/PASSWD|PASSWORD/i.test(e.code ?? '')) break
		}
	}
	throw new Error(`Grid Connect sign-in failed (${why.join('; ')})`)
}

/**
 * The device list as the settings box takes it, in the same layout the parser reads (name line, then
 * devId / localKey / category / dps, and an IP address if one was typed in before for that device).
 */
export function devicesText(list, keepIps = {}) {
	const lines = ['# From your Grid Connect account (fetched by the module). Add "ip : 192.168.x.x" under a device that isn\'t found by itself.']
	for (const d of list) {
		lines.push('', `${String(d.name || d.id).replace(/[\r\n]+/g, ' ')}  (${d.online ? 'online' : 'offline'})`, `  devId     : ${d.id}`, `  localKey  : ${d.key}`)
		if (d.category) lines.push(`  category  : ${d.category}`)
		if (d.dps && Object.keys(d.dps).length) lines.push(`  dps       : ${JSON.stringify(d.dps)}`)
		if (keepIps[d.id]) lines.push(`  ip        : ${keepIps[d.id]}`)
	}
	return lines.join('\n')
}
