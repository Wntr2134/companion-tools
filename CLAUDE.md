# companion-tools

Will's Companion add-ons (Ulanzi D200X plugin, Panasonic PTZ, UAD Console, DiGiCo SD, ChamSys MagicQ, Echo360, Show Health, App Launcher, NDI Router and grandMA2 modules, Mac tools). See README.md.

## How work gets in
- Work on a branch and open a pull request into `main`. Then **merge it yourself**: Will has said merging doesn't need his permission. Tell him afterwards what was merged.
- Panasonic module: run `node --test test/steps.test.mjs` in `panasonic-ptz/` before merging.
- UAD module: run `node --test test/ua.test.mjs` in `uad-console/` before merging.
- DiGiCo module: `npx tsc6 -p tsconfig.build.json && node --test test/knobs.test.mjs` in `digico-sd/`.
- Echo360 module: `node --test test/echo.test.mjs` in `echo360-capture/`.
- MagicQ module: `node --test test/knobs.test.mjs` in `magicq/` (npm install rewrites yarn.lock: restore it before committing).
- Show Health module: `node --test test/health.test.mjs` in `show-health/`.
- App Launcher module: `node --test test/apps.test.mjs` in `app-launcher/`.
- NDI Router module: `node --test test/ndi.test.mjs` in `ndi-router/` (builds a fake NDI library with `cc`).
- grandMA2 module: `node --test test/ma2.test.mjs` in `grandma2/`.
- Ulanzi plugin: `yarn build` (or `tsc --noEmit`) in `ulanzi-d200x/` must pass.
- Plain Australian English in docs. No model names in commits or code.
