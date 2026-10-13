# Getting the fixes into the official modules

Goal: the store versions of these modules work for us, so we don't depend on the dev versions forever.

Claude sessions can't create forks of bitfocus repos (they're outside the session's access),
so Will clicks **Fork** on GitHub and a session does the rest.

| Module | Fork | Status |
|---|---|---|
| DiGiCo | [Wntr2134/companion-module-digico-osc](https://github.com/Wntr2134/companion-module-digico-osc) | Branches pushed: `fix/ports-cache-heartbeat`, then `feature/knob-layer` on top. PRs not opened yet. |
| Ulanzi D200X | not forked yet: <https://github.com/bitfocus/companion-surface-ulanzi-stream-controller/fork> | waiting on fork |
| Panasonic PTZ | not forked yet: <https://github.com/bitfocus/companion-module-panasonic-ptz/fork> | waiting on fork |
| MagicQ (optional) | not forked yet: <https://github.com/bitfocus/companion-module-chamsys-magicq-osc/fork> | waiting on fork |

## DiGiCo module, 2 PRs
1. **Fixes** (`fix/ports-cache-heartbeat`): port defaults match HELP.md, sent values cached with an
   echo guard, relative changes clamped, newer cross-fades cancel older ones, real connection status
   with a heartbeat, query timeout 400 ms with one retry.
2. **Knob layer** (`feature/knob-layer`, builds on 1): step actions, selected strip, feedbacks,
   variables, presets and tests. Our `digico-sd/` also bumps the version to 2.0.0; the PRs leave
   versioning to the maintainer.

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
