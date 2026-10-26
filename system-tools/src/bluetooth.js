// Bluetooth devices on the Mac: list the paired ones, connect, disconnect.
// Uses `blueutil` if it's installed (Homebrew: brew install blueutil), which is the most reliable way;
// otherwise macOS's own Bluetooth framework through a JavaScript-for-Automation script (nothing to
// install, but macOS may need to allow Companion to use Bluetooth).
// Device addresses reach the script as argv, never pasted into it.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

export const BLUEUTIL_PATHS = ['/opt/homebrew/bin/blueutil', '/usr/local/bin/blueutil']

/** argv: [cmd, address]. cmd = list | connect | disconnect. Prints JSON. */
export const BT_SCRIPT = String.raw`
ObjC.import('IOBluetooth')
function run(argv) {
	const cmd = argv[0]
	const address = argv[1] || ''
	if (cmd === 'list') {
		const list = $.IOBluetoothDevice.pairedDevices
		const out = []
		if (list && !list.isNil()) {
			for (let i = 0; i < list.count; i++) {
				const d = list.objectAtIndex(i)
				const addr = ObjC.unwrap(d.addressString) || ''
				out.push({ address: addr, name: ObjC.unwrap(d.name) || addr, connected: !!d.isConnected })
			}
		}
		return JSON.stringify(out)
	}
	const d = $.IOBluetoothDevice.deviceWithAddressString(address)
	if (!d || d.isNil()) return JSON.stringify({ ok: false, error: 'not paired' })
	// "openConnection" is two methods to JXA (openConnection and openConnection:), so reading it gives a
	// function rather than calling it. Call it with no target ($()), which waits until it has connected.
	const m = cmd === 'connect' ? d.openConnection : d.closeConnection
	const code = typeof m === 'function' ? (cmd === 'connect' ? m($()) : m()) : m
	const want = cmd === 'connect'
	for (let i = 0; i < 20 && !!d.isConnected !== want; i++) delay(0.25)
	const connected = !!d.isConnected
	// Without BridgeSupport JXA can hand the result code back as an object ("[id nil]"), so whether it
	// worked is judged by isConnected; the code is only for the log.
	return JSON.stringify({ ok: connected === want, ran: code !== undefined, code: typeof code === 'number' ? code : String(code), connected })
}
`

/** blueutil --paired --format json -> [{ address, name, connected }] */
export function parseBlueutil(json) {
	let rows
	try {
		rows = JSON.parse(String(json ?? '').trim() || '[]')
	} catch {
		return []
	}
	return (Array.isArray(rows) ? rows : []).map((d) => ({ address: String(d.address ?? ''), name: String(d.name || d.address || ''), connected: !!d.connected })).filter((d) => d.address)
}

/** Addresses as macOS writes them (blueutil uses dashes, the framework colons): aa-bb-… */
export const normAddress = (a) => String(a ?? '').toLowerCase().replace(/:/g, '-')

/** macOS's Bluetooth result codes, readable: 0xe00002bc style, plus the usual ones in words. */
export function btCode(code) {
	if (typeof code !== 'number') return `no result: ${code}`
	const hex = `0x${(code >>> 0).toString(16)}`
	const words = { 0xe00002bc: 'general error', 0xe00002d6: 'timed out', 0xe00002c0: 'no device', 0xe00002c2: 'not permitted', 0xe00002e2: 'not ready' }[code >>> 0]
	return words ? `${words}, ${hex}` : `code ${hex}`
}

export class Bluetooth {
	constructor({ exec = execFile, blueutil = BLUEUTIL_PATHS.find((p) => existsSync(p)) } = {}) {
		this.exec = exec
		this.blueutil = blueutil
	}

	#run(file, args) {
		return new Promise((resolve, reject) => {
			this.exec(file, args, { timeout: 20000 }, (err, stdout, stderr) => {
				if (err) return reject(new Error(String(stderr || err.message).trim()))
				resolve(String(stdout ?? ''))
			})
		})
	}

	async list() {
		const devices = this.blueutil ? parseBlueutil(await this.#run(this.blueutil, ['--paired', '--format', 'json'])) : JSON.parse((await this.#run('osascript', ['-l', 'JavaScript', '-e', BT_SCRIPT, 'list'])).trim() || '[]')
		return devices.map((d) => ({ ...d, address: normAddress(d.address) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
	}

	/** connect | disconnect. Throws with a readable reason if it didn't work. */
	async set(address, connect) {
		if (this.blueutil) {
			await this.#run(this.blueutil, [connect ? '--connect' : '--disconnect', normAddress(address)])
			return
		}
		const r = JSON.parse((await this.#run('osascript', ['-l', 'JavaScript', '-e', BT_SCRIPT, connect ? 'connect' : 'disconnect', normAddress(address)])).trim() || '{}')
		if (r.ok) return
		const why = typeof r.code === 'number' && r.code !== 0 ? `macOS said no (${btCode(r.code)})` : `it didn't ${connect ? 'connect' : 'disconnect'}`
		throw new Error(r.error ?? `${why}: is the device on, nearby and not connected to another phone or computer?`)
	}
}
