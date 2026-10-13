# companion-tools

> **New Mac, or setting up from scratch? Start with [SETUP-GUIDE.md](SETUP-GUIDE.md).** It's step-by-step for everything here.

Will's Bitfocus Companion add-ons and tools: the Ulanzi D200X, Panasonic PTZ knob control, and UAD Console control.

| Folder | What it is | Status |
|---|---|---|
| [`ulanzi-d200x/`](ulanzi-d200x/) | Ulanzi Stream Controller D200/D200X surface plugin, patched for Companion 5 and the D200X knobs | Working on macOS + Companion 5.1 |
| [`panasonic-ptz/`](panasonic-ptz/) | Panasonic PTZ module (upstream v2.6.1) plus knob step actions, position variables and bug fixes | Built and unit-tested; needs a test on the HE40 |
| [`uad-console/`](uad-console/) | New module: UAD Console / Apollo mutes (toggle and momentary), solo, faders, pan, sends, preamp, monitor, with 1-10 knob steps | Built and tested against a fake engine; needs a test on the Apollo |
| [`tools/mac-kit/`](tools/mac-kit/) | macOS probes: D200X USB/HID check, D200X HID probe, UA Mixer Engine probe | Working |
| [`docs/`](docs/) | Notes: UAD protocol, HE40 knob commands, [how it works (teaching notes)](docs/how-it-works.md), [upstream plan](docs/upstream-plan.md) | Reference |

## Using these as Companion developer modules

1. Clone this repo to your Mac, e.g. `~/companion-tools`.
2. Run `bash ~/companion-tools/update.sh`. It pulls the latest from GitHub and installs/builds every module. Run it again whenever there are changes.
3. In Companion: **Settings → Advanced → Developer**. Turn on **Enable Developer Modules** and set the path to the **repo folder** (`~/companion-tools`). Companion looks one level down and finds `ulanzi-d200x/`, `panasonic-ptz/` and `uad-console/`.
4. Restart Companion. On each connection or surface integration, set the module version to the **dev** version (the pencil next to the version number). Otherwise Companion keeps using its store copy.

## Why not run straight from GitHub?

Companion only loads developer modules from a folder on the Mac, so something has to copy changes down. `update.sh` is that one step: `git pull` plus installs. Nothing needs committing on the Mac; it only downloads.
