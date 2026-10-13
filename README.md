# companion-tools

> **New Mac, or setting up from scratch? Start with [SETUP-GUIDE.md](SETUP-GUIDE.md).** It's step-by-step for everything here.
>
> **Just want to install?** Download the ready-made `.tgz` packages from the [latest release](https://github.com/Wntr2134/companion-tools/releases/tag/latest), then in Companion go to **Modules → Import module package**. No Terminal needed.

Will's Bitfocus Companion add-ons and tools: the Ulanzi D200X, Panasonic PTZ knob control, and UAD Console control.

| Folder | What it is | Status |
|---|---|---|
| [`ulanzi-d200x/`](ulanzi-d200x/) | Ulanzi Stream Controller D200/D200X surface plugin, patched for Companion 5 and the D200X knobs | Working on macOS + Companion 5.1 |
| [`panasonic-ptz/`](panasonic-ptz/) | Panasonic PTZ module (upstream v2.6.1) plus knob step actions, position variables and bug fixes | Built and unit-tested; needs a test on the HE40 |
| [`uad-console/`](uad-console/) | New module: UAD Console / Apollo mutes (toggle and momentary), solo, faders, pan, sends, preamp, monitor, with 1-10 knob steps | Built and tested against a fake engine; needs a test on the Apollo |
| [`digico-sd/`](digico-sd/) | DiGiCo SD/Quantum module (upstream v0.9.1 rewrite) plus fixes and a D200X knob layer: fader/send steps, mute/solo feedback, snapshot names, selected-channel strip | Builds and unit-tested; needs a test on the SD9 |
| [`show-health/`](show-health/) | Watches a list of show devices by ping or TCP port: a green/red key each, plus ALL OK | Built and tested |
| [`tools/mac-kit/`](tools/mac-kit/) | macOS probes: D200X USB/HID check, D200X HID probe, UA Mixer Engine probe | Working |
| [`docs/`](docs/) | Notes: UAD protocol, HE40 knob commands, [DiGiCo SD9 research](docs/digico-sd9-research.md), [how it works (teaching notes)](docs/how-it-works.md), [upstream plan](docs/upstream-plan.md) | Reference |

## Using these as Companion developer modules

1. Clone this repo to your Mac, e.g. `~/companion-tools`.
2. Run `bash ~/companion-tools/update.sh`. It pulls the latest from GitHub and installs/builds every module. Run it again whenever there are changes.
3. In Companion: **Settings → Advanced → Developer**. Turn on **Enable Developer Modules** and set the path to the **repo folder** (`~/companion-tools`). Companion looks one level down and finds `ulanzi-d200x/`, `panasonic-ptz/`, `uad-console/` and `digico-sd/`.
4. Restart Companion. On each connection or surface integration, set the module version to the **dev** version (the pencil next to the version number). Otherwise Companion keeps using its store copy.

## Why not run straight from GitHub?

Companion only loads developer modules from a folder on the Mac, so something has to copy changes down. `update.sh` is that one step: `git pull` plus installs. Nothing needs committing on the Mac; it only downloads.
