import { CreateConvertToBooleanFeedbackUpgradeScript } from '@companion-module/base'
import { PAN_TILT_STEP_UNITS, LENS_STEP_PERCENT } from './steps.js'

const nearestLevel = (table, value) => {
	let best = 0
	for (let i = 1; i < table.length; i++) {
		if (Math.abs(table[i] - value) < Math.abs(table[best] - value)) best = i
	}
	return best + 1
}

// Knob actions used a free number "step" before the 1-10 "size" dropdown: convert it.
function knobStepToSize(_context, props) {
	const updatedActions = []
	for (const action of props.actions) {
		if (action.options?.step === undefined || action.options.size !== undefined) continue
		const step = Number(action.options.step)
		let table
		if (action.actionId === 'knobPanTiltStep') table = PAN_TILT_STEP_UNITS
		else if (action.actionId === 'knobZoomStep' || action.actionId === 'knobFocusStep') table = LENS_STEP_PERCENT
		else continue
		action.options.size = Number.isFinite(step) ? nearestLevel(table, step) : 2
		delete action.options.step
		updatedActions.push(action)
	}
	return { updatedConfig: null, updatedActions, updatedFeedbacks: [] }
}

export const UpgradeScripts = [
	CreateConvertToBooleanFeedbackUpgradeScript({
		powerState: true,
		tallyState: true,
		insState: true,
		autoFocus: true,
		autoIris: true,
		modePset: true,
	}),
	knobStepToSize,
]
