// Upgrade scripts. The first is the upstream module's (pushbutton/relbutton/encoderN -> button/encoder),
// kept so buttons exported from it import cleanly. The second fills in the encoder direction the
// upstream module left blank (it sent NaN).
export const UpgradeScripts = [
	function (_context, props) {
		const result = { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
		for (const action of props.actions) {
			let changed = false
			if (action.actionId === 'pushbutton') {
				action.actionId = 'button'
				action.options.dir = 'true'
				action.options.button = action.options.pushbutton
				delete action.options.pushbutton
				changed = true
			}
			if (action.actionId === 'relbutton') {
				action.actionId = 'button'
				action.options.dir = 'false'
				action.options.button = action.options.relbutton
				delete action.options.relbutton
				changed = true
			}
			const m = /^encoder(\d)$/.exec(action.actionId)
			if (m) {
				action.actionId = 'encoder'
				action.options.enc = m[1]
				action.options.encoder_from_variable = false
				action.options.dir = action.options.encoder || 1
				action.options.steps = 1
				delete action.options.encoder
				changed = true
			}
			if (changed) result.updatedActions.push(action)
		}
		return result
	},
	function (_context, props) {
		const result = { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
		for (const action of props.actions) {
			if (action.actionId === 'encoder' && String(action.options.dir) !== '-1' && String(action.options.dir) !== '1') {
				action.options.dir = '1'
				result.updatedActions.push(action)
			}
			if (action.actionId === 'encoder_p' && String(action.options.dir) !== 'true' && String(action.options.dir) !== 'false') {
				action.options.dir = 'true'
				result.updatedActions.push(action)
			}
		}
		return result
	},
]
