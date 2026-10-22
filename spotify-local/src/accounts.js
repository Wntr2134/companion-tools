// Switching between saved Spotify logins on this computer, without storing any passwords.
// The Spotify app keeps who is logged in in its own settings file ("prefs"): the account name and a
// login token. Saving an account copies that file; switching quits Spotify, puts the saved copy back
// and reopens Spotify. Spotify may occasionally expire a saved login: then it asks you to log in once
// and you save that account again.
// No Companion dependency, so it can be tested on its own.
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const ACCOUNT_SLOTS = 4

/** Where Spotify keeps its prefs file. Windows: the normal installer, then the Microsoft Store app. */
export function prefsCandidates(platform = process.platform, env = process.env, home = os.homedir()) {
	if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Spotify', 'prefs')]
	if (platform === 'win32') {
		const appData = env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
		const local = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
		return [path.join(appData, 'Spotify', 'prefs'), path.join(local, 'Packages', 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0', 'LocalState', 'Spotify', 'prefs')]
	}
	return [path.join(home, '.config', 'spotify', 'prefs')]
}

/** Where saved accounts live: <dir>/<slot>/prefs plus accounts.json with their names. */
export const ACCOUNTS_DIR = path.join(os.homedir(), process.platform === 'win32' ? 'AppData/Roaming/Companion Tools' : 'Library/Application Support/Companion Tools', 'spotify-accounts')

/** The account logged in according to a prefs file's text: { user, display } or null if logged out. */
export function accountFromPrefs(text) {
	const get = (key) => new RegExp(`^${key.replace(/\./g, '\\.')}="([^"]*)"`, 'm').exec(String(text ?? ''))?.[1] ?? ''
	const user = get('autologin.canonical_username') || get('autologin.username')
	if (!user) return null
	return { user, display: get('autologin.username') || user }
}

export class SpotifyAccounts {
	constructor({ platform = process.platform, exec = execFile, dir = ACCOUNTS_DIR, prefs = prefsCandidates(platform), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
		this.platform = platform
		this.exec = exec
		this.dir = dir
		this.prefsList = prefs
		this.sleep = sleep
	}

	#run(file, args) {
		return new Promise((resolve) => this.exec(file, args, { timeout: 15000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout ?? ''))))
	}

	/** The prefs file Spotify is using (the first that exists). */
	async prefsPath() {
		for (const p of this.prefsList) {
			try {
				await stat(p)
				return p
			} catch {
				// try the next place
			}
		}
		return null
	}

	async meta() {
		try {
			return JSON.parse(await readFile(path.join(this.dir, 'accounts.json'), 'utf8'))
		} catch {
			return {}
		}
	}

	/** Who is logged in now, and the saved accounts: { current, slots: { 1: { name, user } … } }. */
	async status() {
		const p = await this.prefsPath()
		const current = p ? accountFromPrefs(await readFile(p, 'utf8').catch(() => '')) : null
		return { current, slots: await this.meta() }
	}

	async isRunning() {
		if (this.platform === 'darwin') return ((await this.#run('pgrep', ['-x', 'Spotify'])) ?? '').trim() !== ''
		if (this.platform === 'win32') return /spotify\.exe/i.test((await this.#run('tasklist', ['/FI', 'IMAGENAME eq Spotify.exe', '/NH'])) ?? '')
		return false
	}

	/** Quits Spotify and waits until it has (it writes its prefs as it closes). Force-quits after 10 s. */
	async quit() {
		if (!(await this.isRunning())) return
		if (this.platform === 'darwin') await this.#run('osascript', ['-e', 'tell application "Spotify" to quit'])
		else if (this.platform === 'win32') await this.#run('taskkill', ['/IM', 'Spotify.exe'])
		for (let i = 0; i < 40; i++) {
			await this.sleep(250)
			if (!(await this.isRunning())) return
		}
		if (this.platform === 'darwin') await this.#run('pkill', ['-x', 'Spotify'])
		else if (this.platform === 'win32') await this.#run('taskkill', ['/IM', 'Spotify.exe', '/F'])
		await this.sleep(500)
	}

	async open() {
		if (this.platform === 'darwin') await this.#run('open', ['-a', 'Spotify'])
		else if (this.platform === 'win32') await this.#run('explorer.exe', ['spotify:'])
	}

	/**
	 * Saves who is logged in now as account `slot`. Spotify is closed and reopened so its prefs file is
	 * up to date. Returns the account saved.
	 */
	async save(slot, name = '') {
		const wasRunning = await this.isRunning()
		await this.quit()
		const p = await this.prefsPath()
		if (!p) throw new Error("Spotify's settings file wasn't found: open Spotify and log in first")
		const text = await readFile(p, 'utf8')
		const account = accountFromPrefs(text)
		if (!account) throw new Error('Nobody is logged in to Spotify: log in, then save')
		await mkdir(path.join(this.dir, String(slot)), { recursive: true })
		await writeFile(path.join(this.dir, String(slot), 'prefs'), text)
		const meta = await this.meta()
		meta[slot] = { name: String(name || account.display).trim(), user: account.user, savedAt: new Date().toISOString() }
		await writeFile(path.join(this.dir, 'accounts.json'), JSON.stringify(meta, null, 1))
		if (wasRunning) await this.open()
		return meta[slot]
	}

	/** Switches Spotify to saved account `slot`: quit, swap the login, reopen. */
	async switchTo(slot) {
		const saved = path.join(this.dir, String(slot), 'prefs')
		const meta = await this.meta()
		if (!meta[slot]) throw new Error(`Account ${slot} isn't saved yet: log in as that person and press SAVE AS ACCOUNT ${slot}`)
		await stat(saved)
		await this.quit()
		const p = (await this.prefsPath()) ?? this.prefsList[0]
		await mkdir(path.dirname(p), { recursive: true })
		// Keep whatever was there, in case it was a login that hasn't been saved.
		await copyFile(p, path.join(this.dir, 'prefs.before-switch')).catch(() => null)
		const tmp = `${p}.companion-tmp`
		await copyFile(saved, tmp)
		await rename(tmp, p)
		await this.open()
		return meta[slot]
	}
}
