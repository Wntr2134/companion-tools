// D200X probe: checks, without Companion, whether macOS + node-hid can see the
// Ulanzi deck, open its protocol interface, and read button/encoder events.
//
// QUIT COMPANION AND ULANZI STUDIO FIRST (only one app can hold the device).
//
// Run from inside the plugin folder so it uses the plugin's own node-hid:
//   cd ~/companion-dev/companion-surface-ulanzi-stream-controller
//   node ~/Downloads/d200x-probe.mjs
//
// Then press every button and turn/press every knob. Ctrl+C to stop.

import { createRequire } from 'node:module'

const require = createRequire(process.cwd() + '/')
let HID
try {
	HID = require('node-hid')
} catch (e) {
	console.error('Could not load node-hid from', process.cwd())
	console.error('Run this from the plugin folder (where node_modules is).')
	console.error(e.message)
	process.exit(1)
}

const VID = 0x2207
const PID = 0x0019
const hex = (n, w = 4) => (n == null ? '?' : '0x' + Number(n).toString(16).padStart(w, '0'))

console.log(`node ${process.version} on ${process.platform}/${process.arch}`)

const all = HID.devices()
console.log(`node-hid sees ${all.length} HID interfaces in total.\n`)

const candidates = all.filter(
	(d) =>
		d.vendorId === VID ||
		/ulanzi/i.test(`${d.manufacturer} ${d.product}`) ||
		(d.vendorId === 0x18d1 && d.productId === 0xd002),
)

if (candidates.length === 0) {
	console.log('RESULT: no Ulanzi HID interface visible to node-hid.')
	console.log('  -> The Mac is not presenting the HID device (2207:0019). This is an')
	console.log('     enumeration problem, not a Companion problem. Check the USB tree')
	console.log('     output from d200x-mac-check.sh, then try a plain USB 2 hub.')
	process.exit(2)
}

console.log('Ulanzi-looking HID interfaces:')
for (const d of candidates) {
	console.log(
		`  ${hex(d.vendorId)}:${hex(d.productId)}  interface=${d.interface}  ` +
			`usagePage=${hex(d.usagePage)} usage=${hex(d.usage)}  ` +
			`"${d.manufacturer ?? ''}" "${d.product ?? ''}" serial=${d.serialNumber ?? '-'}`,
	)
	console.log(`      path=${d.path}`)
}

// Same rule the plugin uses in checkSupportsHidDevice()
const wouldClaim = candidates.filter(
	(d) =>
		d.vendorId === VID &&
		d.productId === PID &&
		(d.interface === 0 || (d.interface === -1 && !(d.usagePage === 0x01 && d.usage === 0x06))),
)

if (wouldClaim.length === 0) {
	console.log('\nRESULT: Ulanzi device is visible, but the plugin would NOT claim any of')
	console.log('  these interfaces (wrong product ID or interface number). Send this whole')
	console.log('  output back. The plugin filter needs adjusting for this unit/macOS.')
	process.exit(3)
}

const target = wouldClaim[0]
console.log(`\nPlugin would claim: ${target.path}`)

let dev
try {
	dev = await HID.HIDAsync.open(target.path)
} catch (e) {
	console.log(`\nRESULT: found it but FAILED TO OPEN: ${e.message}`)
	console.log('  Most likely causes, in order:')
	console.log('   1. Ulanzi Studio (or its menu-bar helper) is still running and holds it.')
	console.log('   2. Companion is still running and holds it.')
	console.log('   3. macOS privacy block: add Terminal (for this test) / Companion to')
	console.log('      System Settings > Privacy & Security > Input Monitoring (admin).')
	process.exit(4)
}

console.log('\nOPENED OK. Press every button, press and turn every knob. Ctrl+C to stop.\n')

// Write test: dim to 10%, then back to 100%. If the screen visibly dims, the
// Mac can send to the deck protocol. Same packet format the plugin uses.
async function brightness(pct) {
	const payload = Buffer.from(String(pct), 'utf8')
	const out = Buffer.alloc(1024 + 1) // byte 0 = HID report ID 0
	out[1] = 0x7c
	out[2] = 0x7c
	out.writeUInt16BE(0x000a, 3)
	out.writeUInt32LE(payload.length, 5)
	payload.copy(out, 9)
	try {
		const n = await dev.write(out)
		console.log(`write brightness ${pct}% -> OK (${n} bytes)`)
	} catch (e) {
		console.log(`write brightness ${pct}% -> FAILED: ${e.message}`)
	}
}
await brightness(10)
await new Promise((r) => setTimeout(r, 1500))
await brightness(100)
console.log('Did the screen dim for 1.5 s and come back? Now press buttons / turn knobs.\n')
let reports = 0
setInterval(() => {
	if (reports === 0) console.log('...no input reports received yet')
}, 5000)

const NAMES = {
	0: 'btn 0_0', 1: 'btn 1_0', 2: 'btn 2_0', 3: 'btn 3_0', 4: 'btn 4_0',
	5: 'btn 0_1', 6: 'btn 1_1', 7: 'btn 2_1', 8: 'btn 3_1', 9: 'btn 4_1',
	10: 'btn 0_2', 11: 'btn 1_2', 12: 'btn 2_2', 13: 'wide 3_2',
	15: 'page_left', 16: 'page_right', 17: 'enc_1', 18: 'enc_2', 19: 'enc_3',
}
const ACTIONS = { 0x00: 'release', 0x01: 'press', 0x02: 'left', 0x03: 'right' }
const seen = new Set()

dev.on('data', (buf) => {
	reports++
	if (buf.length < 8 || buf[0] !== 0x7c || buf[1] !== 0x7c) {
		console.log(`raw ${buf.subarray(0, 16).toString('hex')}`)
		return
	}
	const cmd = buf.readUInt16BE(2)
	const len = buf.readUInt32LE(4)
	const data = buf.subarray(8, 8 + len)
	if (cmd === 0x010b) return // ack
	if (cmd === 0x0303) {
		const nul = data.indexOf(0)
		console.log(`device info: ${data.subarray(0, nul >= 0 ? nul : data.length).toString('ascii')}`)
		return
	}
	if (cmd === 0x0101 && data.length >= 4) {
		const idx = data[1]
		const kind = data[2] === 0x02 ? 'encoder' : 'button'
		const action = ACTIONS[data[3]] ?? `0x${data[3].toString(16)}`
		const name = NAMES[idx] ?? 'UNMAPPED (plugin ignores this!)'
		seen.add(idx)
		console.log(`idx=${String(idx).padStart(2)} ${kind.padEnd(7)} ${action.padEnd(7)} -> ${name}   raw=${data.subarray(0, 4).toString('hex')}`)
		return
	}
	console.log(`cmd ${hex(cmd)} len=${len} ${data.subarray(0, 16).toString('hex')}`)
})
dev.on('error', (e) => console.log('device error:', e.message))

process.on('SIGINT', async () => {
	const ids = [...seen].sort((a, b) => a - b)
	console.log(`\nIndices seen: ${ids.join(', ') || 'none'}`)
	const missing = Object.keys(NAMES).map(Number).filter((i) => !seen.has(i))
	if (missing.length) console.log(`Never seen: ${missing.map((i) => `${i} (${NAMES[i]})`).join(', ')}`)
	try { await dev.close() } catch {}
	process.exit(0)
})
