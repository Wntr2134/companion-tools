# grandMA2 module: notes and open questions

Background research: [docs/lighting-research.md](../docs/lighting-research.md), section 3.1 and 4.

## Layout
| File | What |
|---|---|
| `src/telnet.js` | Telnet client: IAC filter, quoted login, line splitting, command queue (spacing, merge by key, no retry), heartbeat, one reconnect timer |
| `src/webremote.js` | Web Remote client on Node 22's built-in `WebSocket`, plus pure functions for poll ranges and reply parsing |
| `src/console.js` | The model: page, executor list, selection, tracked fader targets vs readback, command forms |
| `src/actions.js`, `feedbacks.js`, `variables.js`, `presets.js` | Companion definitions |
| `src/status.js` | Companion status from the two links |
| `src/choices.js`, `src/upgrades.js` | From the store module (key list, old upgrade script), plus a fix-up for blank encoder directions |
| `test/ma2.test.mjs` | Fake Telnet console and fake Web Remote (a small WebSocket server on `node:http`) |

## Decisions
- **Absolute fader values only.** The module tracks each fader's target locally and sends `Fader p.e At n`. It never relies on relative `At + 5`, which is unverified. With the Web Remote, the read-back level wins once our own change is more than 1 s old, so a fader moved on the desk is picked up.
- **Never retry** anything except fader and grand master sets. Commands without a merge key are dropped (and logged) if Telnet isn't logged in, and anything still queued when the link drops is thrown away.
- **Telnet decides the status.** OK = logged in (or prompt seen with login off). The Web Remote only adds a note, except when Telnet is down and the Web Remote is up (warning; commands then go through the Web Remote's `command` request).
- Own Telnet client on `node:net` instead of module-base's `TelnetHelper`: full control of IAC replies, reconnect and the queue, and easy to test.
- Web Remote executor numbers are counted from the requested start index, walking `combinedItems`, as xtouchgma2 does. The `i.t` text is not used.

## Uncertain: check on onPC 3.9.60.89
| Item | What the module does | If it's wrong |
|---|---|---|
| `Fader 1.5 At 50` with a page | Default fader template | Change *Fader command* to `Executor {page}.{exec} At {level}` |
| `SpecialMaster "grandmaster"."grand" At 50` | Default grand master template | Change *Grand master command* (e.g. `SpecialMaster 2.1 At {level}`) |
| `Flash On / Flash Off Executor p.e`, `Temp On / Temp Off Executor p.e` | Telnet fallback for momentary Flash/Temp | Use the Web Remote button option instead, or a custom command |
| `Top Executor p.e`, `Goto Cue n Executor p.e`, `FaderPage n` | As written | Custom command |
| Heartbeat = blank line | The console should answer with a prompt. If it doesn't answer at all, the module will reconnect every 25 s while idle | Set *Heartbeat command* (Advanced) to something harmless that answers |
| Does MA2 Telnet send IAC negotiation? | Answered with WONT/DONT either way | – |
| Login text | Waits for "Please login", OK on "Logged in as User", refused on "no login" | Look at the `response` variable and the debug log |
| Web Remote button ids 0/1/2 | Shown as buttons 1-3; order unknown | Try the other numbers |
| Web Remote `released` for Temp | Press = `pressed:true`, release = `pressed:false, released:true` | – |
| Fader value in replies | `(v - min) / (max - min)`; cue items: 3 = prev/current/next | Debug log |
| Poll every 250 ms, keep-alive every 10 s | Community clients poll every 100 ms and keep alive every 20 s | *Read back every* setting (keep-alive is fixed in `src/webremote.js`) |
| Web Remote on onPC needs anything beyond Remotes = Login Enabled? | – | – |

## Not built (yet)
- MIDI Show Control listener as a third state source.
- Cue names for executors that aren't in the polled list (Lua over Telnet).
- Grand master readback.
