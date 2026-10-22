# companion-tools

> **New Mac, or setting up from scratch? Start with [SETUP-GUIDE.md](SETUP-GUIDE.md).** It's step-by-step for everything here.
>
> **Just want to install or update?** Download **[companion-tools-all-modules.tgz](https://github.com/Wntr2134/companion-tools/releases/download/latest/companion-tools-all-modules.tgz)** (every module in one file), then in Companion go to **Modules → Import offline module bundle** (the blue button; called *Import Bundle* in newer Companion). No Terminal needed. Single modules are on the [latest release](https://github.com/Wntr2134/companion-tools/releases/tag/latest) (**Modules → Import module package**).

Will's Bitfocus Companion add-ons and tools: the Ulanzi D200X, Panasonic PTZ knob control, UAD Console, DiGiCo SD, MagicQ and grandMA2 control, Echo360, NDI (Virtual Input, Studio Monitor), an app launcher, Spotify and a show health page.

| Folder | What it is | Status |
|---|---|---|
| [`ulanzi-d200x/`](ulanzi-d200x/) | Ulanzi Stream Controller D200/D200X surface plugin, patched for Companion 5 and the D200X knobs. [Button map and labelled template page](ulanzi-d200x/extras/README.md) | Working on macOS + Companion 5.1 |
| [`panasonic-ptz/`](panasonic-ptz/) | Panasonic PTZ module (upstream v2.6.1) plus knob step actions, position variables and bug fixes | Working on the HE40; selected-camera knobs still to try |
| [`uad-console/`](uad-console/) | New module: UAD Console / Apollo mutes (toggle and momentary), solo, faders, pan, sends, preamp, monitor, with 1-10 knob steps | Working on Will's Apollo x4 / Twin; talkback and meters still to try |
| [`digico-sd/`](digico-sd/) | DiGiCo SD/Quantum module (upstream v0.9.1 rewrite) plus fixes and a D200X knob layer: fader/send steps, mute/solo feedback, snapshot names, selected-channel strip | Builds and unit-tested; needs a test on the SD9 |
| [`echo360-capture/`](echo360-capture/) | Echo360 lecture capture: REC/pause/HOLD STOP/extend with a live timer for Pro/Pod boxes, plus keyboard-shortcut keys for Universal Capture (no status) | Built and tested against a fake device; needs a test on the auditorium Pro |
| [`magicq/`](magicq/) | ChamSys MagicQ (OSC) module (upstream v3.2.1) plus fixes and a D200X knob layer: playback fader knobs, selected-playback strip, Go/Pause/Release/Flash, feedback | Built and tested against a fake MagicQ; needs a test with Will's Compact Connect |
| [`grandma2/`](grandma2/) | New module: grandMA2 console / onPC over Telnet, with optional Web Remote readback. Executor fader knobs (1-10 steps), Go/Go-/Pause/Flash/Temp keys, selected-executor strip, names, levels and cue names. Keeps the store module's actions | Built and tested against a fake console; needs a test on onPC 3.9.60.89 |
| [`spotify-local/`](spotify-local/) | The Spotify app on the Companion computer, no login: transport, volume knob, shuffle/repeat, playlist keys and now-playing (full on Mac; media keys on Windows) | Built and tested against a fake Spotify; needs a test on a real Mac |
| [`apple-music-local/`](apple-music-local/) | Apple's Music app on the Companion Mac, no login: transport, volume knob, shuffle/repeat, favourite, one key per playlist, now-playing with album art (Mac only) | Built and tested against a fake Music app; needs a test on a real Mac |
| [`ndi-studio-monitor/`](ndi-studio-monitor/) | NDI Studio Monitor (Windows) over its web control: source, PiP/alpha overlay, mute and record keys with feedback | Built and tested against a fake Studio Monitor; needs a test with the real one |
| [`ndi-router/`](ndi-router/) | NDI routes made by Companion: point NDI Virtual Input (or a monitor, OBS) at a route once, then switch cameras from buttons | Working on Will's Mac: routes, and switching NDI Virtual Input in the app |
| [`app-launcher/`](app-launcher/) | Lists the apps installed on the Mac or PC running Companion: one key per app to launch it (green while running), plus quit and toggle actions | Built and tested; app list fixed in 1.0.1 (needs a re-check), Windows Store apps added in 1.1.0 |
| [`show-health/`](show-health/) | Watches a list of show devices by ping or TCP port: a green/red key each, plus ALL OK | Built and tested |
| [`tools/mac-kit/`](tools/mac-kit/) | macOS probes: D200X USB/HID check, D200X HID probe, UA Mixer Engine probe | Working |
| [`docs/`](docs/) | Notes: UAD protocol, HE40 knob commands, [DiGiCo SD9 research](docs/digico-sd9-research.md), [show cues: desk + cameras + lights](docs/show-cues.md), [Echo360 research](docs/echo360-research.md), [lighting research: grandMA2, grandMA3, MagicQ](docs/lighting-research.md), [how it works (teaching notes)](docs/how-it-works.md), [upstream plan](docs/upstream-plan.md) | Reference |

## Using these as Companion developer modules

1. Clone this repo to your Mac, e.g. `~/companion-tools`.
2. Run `bash ~/companion-tools/update.sh`. It pulls the latest from GitHub and installs/builds every module. Run it again whenever there are changes.
3. In Companion: **Settings → Advanced → Developer**. Turn on **Enable Developer Modules** and set the path to the **repo folder** (`~/companion-tools`). Companion looks one level down and finds `ulanzi-d200x/`, `panasonic-ptz/`, `uad-console/`, `digico-sd/`, `grandma2/` and the rest.
4. Restart Companion. On each connection or surface integration, set the module version to the **dev** version (the pencil next to the version number). Otherwise Companion keeps using its store copy.

## Why not run straight from GitHub?

Companion only loads developer modules from a folder on the Mac, so something has to copy changes down. `update.sh` is that one step: `git pull` plus installs. Nothing needs committing on the Mac; it only downloads.
