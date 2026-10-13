# companion-tools

Will's Bitfocus Companion add-ons and tools: the Ulanzi D200X, Panasonic PTZ knob control, and (planned) UAD Console.

| Folder | What it is | Status |
|---|---|---|
| [`ulanzi-d200x/`](ulanzi-d200x/) | Ulanzi Stream Controller D200/D200X surface plugin, patched for Companion 5 and the D200X knobs | Working on macOS + Companion 5.1 |
| [`panasonic-ptz/`](panasonic-ptz/) | Panasonic PTZ module (copy of upstream v2.6.1), to be extended with knob-friendly step actions | Baseline only, changes not started |
| [`tools/mac-kit/`](tools/mac-kit/) | macOS probes: D200X USB/HID check, D200X HID probe, UA Mixer Engine probe | Working |
| [`docs/`](docs/) | Notes: UAD Console protocol, HE40 knob commands | Reference |

## Using these as Companion developer modules

1. Clone this repo to your Mac, e.g. `~/companion-tools`.
2. Build each module (see its folder).
3. In Companion: **Settings → Advanced → Developer**. Turn on **Enable Developer Modules** and set the path to the **repo folder** (`~/companion-tools`). Companion looks one level down and finds `ulanzi-d200x/` and `panasonic-ptz/`.
4. Restart Companion. On each connection or surface integration, set the module version to the **dev** version (the pencil next to the version number). Otherwise Companion keeps using its store copy.
