// Loads a module the way Companion would, with a stand-in for Companion around it, so tools can read
// its actions, feedbacks and presets without a running Companion. Used by preset-check.mjs and the
// page generators. Each module gets its own stand-in that re-exports its own @companion-module/base.
import { register } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

const STAND_IN = `
import { EventEmitter } from 'node:events'
export * from '__REAL__'
const noop = () => undefined
export class InstanceBase {
	constructor(internal) {
		this.id = 'check'
		this.label = 'check'
		this.__defs = { actions: {}, feedbacks: {}, variables: [], presets: null, structure: null }
		this.__status = null
		this.__logs = []
	}
	log(level, msg) { this.__logs.push([level, String(msg)]) }
	updateStatus(status, msg) { this.__status = [status, msg] }
	setActionDefinitions(d) { this.__defs.actions = d ?? {} }
	setFeedbackDefinitions(d) { this.__defs.feedbacks = d ?? {} }
	setVariableDefinitions(d) { this.__defs.variables = d ?? [] }
	setVariableValues() {}
	getVariableValue() { return undefined }
	setPresetDefinitions(a, b) { this.__defs.feedbacksAtPresets = Object.keys(this.__defs.feedbacks); if (Array.isArray(a)) { this.__defs.structure = a; this.__defs.presets = b ?? {} } else this.__defs.presets = a ?? {} }
	checkFeedbacks() {}
	checkFeedbacksById() {}
	checkAllFeedbacks() {}
	subscribeActions() {}
	subscribeFeedbacks() {}
	unsubscribeActions() {}
	unsubscribeFeedbacks() {}
	recordAction() {}
	setRecordActions() {}
	saveConfig() {}
	setCustomVariableValue() {}
	oscSend() {}
	async parseVariablesInString(t) { return String(t) }
	createSharedUdpSocket() { return Object.assign(new EventEmitter(), { bind: noop, send: noop, close: noop, addMembership: noop }) }
}
export function runEntrypoint(cls) { globalThis.__checkModule = cls }
`

// Modules that only build their definitions once their device answers: build them straight away.
const KICK = { 'digico-sd': ['updateActions', 'updateFeedbacks', 'updateVariableDefinitions', 'updateKnobPresets'] }

/**
 * Starts module `name` (a folder in the repo) with its default settings plus `config`.
 * Returns { inst, defs: { actions, feedbacks, presets, structure } }, or { skipped } / throws.
 */
export async function loadModule(name, { config: extra = {}, label } = {}) {
	const dir = path.join(root, name)
	const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
	const entry = path.join(dir, pkg.main ?? 'src/main.js')
	const baseDir = path.join(dir, 'node_modules', '@companion-module', 'base', 'dist')
	const realBase = [path.join(baseDir, 'index.js'), path.join(baseDir, 'main.js')].find((f) => existsSync(f))
	if (!existsSync(entry)) return { skipped: `${pkg.main} missing (build it first)` }
	if (!realBase) return { skipped: 'npm install it first' }
	const code = STAND_IN.replaceAll('__REAL__', pathToFileURL(realBase).href)
	const fake = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
	const hook = `export async function resolve(spec, ctx, next) {
		if (spec === '@companion-module/base' && ctx.parentURL && ctx.parentURL.startsWith(${JSON.stringify(pathToFileURL(dir).href + '/')})) return { url: ${JSON.stringify(fake)}, shortCircuit: true }
		return next(spec, ctx)
	}`
	register(`data:text/javascript;base64,${Buffer.from(hook).toString('base64')}`)
	globalThis.__checkModule = undefined
	const m = await import(pathToFileURL(entry).href)
	const Cls = globalThis.__checkModule ?? m.default
	if (typeof Cls !== 'function') throw new Error('no module class found (runEntrypoint or default export)')
	const inst = new Cls({})
	if (label) inst.label = label
	const fields = (await inst.getConfigFields?.()) ?? []
	const config = { ...Object.fromEntries(fields.filter((f) => f.id && 'default' in f).map((f) => [f.id, f.default])), ...extra }
	await Promise.race([inst.init(config, false), new Promise((r) => setTimeout(r, 5000))])
	for (const fn of KICK[name] ?? []) await inst[fn]()
	await new Promise((r) => setTimeout(r, 300))
	return { inst, defs: inst.__defs }
}

/** Problems with one preset-shaped button (steps of { down, up, rotate_left, rotate_right }). */
export function checkButton(where, p, actions, feedbacks) {
	const problems = []
	if (!p || p.type === 'text') return problems
	const style = p.style ?? {}
	if (!style.text && !style.png64 && !(p.feedbacks ?? []).length) problems.push(`${where}: no text or image`)
	for (const step of p.steps ?? []) {
		for (const [kind, list] of Object.entries(step)) {
			if (!Array.isArray(list)) continue
			for (const a of list) {
				if (!a?.actionId) continue
				const def = actions[a.actionId]
				if (!def) {
					problems.push(`${where}: ${kind} uses action "${a.actionId}", which doesn't exist`)
					continue
				}
				const known = new Set((def.options ?? []).map((o) => o.id))
				for (const k of Object.keys(a.options ?? {})) if (!known.has(k)) problems.push(`${where}: action "${a.actionId}" has option "${k}", which the action doesn't have`)
			}
		}
	}
	if (p.options?.rotaryActions && !(p.steps ?? []).some((s) => s.rotate_left?.length || s.rotate_right?.length)) problems.push(`${where}: a knob preset with no rotate actions`)
	for (const f of p.feedbacks ?? []) {
		const def = feedbacks[f.feedbackId]
		if (!def) {
			problems.push(`${where}: feedback "${f.feedbackId}" doesn't exist`)
			continue
		}
		if (def.type === 'boolean' && !(f.style && Object.keys(f.style).length)) problems.push(`${where}: on/off feedback "${f.feedbackId}" has no style (the key goes black in Companion 5.1)`)
		const known = new Set((def.options ?? []).map((o) => o.id))
		for (const k of Object.keys(f.options ?? {})) if (!known.has(k)) problems.push(`${where}: feedback "${f.feedbackId}" has option "${k}", which the feedback doesn't have`)
	}
	return problems
}
