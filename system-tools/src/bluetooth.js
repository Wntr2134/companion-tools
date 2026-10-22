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
	const result = cmd === 'connect' ? d.openConnection : d.closeConnection
	return JSON.stringify({ ok: result === 0, code: result })
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
		if (!r.ok) throw new Error(r.error ?? `macOS said no (code ${r.code}): is the device on and nearby?`)
	}
}
