// System info for the wide key viewers: CPU, memory, disk, battery, IP address and uptime.
// Built-in tools only (Node's os module, vm_stat, pmset), nothing to install.
import os from 'node:os'
import { statfs } from 'node:fs/promises'

/** CPU busy % between two os.cpus() samples. */
export function cpuPercent(before, after) {
	let idle = 0
	let total = 0
	for (let i = 0; i < Math.min(before.length, after.length); i++) {
		const a = before[i].times
		const b = after[i].times
		const t = (k) => b[k] - a[k]
		const sum = t('user') + t('nice') + t('sys') + t('idle') + t('irq')
		idle += t('idle')
		total += sum
	}
	return total > 0 ? Math.round((1 - idle / total) * 100) : null
}

/**
 * Memory in use on a Mac the way Activity Monitor counts it (app + wired + compressed), from `vm_stat`.
 * os.freemem() on a Mac leaves out the cache and looks nearly full all the time.
 */
export function parseVmStat(out, totalBytes) {
	const text = String(out ?? '')
	const page = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 4096)
	const pages = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(text)?.[1] ?? NaN)
	const anonymous = pages('Anonymous pages')
	const purgeable = pages('Pages purgeable')
	const wired = pages('Pages wired down')
	const compressed = pages('Pages occupied by compressor')
	let used
	if (Number.isFinite(anonymous)) used = (anonymous - (Number.isFinite(purgeable) ? purgeable : 0) + wired + compressed) * page
	else used = (pages('Pages active') + wired + compressed) * page
	if (!Number.isFinite(used) || !totalBytes) return null
	return Math.max(0, Math.min(100, Math.round((used / totalBytes) * 100)))
}

/** `pmset -g batt` -> { percent, charging, onPower } or null (no battery, e.g. Mac mini / Studio). */
export function parsePmset(out) {
	const text = String(out ?? '')
	const m = /(\d+)%;\s*([a-zA-Z ]+);/.exec(text)
	if (!m) return null
	return {
		percent: Number(m[1]),
		charging: /^charging|charged|finishing/i.test(m[2].trim()),
		onPower: /AC Power/.test(text),
	}
}

/** The first non-internal IPv4 address, preferring Ethernet/Wi-Fi (en0, en1…) on a Mac. */
export function mainIp(interfaces = os.networkInterfaces()) {
	const all = []
	for (const [name, addrs] of Object.entries(interfaces)) {
		for (const a of addrs ?? []) {
			if ((a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.')) all.push({ name, address: a.address })
		}
	}
	all.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
	return all[0]?.address ?? ''
}
const rank = (name) => (/^en\d/.test(name) ? 0 : /^(Ethernet|Wi-?Fi)/i.test(name) ? 0 : /^(utun|bridge|vmnet|vbox|docker|awdl|llw)/i.test(name) ? 2 : 1)

export function fmtUptime(seconds) {
	const s = Math.max(0, Math.floor(seconds))
	const d = Math.floor(s / 86400)
	const h = Math.floor((s % 86400) / 3600)
	const m = Math.floor((s % 3600) / 60)
	if (d) return `${d}d ${h}h`
	if (h) return `${h}h ${m}m`
	return `${m}m`
}

export function fmtBytes(bytes) {
	if (!Number.isFinite(bytes)) return ''
	const gb = bytes / 1e9
	return gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`
}

/** Free space on the startup disk (Mac: the Data volume, where your files are). */
export async function diskFree(platform = process.platform) {
	const target = platform === 'win32' ? `${process.env.SystemDrive || 'C:'}\\` : platform === 'darwin' ? '/System/Volumes/Data' : '/'
	try {
		const s = await statfs(target)
		return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
	} catch {
		const s = await statfs('/')
		return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
	}
}
