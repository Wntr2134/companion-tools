# companion-tools

Will's Companion add-ons (Ulanzi D200X plugin, Panasonic PTZ, UAD Console, DiGiCo SD, ChamSys MagicQ, Echo360, Show Health, App Launcher, NDI Router, NDI Studio Monitor, Spotify, Apple Music and grandMA2 modules, Mac tools). See README.md.

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
- Apple Music module: `node --test test/music.test.mjs` in `apple-music-local/`.
- Ulanzi plugin: `yarn build` (or `tsc --noEmit`) in `ulanzi-d200x/` must pass.
- Plain Australian English in docs. No model names in commits or code.
- **Bump the module's version in `package.json` with every change.** Will updates with the all-in-one bundle (`tools/make-bundle.sh`, published as `companion-tools-all-modules.tgz`), and Companion skips any module whose version is already installed.

## Every module must work on every surface
Will uses the Ulanzi D200X, but modules must also work perfectly on Stream Decks (15-key, XL, Mini, Stream Deck+) and on plain buttons. Check this for every new module or preset change:
- **D200X:** knob turn = rotary control on row 3 (`rotaryActions`, `rotate_left`/`rotate_right`); knob push = a separate key on row 4; the wide key is row 2 col 3. Use the D200X template (`ulanzi-d200x/extras/`) as the reference layout.
- **Stream Deck+:** dials are rotary controls, and pushing a dial presses that same control, so knob presets put the push action in `down`.
- **Stream Decks without dials / plain keys:** every knob preset must also have plain − / + buttons. `surface-extras.js` (same file in each knob module, including `spotify-local/` and `apple-music-local/`; `.ts` in `digico-sd/`) adds − / + and push keys automatically: wrap presets with `withSurfaceExtras()` (API 1.x) or `withSurfaceExtrasV2()` (API 2.x) and keep its test.
- Nothing may depend on a knob or the wide key existing: every action must also be reachable from an ordinary button.
- Text must fit a 72 px Stream Deck key as well as the D200X: short labels, two lines where possible.
- Every module has a **Wide key viewers** preset category (`src/viewers.js`, `.ts` in `digico-sd/`): display-only keys for the D200X's double-width key that also read on a normal key (≤ 3 lines, `size: 'auto'`, no actions). Add one for each new module, and keep its test. Clock viewers live in Show Health and use Companion's `$(internal:time_hm)`-style variables (these show `$NA` in the presets list, but work on a real button).
- **App branding:** media-app modules put a faint brand mark behind every preset (`src/brand.js`, `withBrand()`): Spotify green, Apple Music red. Lit keys use the brand colour. Give each new app its own colour so apps stay easy to tell apart.
- **Images on keys (Companion 5.1):** an advanced feedback's `imageBuffer` is drawn *on top of* the key text and `png64` *underneath* it; both are fitted (not stretched) to the key, and `fb.image` is always 72×58, even on the D200X wide key. For a background behind text, return `png64` drawn at the real key shape (see `spotify-local/src/artwork.js`).
