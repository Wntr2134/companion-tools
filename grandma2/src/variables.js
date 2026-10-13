// Variables: one set per watched executor (on the current page), the selected executor (sel_*),
// the executor after it (nxt_*), grand master, page and connection state.
import { formatLevel } from './console.js'

const EXEC_FIELDS = [
	['name', 'name'],
	['level', 'fader level (%)'],
	['running', 'running (on/off)'],
	['cue', 'current cue'],
	['next', 'next cue'],
	['prev', 'previous cue'],
]

export function getVariableDefinitions(self) {
	const defs = [
		{ variableId: 'telnet', name: 'Telnet link (ok / connecting / disconnected / failed)' },
		{ variableId: 'webremote', name: 'Web Remote link (off / connecting / ok / refused / error)' },
		{ variableId: 'response', name: 'Last Telnet response line' },
		{ variableId: 'page', name: 'Current executor page' },
		{ variableId: 'gm_level', name: 'Grand master level (%), as last sent' },
		{ variableId: 'sel_exec', name: 'Selected executor number' },
		{ variableId: 'sel_label', name: 'Selected executor as page.exec' },
	]
	for (const [id, label] of EXEC_FIELDS) defs.push({ variableId: `sel_${id}`, name: `Selected executor ${label}` })
	defs.push({ variableId: 'nxt_exec', name: 'Executor after the selected one: number' })
	for (const [id, label] of EXEC_FIELDS) defs.push({ variableId: `nxt_${id}`, name: `Executor after the selected one: ${label}` })
	for (const n of self.ma.execs) {
		for (const [id, label] of EXEC_FIELDS) defs.push({ variableId: `exec_${n}_${id}`, name: `Executor ${n} ${label}` })
	}
	return defs
}

function execValues(prefix, i) {
	return {
		[`${prefix}_name`]: i.name,
		[`${prefix}_level`]: formatLevel(i.level),
		[`${prefix}_running`]: i.running ? 'on' : 'off',
		[`${prefix}_cue`]: i.cue,
		[`${prefix}_next`]: i.next,
		[`${prefix}_prev`]: i.prev,
	}
}

export function getVariableValues(self) {
	const ma = self.ma
	const sel = ma.info(ma.selected)
	const nxtExec = ma.neighbour(ma.selected, 1)
	const values = {
		telnet: ma.telnet.state,
		webremote: ma.wr.state,
		response: ma.telnet.lastResponse,
		page: String(ma.page),
		gm_level: formatLevel(ma.gm),
		sel_exec: String(ma.selected),
		sel_label: `${ma.page}.${ma.selected}`,
		...execValues('sel', sel),
		nxt_exec: String(nxtExec),
		...execValues('nxt', ma.info(nxtExec)),
	}
	for (const n of ma.execs) Object.assign(values, execValues(`exec_${n}`, ma.info(n)))
	return values
}
