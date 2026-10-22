# companion-tools

Will's Companion add-ons (Ulanzi D200X plugin, Panasonic PTZ, UAD Console, DiGiCo SD, ChamSys MagicQ, Echo360, Show Health, App Launcher, NDI Router, NDI Studio Monitor, Spotify and grandMA2 modules, Mac tools). See README.md.

## How work gets in
- Work on a branch and open a pull request into `main`. Then **merge it yourself**: Will has said merging doesn't need his permission. Tell him afterwards what was merged.
- Panasonic module: run `node --test test/steps.test.mjs` in `panasonic-ptz/` before merging.
- UAD module: run `node --test test/ua.test.mjs` in `uad-console/` before merging.
- DiGiCo module: `npx tsc6 -p tsconfig.build.json && node --test test/knobs.test.mjs` in `digico-sd/`.
- Echo360 module: `node --test test/echo.test.mjs` in `echo360-capture/`.
- MagicQ module: `node --test test/knobs.test.mjs` in `magicq/` (npm install rewrites yarn.lock: restore it before committing).
- Show Health module: `node --test test/health.test.mjs` in `show-health/`.
- App Launcher module: `node --test test/apps.test.mjs` in `app-launcher/`.
- NDI Router module: `node --test test/ndi.test.mjs test/virtual-input.test.mjs` in `ndi-router/` (builds a fake NDI library with `cc`).
- NDI Studio Monitor module: `node --test test/monitor.test.mjs` in `ndi-studio-monitor/`.
- grandMA2 module: `node --test test/ma2.test.mjs` in `grandma2/`.
- Spotify module: `node --test test/spotify.test.mjs` in `spotify-local/`.
- Ulanzi plugin: `yarn build` (or `tsc --noEmit`) in `ulanzi-d200x/` must pass.
- Plain Australian English in docs. No model names in commits or code.

## Every module must work on every surface
Will uses the Ulanzi D200X, but modules must also work perfectly on Stream Decks (15-key, XL, Mini, Stream Deck+) and on plain buttons. Check this for every new module or preset change:
- **D200X:** knob turn = rotary control on row 3 (`rotaryActions`, `rotate_left`/`rotate_right`); knob push = a separate key on row 4; the wide key is row 2 col 3. Use the D200X template (`ulanzi-d200x/extras/`) as the reference layout.
- **Stream Deck+:** dials are rotary controls, and pushing a dial presses that same control, so knob presets put the push action in `down`.
- **Stream Decks without dials / plain keys:** every knob preset must also have plain − / + buttons. `surface-extras.js` (same file in each knob module, including `spotify-local/`; `.ts` in `digico-sd/`) adds − / + and push keys automatically: wrap presets with `withSurfaceExtras()` (API 1.x) or `withSurfaceExtrasV2()` (API 2.x) and keep its test.
- Nothing may depend on a knob or the wide key existing: every action must also be reachable from an ordinary button.
- Text must fit a 72 px Stream Deck key as well as the D200X: short labels, two lines where possible.
- Every module has a **Wide key viewers** preset category (`src/viewers.js`, `.ts` in `digico-sd/`): display-only keys for the D200X's double-width key that also read on a normal key (≤ 3 lines, `size: 'auto'`, no actions). Add one for each new module, and keep its test. Clock viewers live in Show Health and use Companion's `$(internal:time_hm)`-style variables.
