# Getting the fixes into the official modules

Goal: the store versions of these modules work for us, so we don't depend on the dev versions forever.

Claude sessions can't create forks of bitfocus repos (they're outside the session's access),
so Will clicks **Fork** on GitHub and a session does the rest.

| Module | Fork | Branches pushed (open PRs in this order) |
|---|---|---|
| DiGiCo | [Wntr2134/companion-module-digico-osc](https://github.com/Wntr2134/companion-module-digico-osc) | `fix/ports-cache-heartbeat`, then `feature/knob-layer` |
| Ulanzi D200X | [Wntr2134/companion-surface-ulanzi-stream-controller](https://github.com/Wntr2134/companion-surface-ulanzi-stream-controller) | `fix/companion5-control-ids`, `fix/keep-alive-full-width`, then `feature/knob-push-button` |
| Panasonic PTZ | [Wntr2134/companion-module-panasonic-ptz](https://github.com/Wntr2134/companion-module-panasonic-ptz) | `fix/live-speed-retries-tcp`, then `feature/knob-steps` |
| MagicQ | [Wntr2134/companion-module-chamsys-magicq-osc](https://github.com/Wntr2134/companion-module-chamsys-magicq-osc) | `fix/regex-import`, then `feature/status-and-knobs` |

Feature branches are built on their fix branch, so open the feature PR after the fix is merged
(or it shows both commits). Opening the PRs is done by Will: they go to Bitfocus under his name.

## DiGiCo module, 2 PRs
1. **Fixes** (`fix/ports-cache-heartbeat`): port defaults match HELP.md, sent values cached with an
   echo guard, relative changes clamped, newer cross-fades cancel older ones, real connection status
   with a heartbeat, query timeout 400 ms with one retry.
2. **Knob layer** (`feature/knob-layer`, builds on 1): step actions, selected strip, feedbacks,
   variables, presets and tests. Our `digico-sd/` also bumps the version to 2.0.0; the PRs leave
   versioning to the maintainer.

## MagicQ, 2 PRs
1. **Fix** (`fix/regex-import`): one line, `Regex` wasn't imported in main.js so the settings screen threw.
2. **Status and knobs** (`feature/status-and-knobs`): real connection status, sturdier parsing, the knob layer and tests.

## Ulanzi D200X plugin, 3 small PRs (easier to review than one big one)
1. **Page buttons after the control-ID rename.** Builds on upstream PR #20: `instance.ts` still compared `page_left`/`page_right`. A one-line fix, but without it PR #20 breaks paging.
2. **Keep-alive in full-width mode.** Same idea as upstream PR #19; offer to merge into it.
3. **Separate knob push button.** Turning a knob = rotary control, pushing it = its own key on row 4. A behaviour change, so it's offered as a suggestion, not a fix.

## Panasonic PTZ module
1. **Bug fix:** `.then()` on `removeAllListeners()` throws when "adjust on speed change" is ticked (12 places).
2. **Bug fix:** `got` retries GETs by default, so relative moves can happen twice. Also no timeout. Use `retry: { limit: 0 }` and a 2 s timeout.
3. **Bug fix:** TCP event parsing assumes one message per packet (the code's own TODO).
4. **Feature:** a command queue with 130 ms spacing.
5. **Feature:** knob step actions, position variables, Knobs presets, hold-to-save preset buttons.

Bugs first: they're easy to accept. Features after, as separate PRs.
