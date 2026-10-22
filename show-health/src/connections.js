// "Everything OK?": Show Health's device pings plus the state of Companion's own connections
// (DiGiCo, cameras, MagicQ, Spotify…), read from Companion's internal variables:
//   $(internal:instance_errors) / instance_warns / instance_total / instance_disabled: counts
//   $(internal:connection_<label>_status): good / warning / error / disabled, per connection
// No Companion dependency, so it can be tested on its own.

/** Connection labels to name, one per line (or comma-separated). Lines starting with # are ignored. */
export function parseWatchList(text) {
	return [
		...new Set(
			String(text ?? '')
				.split(/[\r\n,]+/)
				.map((s) => s.trim())
				.filter((s) => s && !s.startsWith('#')),
		),
	]
}

/** The text to ask Companion to fill in, as [key, template] pairs. */
export function connectionTemplates(watch) {
	return [
		['errors', '$(internal:instance_errors)'],
		['warnings', '$(internal:instance_warns)'],
		['total', '$(internal:instance_total)'],
		['disabled', '$(internal:instance_disabled)'],
		...watch.map((label) => [`c:${label}`, `$(internal:connection_${label}_status)`]),
	]
}

const num = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : null)

/**
 * values: { errors, warnings, total, disabled, 'c:<label>': status } as Companion filled them in.
 * Returns counts and the named connections with problems. A label Companion doesn't know comes back
 * as $NA: it's listed under `unknown` so the settings can be fixed.
 */
export function connectionState(values, watch, { warningsCount = false } = {}) {
	const errors = num(values.errors)
	const warnings = num(values.warnings)
	const named = { error: [], warning: [], unknown: [] }
	for (const label of watch) {
		const s = String(values[`c:${label}`] ?? '').trim().toLowerCase()
		if (s === 'error') named.error.push(label)
		else if (s === 'warning') named.warning.push(label)
		else if (!s || s.includes('$na')) named.unknown.push(label)
	}
	const problems = (errors ?? named.error.length) + (warningsCount ? (warnings ?? named.warning.length) : 0)
	return {
		known: errors !== null,
		errors: errors ?? named.error.length,
		warnings: warnings ?? named.warning.length,
		total: num(values.total),
		disabled: num(values.disabled),
		named,
		problems,
	}
}

/**
 * One line for a key: "ALL OK", or what's wrong, devices first.
 * devices: Show Health's monitor summary ({ total, down, downNames, allOk }).
 */
export function everything(devices, conns, { warningsCount = false } = {}) {
	const parts = []
	if (devices.down) parts.push(...devices.downNames.map((n) => `${n} down`))
	const namedErrors = conns.named.error
	parts.push(...namedErrors.map((n) => `${n} error`))
	const unnamedErrors = conns.errors - namedErrors.length
	if (unnamedErrors > 0) parts.push(`${unnamedErrors} connection${unnamedErrors === 1 ? '' : 's'} with errors`)
	if (warningsCount) {
		parts.push(...conns.named.warning.map((n) => `${n} warning`))
		const unnamedWarnings = conns.warnings - conns.named.warning.length
		if (unnamedWarnings > 0) parts.push(`${unnamedWarnings} warning${unnamedWarnings === 1 ? '' : 's'}`)
	}
	const problems = devices.down + conns.problems
	const checking = devices.total > 0 && !devices.allOk && !devices.down
	return {
		ok: problems === 0 && !checking,
		problems,
		summary: problems ? `${problems} PROBLEM${problems === 1 ? '' : 'S'}` : checking ? 'CHECKING' : 'ALL OK',
		list: parts.join(' · '),
	}
}
