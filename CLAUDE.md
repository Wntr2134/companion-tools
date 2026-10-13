# companion-tools

Will's Companion add-ons (Ulanzi D200X plugin, Panasonic PTZ module, Mac tools). See README.md.

## How work gets in
- Work on a branch and open a pull request into `main`. Then **merge it yourself**: Will has said merging doesn't need his permission. Tell him afterwards what was merged.
- Panasonic module: run `node --test test/steps.test.mjs` in `panasonic-ptz/` before merging.
- Ulanzi plugin: `yarn build` (or `tsc --noEmit`) in `ulanzi-d200x/` must pass.
- Plain Australian English in docs. No model names in commits or code.
