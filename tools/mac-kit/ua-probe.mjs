// UA Mixer Engine probe: no dependencies, plain Node.
// Talks to the same local TCP API the UAD Console app uses (port 4710).
// UAD Console (or at least "UA Mixer Engine") must be running.
//
//   node ua-probe.mjs                     read-only: list devices, inputs, mute + fader state
//   node ua-probe.mjs --dump /devices/0/inputs/0      print the raw JSON for any path
//   node ua-probe.mjs --test-mute 0 0     toggle mute on device 0 input 0, then put it back
//   node ua-probe.mjs --watch             print every change while you click things in Console (e.g. TALK)
//   node ua-probe.mjs --host 192.168.1.20 ...         talk to another Mac on the network

import net from 'node:net'

const args = process.argv.slice(2)
const opt = (name) => {
	const i = args.indexOf(name)
	return i === -1 ? null : args.slice(i + 1)
}
const HOST = opt('--host')?.[0] ?? '127.0.0.1'
const PORT = 4710

const sock = net.connect(PORT, HOST)
let buf = Buffer.alloc(0)
const waiters = new Map() // path -> resolve[]

sock.on('error', (e) => {
	console.error(`Cannot reach UA Mixer Engine at ${HOST}:${PORT}: ${e.message}`)
	console.error('Open UAD Console (it starts UA Mixer Engine), then run this again.')
	process.exit(1)
})

sock.on('data', (chunk) => {
	buf = Buffer.concat([buf, chunk])
	let nul
	while ((nul = buf.indexOf(0)) !== -1) {
		const text = buf.subarray(0, nul).toString('utf8')
		buf = buf.subarray(nul + 1)
		if (!text) continue
		let msg
		try {
			msg = JSON.parse(text)
		} catch {
			continue
		}
		const p = normalise(msg.path)
		const list = waiters.get(p)
		if (list?.length) list.shift()(msg)
	}
})

function normalise(p) {
	return String(p ?? '').replace(/\/value$/, '').replace(/\/+$/, '')
}

function send(line) {
	sock.write(line + '\0')
}

function get(path, timeoutMs = 3000) {
	return new Promise((resolve) => {
		const key = normalise(path)
		const list = waiters.get(key) ?? []
		const done = (m) => {
			clearTimeout(t)
			resolve(m)
		}
		const t = setTimeout(() => {
			const l = waiters.get(key) ?? []
			const i = l.indexOf(done)
			if (i !== -1) l.splice(i, 1)
			resolve(null)
		}, timeoutMs)
		list.push(done)
		waiters.set(key, list)
		send(`get ${path}`)
	})
}

const children = (m) => Object.keys(m?.data?.children ?? {})
const prop = (m, k) => m?.data?.properties?.[k]?.value

await new Promise((r) => sock.once('connect', r))
console.log(`Connected to UA Mixer Engine at ${HOST}:${PORT}\n`)
const keepAlive = setInterval(() => send('set /Sleep false'), 3000)

async function finish(code = 0) {
	clearInterval(keepAlive)
	sock.end()
	process.exit(code)
}

if (opt('--watch')) {
	// Subscribe to every property on each device, its monitor output and talkback channel,
	// then print each change. Click TALK / DIM / etc. in Console to see what they change.
	const root = await get('/devices')
	const watched = []
	for (const d of children(root)) {
		const paths = [`/devices/${d}`]
		const outs = await get(`/devices/${d}/outputs`)
		for (const o of children(outs)) {
			const om = await get(`/devices/${d}/outputs/${o}`)
			if (om?.data?.properties?.CRMonitorLevel) paths.push(`/devices/${d}/outputs/${o}`)
		}
		const ins = await get(`/devices/${d}/inputs`)
		for (const i of children(ins)) {
			const im = await get(`/devices/${d}/inputs/${i}`)
			const n = im?.data?.properties?.Name
			if (/talk/i.test(`${n?.value ?? ''} ${n?.default ?? ''}`)) paths.push(`/devices/${d}/inputs/${i}`)
		}
		for (const p of paths) {
			const m = await get(p)
			for (const k of Object.keys(m?.data?.properties ?? {})) {
				send(`subscribe ${p}/${k}`)
				watched.push(`${p}/${k}`)
			}
		}
	}
	console.log(`Watching ${watched.length} values. Click TALK, DIM, MUTE etc. in UAD Console now. Ctrl+C to stop.\n`)
	const seen = new Map()
	sock.removeAllListeners('data') // from here on, print changes instead of answering get()s
	let wbuf = Buffer.alloc(0)
	sock.on('data', (chunk) => {
		wbuf = Buffer.concat([wbuf, chunk])
		let nul
		while ((nul = wbuf.indexOf(0)) !== -1) {
			const text = wbuf.subarray(0, nul).toString('utf8')
			wbuf = wbuf.subarray(nul + 1)
			try {
				const m = JSON.parse(text)
				const v = JSON.stringify(m.data?.properties?.value?.value ?? m.data)
				const p = String(m.path).replace(/\/value$/, '')
				if (/Meter/.test(p)) continue
				if (seen.has(p) && seen.get(p) !== v) console.log(`${new Date().toLocaleTimeString()}  ${p}  ${seen.get(p)} -> ${v}`)
				seen.set(p, v)
			} catch {}
		}
	})
	await new Promise(() => {})
}

const dump = opt('--dump')
if (dump) {
	const m = await get(dump[0])
	console.log(m ? JSON.stringify(m, null, 2) : 'No reply for that path.')
	await finish()
}

const testMute = opt('--test-mute')
if (testMute) {
	const [dev, inp] = testMute
	const path = `/devices/${dev}/inputs/${inp}/Mute`
	const before = await get(path)
	const was = before?.data?.properties?.value?.value ?? before?.data
	console.log(`${path} before: ${JSON.stringify(was)}`)
	const flipped = !(was === true || was === 'true')
	send(`set ${path}/value/ ${flipped}`)
	console.log(`Sent mute = ${flipped}. Look at Console now. Restoring in 2 seconds...`)
	await new Promise((r) => setTimeout(r, 2000))
	send(`set ${path}/value/ ${!flipped}`)
	await new Promise((r) => setTimeout(r, 300))
	const after = await get(path)
	console.log(`${path} after restore: ${JSON.stringify(after?.data?.properties?.value?.value ?? after?.data)}`)
	await finish()
}

// Default: read-only inventory
const devs = await get('/devices')
if (!devs) {
	console.log('Connected, but no reply to "get /devices". Protocol may have changed: send me this output.')
	await finish(2)
}
for (const d of children(devs)) {
	const dm = await get(`/devices/${d}`)
	const online = prop(dm, 'DeviceOnline')
	console.log(`Device ${d}: ${prop(dm, 'DeviceName') ?? '?'}  online=${online ?? '?'}`)

	for (const group of ['inputs', 'auxs', 'outputs']) {
		const g = await get(`/devices/${d}/${group}`)
		const ids = children(g)
		console.log(`  ${group}: ${ids.length}`)
		let printedKeys = false
		for (const i of ids) {
			const im = await get(`/devices/${d}/${group}/${i}`)
			const nameProp = im?.data?.properties?.Name
			const name = nameProp?.value || nameProp?.default || '?'
			const mute = prop(im, 'Mute')
			const lvl = prop(im, 'FaderLevel') ?? prop(im, 'CRMonitorLevel')
			const solo = prop(im, 'Solo')
			console.log(
				`    ${group}/${i.padEnd(3)} ${String(name).padEnd(20)} mute=${mute ?? '-'} solo=${solo ?? '-'} level=${lvl == null ? '-' : Number(lvl).toFixed(1) + ' dB'}`,
			)
			if (!printedKeys && im?.data?.properties) {
				console.log(`      (properties on ${group}: ${Object.keys(im.data.properties).join(', ')})`)
				console.log(`      (children on ${group}: ${children(im).join(', ') || 'none'})`)
				printedKeys = true
			}
		}
	}
	console.log()
}
await finish()
