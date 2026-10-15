# D200X extras

## What's different from upstream

Upstream: [bitfocus/companion-surface-ulanzi-stream-controller](https://github.com/bitfocus/companion-surface-ulanzi-stream-controller) @ `d467064` (v1.0.2, 2026-10-03).
The source in this folder already includes these changes. `patches/d200x-plugin-fixes-v3.patch` is the same change as a patch against upstream.

1. **Control IDs Companion 5 accepts.** `0_0` → `0-0`, `page_left` → `page-left`, and so on. Companion 5.x rejects underscores and kept restarting the surface ("Surface layout validation failed … Invalid key in record"). This is upstream issue #15 / PR #20. PR #20 on its own breaks the page buttons; that is also fixed here.
2. **Knob push gets its own button.** Turning a knob goes to its rotary control on row 3. Pushing it presses a separate button on row 4, directly below. The old left/right "virtual" buttons are gone.
3. **Keep-alive.** The plugin talks to the device every 5 s even in full-width mode. Without it, the D200X falls asleep after about a minute and doesn't wake reliably. Upstream PR #19 takes the same approach.

## Companion grid layout

![D200X map: which Companion button is which control](D200X-map.svg)

| Row | Col 0 | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|---|
| 0 | KEY 1 | KEY 2 | KEY 3 | KEY 4 | KEY 5 |
| 1 | KEY 6 | KEY 7 | KEY 8 | KEY 9 | KEY 10 |
| 2 | KEY 11 | KEY 12 | KEY 13 | WIDE KEY | (covered by the wide key) |
| 3 | page ◀ (hardware) | knob 1 TURN | knob 2 TURN | knob 3 TURN | page ▶ (hardware) |
| 4 | | knob 1 PUSH | knob 2 PUSH | knob 3 PUSH | |

On the TURN buttons, switch on **Rotary actions** and use **Rotate left / Rotate right**.

## Files

- `D200X-layout.companionconfig`: import into Companion (Import/Export → Import, pick an empty page). Every key and knob gets a colour-coded label matching the map above. Also on the [latest release](https://github.com/Wntr2134/companion-tools/releases/tag/latest).
- `D200X-map.svg`: the map picture above.
- `make-layout.mjs`: regenerates the .companionconfig (`node make-layout.mjs`).

## Mac notes (what fixed it on macOS 26)

- System Settings → Privacy & Security → **Allow accessories to connect** → Always. Then plug the D200X **directly** into the Mac with its own cable. If the Mac doesn't approve it as an accessory, it never appears on USB.
- Quit Ulanzi Studio fully, including its menu-bar icon and Login Item.
- Build with Node 22: `yarn install && yarn build`.
