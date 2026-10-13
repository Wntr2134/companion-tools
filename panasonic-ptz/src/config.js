import { MODELS } from './models.js'
import { DEFAULT_COMMAND_INTERVAL } from './transport.js'

export function applyConfigDefaults(config) {
	return {
		...config,
		host: config.host ?? '',
		httpPort: config.httpPort ?? 80,
		tcpPort: config.tcpPort ?? 31004,
		autoTCP: config.autoTCP ?? true,
		model: config.model ?? 'Auto',
		debug: config.debug ?? false,
		commandInterval: config.commandInterval ?? DEFAULT_COMMAND_INTERVAL,
		positionPoll: config.positionPoll ?? 3,
		cameraNumber: config.cameraNumber ?? 1,
		selectVariable: config.selectVariable ?? '$(custom:ptz_cam)',
	}
}

export const ConfigFields = [
	{
		type: 'static-text',
		id: 'info',
		width: 12,
		label: 'Information',
		value:
			"This module controls Panasonic PTZ cameras, you can find supported models in the dropdown below.<br/>If your camera isn't in the list below, feel free to try it anyway the option 'Other Cameras'.",
	},
	{
		type: 'textinput',
		id: 'host',
		label: 'Camera IP',
		width: 4,
		// regex: Regex.IP
	},
	{
		type: 'number',
		id: 'httpPort',
		label: 'HTTP Port (Default: 80)',
		width: 3,
		default: 80,
		min: 1,
		max: 65535,
	},
	{
		type: 'static-text',
		id: 'dummy1',
		width: 12,
		label: ' ',
		value: ' ',
	},
	{
		type: 'static-text',
		id: 'modelInfo',
		width: 12,
		label: 'Camera Model',
		value: 'Please Select the camera model or feel free to leave it on auto.',
	},
	{
		type: 'dropdown',
		id: 'model',
		label: 'Select Your Camera Model',
		width: 6,
		default: 'Auto',
		choices: MODELS,
		minChoicesForSearch: 5,
	},
	{
		type: 'static-text',
		id: 'dummy2',
		width: 12,
		label: ' ',
		value: ' ',
	},
	{
		type: 'static-text',
		id: 'info',
		width: 12,
		label: 'Tally On (Basic)',
		value:
			'Support for Tally On is no longer possible. Instead you can set this up as a trigger, and get additional control',
	},
	{
		type: 'static-text',
		id: 'dummy3',
		width: 12,
		label: ' ',
		value: ' ',
	},
	{
		type: 'static-text',
		id: 'Info',
		width: 12,
		label: 'Other Settings',
		value:
			'These setting can be left on the default values and should give you a consistent setup, but they are there for you to use if need be.',
	},

	{
		type: 'checkbox',
		id: 'autoTCP',
		width: 1,
		label: 'Enable',
		default: true,
	},
	{
		type: 'static-text',
		id: 'autoTCPInfo',
		width: 4,
		label: 'Auto TCP',
		value: 'This will ignore the port selected and find a port Automaticly',
	},
	{
		type: 'number',
		id: 'tcpPort',
		label: 'TCP Port',
		width: 3,
		default: 31004,
		min: 1,
		max: 65535,
	},
	{
		type: 'static-text',
		id: 'manualTCPInfo',
		width: 4,
		label: 'Manual TCP Port',
		value: 'TCP Port (Default: 31004) only used when "Auto TCP" is OFF/Disabled',
	},
	{
		type: 'number',
		id: 'commandInterval',
		label: 'Minimum gap between commands (ms)',
		width: 4,
		default: 130,
		min: 0,
		max: 1000,
		tooltip: 'Panasonic asks for at least 130 ms. Raise it if fast knob turns still drop steps.',
	},
	{
		type: 'number',
		id: 'positionPoll',
		label: 'Read zoom/focus/pan/tilt position every (seconds, 0 = off)',
		width: 4,
		default: 3,
		min: 0,
		max: 60,
	},
	{
		type: 'number',
		id: 'cameraNumber',
		label: 'Camera number (for shared "selected camera" knobs)',
		width: 4,
		default: 1,
		min: 1,
		max: 99,
	},
	{
		type: 'textinput',
		id: 'selectVariable',
		label: 'Variable holding the selected camera number',
		width: 4,
		default: '$(custom:ptz_cam)',
		tooltip: 'Create a custom variable called ptz_cam (Variables page), and buttons that set it to 1, 2, 3…',
	},
	{
		type: 'static-text',
		id: 'dummy4',
		width: 12,
		label: ' ',
		value: ' ',
	},
	{
		type: 'checkbox',
		id: 'debug',
		width: 1,
		label: 'Enable',
		default: false,
	},
	{
		type: 'static-text',
		id: 'debugInfo',
		width: 11,
		label: 'Enable Debug To Log Window',
		value:
			'Requires Companion to be restarted. But this will allow you the see what is being sent from the module and what is being received from the camera.',
	},
]
