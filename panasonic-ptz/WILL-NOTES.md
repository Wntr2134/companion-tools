# Panasonic PTZ: planned changes

This folder started as a copy of upstream [bitfocus/companion-module-panasonic-ptz](https://github.com/bitfocus/companion-module-panasonic-ptz) @ `18caabf` (v2.6.1), The first commit is the untouched baseline, so `git diff` against it shows exactly what changed.

## Found in upstream (fixed here)

- **"Live speed" crashes.** The Zoom/Focus/Pan/Tilt "adjust on speed change" option calls `.then()` on `removeAllListeners()`, which returns the emitter, not a promise. Ticking that option throws.
- **Duplicate moves.** `got` retries failed GET requests up to 2 times by default, so a relative move (`#RPC`) can run twice. There is also no request timeout.
- **No command spacing.** Panasonic asks for about 130 ms between commands, so a fast knob spin drops commands.
- **No position tracking.** The module never reads zoom, focus or pan/tilt position, so it can't do exact steps.
- **Fragile TCP event parsing.** The code itself has a TODO for this: it assumes one complete message per TCP packet.

## Knob actions added (for AW-HE40)

- **Pan/Tilt step:** relative `#RPC` with an equal step both ways, merging fast spins into one move.
- **Zoom step / Focus step:** read the position (`#GZ` / `#GF`, falling back to `camdata.html`, which on the HE40 reports `axz…` / `axf…`), then set it exactly with `#AXZ` / `#AXF`. Fallback: `directctrl?zoom=±1`.
- **Position variables:** zoom %, focus %, pan, tilt.
- **Command queue:** about 130 ms between commands, a timeout, no automatic retries, and logging of camera `er1`/`er2`/`er3` replies.

## Tests

`node --test test/steps.test.mjs` runs the step logic and command queue against a fake camera: merged fast spins, 130 ms spacing, clamping, camdata fallback, and no retry on a hung request. These tests haven't been run against a real HE40 yet.
