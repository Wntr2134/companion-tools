import { sizeToDbStep } from './controls.js'

/** Knob actions whose step is now chosen in dB rather than 1-10. */
const DB_STEP_ACTIONS = new Set(['levelStep', 'sendStep', 'monitorStep', 'selectedFaderStep', 'selectedSendStep'])

/** 0.3.0: fader, send and monitor knob steps become 0.5-5 dB instead of a 1-10 size. */
export function dbStepUpgrade(_context, props) {
	const updatedActions = []
	for (const action of props.actions) {
		if (!DB_STEP_ACTIONS.has(action.actionId)) continue
		if (action.options.stepDb !== undefined || action.options.size === undefined) continue
		const { size, ...rest } = action.options
		action.options = { ...rest, stepDb: sizeToDbStep(size) }
		updatedActions.push(action)
	}
	return { updatedActions, updatedConfig: null, updatedFeedbacks: [] }
}

export const UpgradeScripts = [dbStepUpgrade]
