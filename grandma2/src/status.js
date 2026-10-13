import { InstanceStatus } from '@companion-module/base'

/** Companion status from the two links. Telnet decides; the Web Remote only adds a note. */
export function overallStatus(telnet, wr, webRemoteWanted) {
	const note = webRemoteWanted && wr.state !== 'ok' && wr.message ? ` · ${wr.message}` : ''
	switch (telnet.state) {
		case 'ok':
			if (telnet.guest) return [InstanceStatus.UnknownWarning, `Logged in as guest${note}`]
			return [InstanceStatus.Ok, `${telnet.message}${webRemoteWanted && wr.ok ? ' · Web Remote ok' : note}`]
		case 'failed':
			return [/login/i.test(telnet.message) ? InstanceStatus.AuthenticationFailure : InstanceStatus.BadConfig, telnet.message]
		case 'connecting':
			return [InstanceStatus.Connecting, telnet.message]
		default:
			if (wr.ok) return [InstanceStatus.UnknownWarning, 'Telnet down; Web Remote connected (commands go through it)']
			return [InstanceStatus.Disconnected, telnet.message || 'Disconnected']
	}
}
