// Loads each module the way Companion would (with a stand-in for Companion around it), starts it with
// its default settings, and checks its presets against its own definitions:
//  - every action, feedback and option a preset uses exists
//  - every on/off feedback in a preset has a style (without one Companion 5.1 blanks the key)
//  - knob presets have rotate actions; every preset has text or an image
// Run from the repo root after `npm install` in each module: node tools/preset-check.mjs [module…]
import { register } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const MODULES = ['apple-music-local', 'echo360-capture', 'grandma2', 'magicq', 'ndi-router', 'ndi-studio-monitor', 'panasonic-ptz', 'show-health', 'spotify-local', 'system-tools', 'uad-console', 'digico-sd']
// Modules that only build their definitions once their device answers: build them straight away.
const KICK = { 'digico-sd': ['updateActions', 'updateFeedbacks', 'updateVariableDefinitions', 'updateKnobPresets'] }
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : MODULES

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
	setPresetDefinitions(a, b) { if (Array.isArray(a)) { this.__defs.structure = a; this.__defs.presets = b ?? {} } else this.__defs.presets = a ?? {} }
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

const results = []
for (const name of wanted) {
	const dir = path.join(root, name)
	const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(dir, 'package.json'), 'utf8'))
	const entry = path.join(dir, pkg.main ?? 'src/main.js')
	const baseDir = path.join(dir, 'node_modules', '@companion-module', 'base', 'dist')
	const realBase = [path.join(baseDir, 'index.js'), path.join(baseDir, 'main.js')].find((f) => existsSync(f)) ?? path.join(baseDir, 'index.js')
	if (!existsSync(entry) || !existsSync(realBase)) {
		results.push([name, [`not checked: ${!existsSync(entry) ? `${pkg.main} missing (build it first)` : 'npm install it first'}`], true])
		continue
	}
	const counts = {}
	results.push([name, await checkModule(name, entry, realBase, counts), false, counts])
}

let failed = 0
for (const [name, problems, skipped, counts] of results) {
	if (skipped) console.log(`skip ${name}: ${problems[0]}`)
	else if (problems.length) {
		failed++
		console.log(`FAIL ${name}\n     ${problems.join('\n     ')}`)
	} else console.log(`ok   ${name}  (${counts.presets} presets, ${counts.actions} actions, ${counts.feedbacks} feedbacks)`)
}
process.exit(failed ? 1 : 0)

async function checkModule(name, entry, realBase, counts) {
	const code = STAND_IN.replaceAll('__REAL__', pathToFileURL(realBase).href)
	const fake = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
	// Each module gets its own stand-in that re-exports its own copy of @companion-module/base.
	const hook = `export async function resolve(spec, ctx, next) {
		if (spec === '@companion-module/base' && ctx.parentURL && ctx.parentURL.startsWith(${JSON.stringify(pathToFileURL(path.dirname(entry)).href.replace(/\/(src|dist)$/, ''))})) return { url: ${JSON.stringify(fake)}, shortCircuit: true }
		return next(spec, ctx)
	}`
	register(`data:text/javascript;base64,${Buffer.from(hook).toString('base64')}`)
	globalThis.__checkModule = undefined
	const problems = []
	let Cls
	try {
		const m = await import(pathToFileURL(entry).href)
		Cls = globalThis.__checkModule ?? m.default
	} catch (e) {
		return [`doesn't load: ${e.stack ?? e}`]
	}
	if (typeof Cls !== 'function') return ['no module class found (runEntrypoint or default export)']
	let inst
	try {
		inst = new Cls({})
		const fields = (await inst.getConfigFields?.()) ?? []
		const config = Object.fromEntries(fields.filter((f) => f.id && 'default' in f).map((f) => [f.id, f.default]))
		await Promise.race([inst.init(config, false), new Promise((r) => setTimeout(r, 5000))])
		for (const m of KICK[name] ?? []) await inst[m]()
		await new Promise((r) => setTimeout(r, 300))
	} catch (e) {
		return [`init failed: ${e.stack ?? e}`]
	}
	const { actions, feedbacks, presets } = inst.__defs
	Object.assign(counts, { presets: Object.keys(presets ?? {}).length, actions: Object.keys(actions).length, feedbacks: Object.keys(feedbacks).length })
	if (!presets || !Object.keys(presets).length) problems.push('no presets')
	for (const [id, p] of Object.entries(presets ?? {})) {
		if (!p || p.type === 'text') continue
		const where = `preset "${p.name ?? id}"`
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
	}
	try {
		await Promise.race([inst.destroy?.(), new Promise((r) => setTimeout(r, 2000))])
	} catch {
		// shutting down is best effort here
	}
	return problems
}
