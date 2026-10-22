// Loads each module the way Companion would (with a stand-in for Companion around it), starts it with
// its default settings, and checks its presets against its own definitions:
//  - every action, feedback and option a preset uses exists
//  - every on/off feedback in a preset has a style (without one Companion 5.1 blanks the key)
//  - knob presets have rotate actions; every preset has text or an image
// Run from the repo root after `npm install` in each module: node tools/preset-check.mjs [module…]
import { loadModule, checkButton } from './module-host.mjs'

const MODULES = ['apple-music-local', 'echo360-capture', 'grandma2', 'magicq', 'ndi-router', 'ndi-studio-monitor', 'panasonic-ptz', 'show-health', 'spotify-local', 'system-tools', 'uad-console', 'digico-sd']
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : MODULES

let failed = 0
for (const name of wanted) {
	let loaded
	try {
		loaded = await loadModule(name)
	} catch (e) {
		failed++
		console.log(`FAIL ${name}\n     doesn't load: ${e.stack ?? e}`)
		continue
	}
	if (loaded.skipped) {
		console.log(`skip ${name}: not checked: ${loaded.skipped}`)
		continue
	}
	const { actions, feedbacks, presets } = loaded.defs
	const problems = []
	if (!presets || !Object.keys(presets).length) problems.push('no presets')
	for (const [id, p] of Object.entries(presets ?? {})) problems.push(...checkButton(`preset "${p?.name ?? id}"`, p, actions, feedbacks))
	// Companion checks presets when they arrive: feedbacks must be defined first, or it warns and drops them.
	const early = new Set(loaded.defs.feedbacksAtPresets ?? [])
	const late = new Set()
	for (const p of Object.values(presets ?? {})) for (const f of p?.feedbacks ?? []) if (feedbacks[f.feedbackId] && !early.has(f.feedbackId)) late.add(f.feedbackId)
	if (late.size) problems.push(`presets are set before the feedbacks they use (${[...late].join(', ')}): set the feedback definitions first`)
	try {
		await Promise.race([loaded.inst.destroy?.(), new Promise((r) => setTimeout(r, 2000))])
	} catch {
		// shutting down is best effort here
	}
	if (problems.length) {
		failed++
		console.log(`FAIL ${name}\n     ${problems.join('\n     ')}`)
	} else console.log(`ok   ${name}  (${Object.keys(presets).length} presets, ${Object.keys(actions).length} actions, ${Object.keys(feedbacks).length} feedbacks)`)
}
process.exit(failed ? 1 : 0)
