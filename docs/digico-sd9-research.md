# DiGiCo SD9 and Bitfocus Companion: research report

Prepared 13 Oct 2026. This was read-only research: nothing was pushed. Local clones are in `/home/user/research/`.

**How sure each claim is.** Each claim carries one of these tags:
- **[Official]**: comes from a DiGiCo document.
- **[Code]**: I read it in source code.
- **[Community]**: a forum post, GitHub issue or third-party project.
- **[Unverified]**: my own inference.

Nothing here has been tested on a real SD9.

---

## (a) Existing Companion modules for DiGiCo

There is only one: **`bitfocus/companion-module-digico-osc`** (Companion id `digico-osc`).
- I probed `digico-sd`, `-quantum`, `-ipad`, `-s21`, `-pad`, `-generic` and other names, and none of them exist under bitfocus.
- The bundled-modules repo also lists only `digico-osc`.
- The "Digico SD" and "Digico Quantum" names people mention in issue #12 were product entries of this same module in Companion 2.

The repo holds two very different generations:

| | **v1.0.4, legacy** (the version the Companion store/bundle has shipped) | **v0.9.x, rewrite** (current `main`) |
|---|---|---|
| Author / date | Jeffrey Davidsz and Sydney Dykstra. Last real change Mar 2021; v1.0.4 tidy-up Feb 2022 | Andrew Broughton (MeestorX). Merged as PR #22/#23 on 4 Oct 2026; v0.9.1 on **5 Oct 2026** (last commit) |
| Runtime | Companion 2-style `instance_skel` JS, run through the legacy wrapper (node18, API 1.10) | TypeScript, `@companion-module/base` 2.1.3 (API 2), node22 runtime |
| Protocol | OSC over UDP. A dropdown chooses the command set: **"IPAD"** (bare `/Input_Channels/...`, values in dB), **"OSC"** (`/sd/...` "Other OSC" set, normalised 0..1) or **"S-Range"** (`/digico/snapshots/...`). Default ports: send 8001, listen 8002 | OSC over UDP using **only the DiGiCo Pad (iPad) protocol**: bare paths, dB values, `/?` queries. No `/sd/` set and no S-series. HELP gives console Send 7000 / Rcv 7001, command file `iPadv2sd8-9-11-12` |
| Actions | Input mute, solo and phantom; input fader, chosen from a fixed list of dB steps; Aux, Group and Control Group mute; snapshot fire by number, next and previous; macro press (1–256) | About 600 actions generated from a 650-row CSV (`digico_osc.csv` + `digico_entities.csv`) that was **reverse-engineered from the console's `.dosc` command file**. Covers inputs, Aux, Group and Matrix outputs, Control Groups, Multis, Graphic EQ, EQ, dynamics, filters, delay, inserts, sends and pans. Snapshots: recall, next/prev, fire selected, undo, update, insert, rename, renumber, move, delete. Presets: recall, update, new, rename, lock, delete. Macros: `Recall_Macro/*` and `Buttons/press`. Numeric actions have **Relative** and **Cross-fade (ms)** options; booleans have Toggle. Supports action recording and Learn |
| Feedbacks | One: macro state (colour, plus optional console macro name) | Generic **value-type** feedback for every readable path (it returns the value; there are no boolean on/off colour feedbacks). Also snapshot name/info, snapshot notes, macro records, and `Snapshots/Current_Snapshot` (an index) |
| Variables | None | Only section counts (inputs, auxes, groups and so on), snapshot/macro/preset counts, and the session filename. **No channel names, levels, or current-snapshot name as variables** |
| Presets | None | **None** |
| State from console | Yes, but macro state only (it polls `/Macros/Buttons/?` every 10 s) | Yes. A value cache fills from unsolicited console messages and `/?` queries. It discovers counts and names at start-up, and re-reads lists when the console sends `<path>/!` change notices |
| Encoders | No | No `rotate_left`/`rotate_right` handling and no step-size option. A "Relative" action with a value of ±n can be put on an encoder's rotate steps (with the limits listed below) |
| iPad sharing | No | **Yes**: an iPad relay forwards raw packets between the console and the DiGiCo iPad app, so both can share the console's single Pad slot |
| Issues / PRs | 9 open, 6 closed issues; 1 stale open PR (#3, 2020) | Same tracker. The rewrite answers #12, #15, #16, #19, #20 and #21 with "test my new module" |

**Open issues that matter for the SD9:**
- **#20** (SD9 on firmware v2025): the console only answered without the `/SD` prefix, macro numbering looked off by one, and mutes didn't work. This fits the user's console device being a *DiGiCo Pad* while QLab and the old module were sending `/sd/` paths.
- **#16**: request for current-snapshot feedback.
- **#19**: requests for fades and snapshot-name feedback.
- **#15**: request for Stream Deck+ dials with feedback.
- **#12**: macro feedback not working.

### Bugs and weak spots I found in the code

**In the v0.9.1 rewrite:**
1. **Default ports don't match the HELP file [Code].**
   - HELP says Companion listens on 7000 and sends to 7001.
   - `DEFAULT_CONFIG` has `receivePort: 7001, transmitPort: 7000`, the other way round.
   - Anyone who follows HELP on the console and keeps the module defaults gets no traffic in either direction.
2. **Relative changes and Toggle read a cache that the module never updates itself [Code]. High risk.**
   - `send_osc()` doesn't write to the `dataStore`, so the next relative step or toggle reads whatever value the console last echoed.
   - **This is risky because** HELP recommends **"Suppress OSC Retransmit: ON"**. d&b's DiGiCo guide describes that option as stopping the console from replying to every incoming message [Community].
   - If the console doesn't echo our own changes back to us:
     - Toggle works once and then keeps sending the same value.
     - Fast encoder turns collapse into a single step, because every detent reads the same stale value.
   - This is the same class of bug we fixed in our own modules.
3. **Relative changes aren't clamped [Code].** The code computes `target = current + entered` without applying `row.min` or `row.max`, and the steps are linear in dB.
   - +1 dB steps from −150 dB ("−∞") take about 140 detents to get anywhere near audible.
4. **Overlapping cross-fades on the same path aren't cancelled [Code].** Two ramps fight each other at 20 messages per second.
5. **Connection status is cosmetic [Code].**
   - The module reports `Ok` as soon as the UDP socket binds, whether or not the console has answered.
   - There is no heartbeat and no Connecting or Disconnected state.
   - After a console reboot the cache stays stale: `getOscValueOrQuery` returns cached values forever, with no expiry.
6. **The query timeout is 150 ms, with no retry [Code].** That's tight over Wi-Fi or a busy network. Discovery and Learn quietly come back empty.
7. **The upgrade from v1.0.4 is lossy [Code]:**
   - **Connection settings aren't migrated.** It returns `updatedConfig: null`, and the old keys `host`, `port` and `receiveport` don't match the new `ip`, `transmitPort` and `receivePort`. Upgraded users fall back to 192.168.1.100 with ports 7000/7001.
   - **The migrated macro feedback points at an id that doesn't exist.** It becomes `'/Macros/Buttons/state/name'` with option `macro`, but the real feedback id is `/Macros/Buttons/state/*` with option `index_1`.
   - **Macro buttons are migrated to the wrong thing.** The old "macro press" used OSC macro *button* numbers (sending n−1 to `/Macros/Buttons/press`). It is migrated to `/Macros/Recall_Macro/*`, which uses the console's macro *list* index.
   - **Faders saved on the old `/sd/` "OSC" command set** (normalised, where 0.75 = 0 dB) are copied straight into a dB action, so 0 dB becomes +0.75 dB. The script never checks the old `series` setting.
   - **S-series actions are dropped** without any notice.
8. **The version number goes backwards: v0.9.1 is lower than v1.0.4 [Code/Unverified].** Companion's store may not offer it as an update. Check what the store actually lists; I couldn't reach bitfocus.io.
9. **Macro button numbering is confusing [Code].**
   - The `/Macros/Buttons/press` action is a raw 0–255 integer, while the console's Macro Editor numbers OSC buttons **1–256** [Official, SD App guide].
   - The old module subtracted 1 and the new one doesn't, so users have to.
   - This probably explains the off-by-one in #20.
10. **Pan scaling may be wrong [Code + Community].** The CSV gives `Panner/pan` as −1..1, but an iPad handshake captured on an S21 shows pan as `0.5` at centre (a 0..1 range). This needs checking on an SD.
11. **Bus counts may be inflated [Community].** On the S21, `/Console/Aux_Outputs` and `/Console/Group_Outputs` both report the whole shared bus pool (17 and 17), and the real split comes from `/Console/Aux_Outputs/types`. The module uses the counts as given, so it may list too many auxes and groups. Not known for the SD9.
12. **Minor [Code]:**
    - Two 5 ms polling loops run per instance (busy-wait queues).
    - `package.json` says `engines node ^26` while the manifest says node22.
    - Many CSV rows are marked "MAYBE?" (15 in the main table).

**In the v1.0.4 legacy module (only matters if Will's Companion 5.1 is still running it) [Code]:**
- `setInterval` polling is never cleared.
- `destroy()` never closes the socket, so the port stays in use after disable and re-enable.
- Changing the config doesn't rebuild the socket.
- Status is set to OK unconditionally.
- Phantom and solo are sent as floats in the IPAD set.
- The feedback reads `states[n].status` on entries that start as `0`.

---

## (b) What the SD9 can do over OSC

### Two OSC "surfaces" on SD and Quantum desks
1. **The "DiGiCo Pad" device (the iPad protocol).**
   - Setup is in **Master screen → Setup → External Control**:
     - Enable External Control = YES.
     - Add Device → DiGiCo Pad.
     - Enter the IP of the computer running Companion, plus Send and Receive ports. Ports are from the console's point of view; DiGiCo's example is Send 9000 / Receive 8000.
     - Tick Enabled.
     - **Load the command set.** One set covers SD8/9/11 and another SD5/7/10; the current file is `iPadv2sd8-9-11-12`. Without it the console stays silent.
   - DiGiCo says **only one iPad can be connected at a time**, and each device needs its own ports. It needs SD software **V685 or later**, and the External Control activator software must be installed. [Official, SD App User Guide Issue D, 2014; TN324]
   - The protocol uses **bare paths in real units** (fader −150..+10 dB), `/?` to query a value, and the console pushes changes. [Community/Code: module CSV, FADER_X firmware, S21 capture]
   - DiGiCo has never published the wire format; all of it is reverse-engineered.
2. **The "Other OSC" (generic) device.**
   - This is the `/sd/`-prefixed set with **normalised 0..1 levels**: 577 commands in DiGiCo's 2014 list, which is committed in the legacy repo as `api/DiGiCo_OTHER_OSC_List_17_11_14.pdf` [Official].
   - It doesn't use up the single Pad slot.
   - The documents describe no feedback. One community report says `/?` queries also work on `/sd/` [Community, unverified].
   - The dB-to-0..1 curve isn't documented. The old module's table (0.75 = 0 dB, 0.5 = −10 dB, 0.25 = −30 dB) is a guess.

### Newer console features worth knowing (V1926 and later; I couldn't open the PDFs)
- **"Macro OSC" device and macro type (V1926):** console macros can **send custom OSC** (int, float, string, or address only) to a chosen device. Macros can also be **triggered** by GPI, by incoming OSC, by MIDI programme changes, by fader thresholds, by meter levels, by solos, and as part of snapshot recall. [Community: KLANG guide, Hibino V1926 notes summary]
  - This means the **console can drive Companion**, for example through Companion's built-in OSC API to press a button or set a custom variable.
- **Generic OSC since 2018:** eight user-definable rotaries and eight switches per input, working in both directions. [Official press release]
- **Software versions:** V1528 (2022), V1926 (Nov 2024), V20 (2025), V2025, V21 (Dec 2025), V22 (Mar 2026: snapshot reordering, **Setlists**). The module was built against V20xx-era command files. **Setlists and snapshot reordering in V22 may change snapshot indexing [Unverified].**

### Things the SD9 Pad protocol exposes that the module doesn't put to good use
- **Current snapshot as a variable.** `Snapshots/Current_Snapshot` (and `Surface_Snapshot`, seen in the S21 capture) can be combined with `/Snapshots/name` records to give current, next and previous snapshot names and numbers. Today it is only a value feedback that returns an index.
- **Channel names as variables.** `.../Channel_Input/name`, `Buss_Trim/name` and `Control_Groups/*/name` are already discovered at start-up but only appear in dropdown labels.
- **Fader and send levels as variables or feedback**, formatted in dB, so the D200X LCD keys can show them.
- **Mute, solo and send-on as plain on/off colour feedbacks.** Value feedbacks need expressions to colour a button.
- **Macro button state and name** (`/Macros/Buttons/state`): working, but no ready-made button.
- **Meters** (`/Meters/request`, `/Meters/values`): in the CSV but not built ("everything but meters").
- **Session save and filename**, Snapshot undo and update: available, but no presets.

### Not available in the Pad command table (as far as I can tell)
- **Talkback on/off:** only `TalkBack_Input/.../analog_gain` and the talkback output count are there.
- **Mute groups:** no paths.
- **The aux sends-on-faders flip** exists (`sends_to_faders`), but surface layout and bank control is limited (`/Layout/Layout/Banks` is read-only in the capture).

**Workaround for talkback and mute groups [Unverified]:** build a console macro and assign it to an OSC macro button. Check on the SD9 that Macro Editor actions can toggle mute groups and talkback.

---

## (c) Improvement ideas, in priority order (in the style of our other modules)

**P0: make the basics trustworthy**
1. **Fix the port defaults** to match HELP: listen 7000, send 7001. Also add a check that refuses to start, with a clear status, when the console's ports and ours look swapped (nothing received within 5 s of a query).
2. **Track our own sends in the cache (optimistic writes)**, with a short "pending" window and a reconcile step when the console echoes. Relative changes and Toggle then work whether or not Suppress OSC Retransmit is on.
3. **Command queue with coalescing:** for each path, keep only the latest pending value. Pace sends at about 50–100 per second, give each query a timeout and 1–2 retries, and make the query timeout configurable (default 300–500 ms).
4. **Real connection state:**
   - Send a `/Console/Name/?` heartbeat every 2–5 s.
   - Report Connecting, Ok, or Disconnected after N misses.
   - When the console comes back, clear the cache and re-run discovery (counts, names, snapshots).
   - Expose a `connected` variable and a `last_seen` variable.
5. **Fix the upgrade script:**
   - Migrate the old config.
   - Fix the macro feedback id and its option.
   - Map old "macro press" to `/Macros/Buttons/press` with n−1.
   - Convert normalised faders to dB when the old `series` was `OSC`.
   - Bump the version above 1.0.4 (for example to 2.0.0).

**P1: knob-friendly control for the D200X encoders**
6. **Dedicated step actions:** "Fader step", "Aux send step", "Control Group step", "Gain/trim step", "Pan step".
   - Step size 1–10 with direction ±.
   - A **dB-aware step curve:** fine near 0 dB, coarse below −40 dB, plus a snap from −∞ to −60 dB, as in our other modules.
   - Clamp to the row's min and max.
   - Intended for `rotate_left`/`rotate_right` on the D200X encoders, with push to toggle mute (or send-on, or reset to 0 dB).
7. **"Selected channel" model:**
   - Module variables `sel_type` and `sel_index`.
   - Actions to select next or previous channel or aux, and to select by number.
   - Encoder actions that act on whatever is selected. Three encoders become fader, aux send to the chosen mix, and gain or pan.
   - This is the same pattern as our Panasonic/UAD selected-target work.
8. **"Sends on encoder" for monitor work:** choose an aux mix (variable), then the encoders adjust input N's send to it. Show the levels as dB text.

**P1: live feedback and variables**
9. **Boolean feedbacks**: mute, solo, send-on, phantom, macro state, "snapshot N is current".
10. **Variables**, all updated live from pushed messages:
    - `ch_<n>_name`, `ch_<n>_fader_db`
    - `aux_<n>_name`, `cg_<n>_name`, `cg_<n>_fader_db`
    - `snap_current_num`, `snap_current_name`, `snap_next_name`, `snap_prev_name`
    - `macro_<n>_name`, `macro_<n>_state`
    - `session_filename`, `console_name`
11. **Snapshot workflow:** recall next and previous, recall by number or name, undo, update current. Each comes with a "current snapshot name" display key and a confirm-style double-press option for Update.

**P2: macros, talkback and mute groups**
12. **Macro buttons:** list the OSC macro buttons by **console number 1–256 with their names**, a press action, an on/off state feedback, and a preset per discovered macro.
13. **Talkback and mute groups through macros:**
    - Document the pattern: make a console macro, assign an OSC button, press it from Companion.
    - Ship ready-made presets for "Talkback", "Mute Group 1–N" and "Mute All FX".
    - Feedback comes from the macro button's state.
14. **Macro OSC (V1926 and later):** document how the console can push to Companion. A console macro sends to Companion's OSC port, for example to set a custom variable or press a page/button, so console-side events (snapshot fired, solo pressed) can drive the D200X.

**P2: presets for the D200X**
15. **Preset pages:**
    - **Snapshots:** Prev / Current-name / Next / Undo / Update.
    - **Channel strip:** name and dB display, mute, solo, PFL, plus encoders for fader, send and gain.
    - **Monitor mix:** choose an aux; encoders adjust sends for three selected inputs.
    - **Control Groups 1–N:** mute, with the fader on an encoder.
    - **Macros:** one key per discovered macro.
16. **Optional "Other OSC (`/sd/`)" send-only transport:** for setups where the iPad already holds the Pad slot and the relay isn't wanted. It would carry its own dB↔0..1 table, marked unverified until it is measured.

---

## (d) Risks and unknowns to test on a real SD9 (or the SD offline software first)

- **Test without a desk first.** One community report says External Control works on the **SD offline software** (tested on SD10/SD12). Running the SD9 offline build on a Windows PC or VM next to the Mac would let us test without the console. It's unconfirmed whether the offline software needs the External Control activator. [Community]
- **Echo behaviour (most important):**
  - With Suppress OSC Retransmit ON and then OFF, does the console send our own changes back to us?
  - Does it push changes made on its surface (faders, mutes, snapshot fires) to the Pad device without being asked?
  - S21 HiJack lists unprompted pushes on SD as unknown. FADER_X and the module both assume pushes happen.
- **Firmware:** what software is on Will's SD9? Issue #20 reports odd behaviour on "v2025". V22's Setlists and snapshot reordering may change how `Current_Snapshot` and snapshot indexes behave.
- **Command file:** confirm the exact `iPadv2...` file name on Will's version, and that "Commands Allowed" is filled in.
- **Port direction:** confirm which way the console's Send and Rcv fields point, and that only one Pad device is enabled. The iPad app and Companion compete for the one slot unless the relay is used.
- **Values on the wire:**
  - fader range (−150 = −∞?)
  - pan range (−1..1 or 0..1)
  - booleans sent as floats
  - Control Groups numbered from 0 or 1
  - macro button numbering (0- or 1-based)
  - snapshot number vs list index (`num/100` in the entity schema)
- **Bus counts:** does the SD9 report aux and group counts separately, or as one pool plus `types`?
- **Query timing:**
  - How long does a reply take, and does the console drop bursts of queries?
  - How long does start-up discovery take with 96 or more channels? I haven't checked the SD9's exact channel and bus counts; confirm them against DiGiCo's spec sheet.
- **Talkback and mute groups:** confirm that console macros can toggle them and can be assigned to OSC buttons.
- **Rate limits:** how many fader messages per second the SD9 accepts before it lags (relevant to encoder spins and cross-fades).
- **Companion 5.1 compatibility:**
  - Does the v0.9.1 module (base 2.1.3) load in 5.1?
  - Which DiGiCo module version does Will's install currently show (legacy 1.0.4 or 0.9.x)?

---

## (e) Sources

**Code (cloned and read):**
- Module: https://github.com/bitfocus/companion-module-digico-osc. History from 2020 to 5 Oct 2026; legacy v1.0.4 at commit `08bbda5`; rewrite `ab484a8`/`0d5290d`.
- Fork with design notes and the `.dosc` parser: https://github.com/MeestorX/companion-module-digico-osc (`docs/code_description.md`, `scripts/parse-dosc.mjs`).
- Bundled legacy manifest: https://github.com/bitfocus/companion-bundled-modules (`_legacy/companion-module-digico-osc`).

**GitHub issues:**
- #20: https://github.com/bitfocus/companion-module-digico-osc/issues/20
- #19: https://github.com/bitfocus/companion-module-digico-osc/issues/19
- #12: https://github.com/bitfocus/companion-module-digico-osc/issues/12
- #15: https://github.com/bitfocus/companion-module-digico-osc/issues/15
- #21: https://github.com/bitfocus/companion-module-digico-osc/issues/21
- Issue list: https://github.com/bitfocus/companion-module-digico-osc/issues
- PR list: https://github.com/bitfocus/companion-module-digico-osc/pulls

**Official DiGiCo documents:**
- "Other OSC" command list, 17 Nov 2014. A copy is in the legacy repo at `api/DiGiCo_OTHER_OSC_List_17_11_14.pdf` and in S21_HiJack `Documentation/`.
- DiGiCo SD App User Guide, Issue D, Nov 2014: http://www.digico.org/DiGiCo_Manuals/DiGiCo_SD_App_User_Guide_Issue_D.pdf (I read a copy in S21_HiJack `Documentation/`).
- TN324 SD Series iPad External Control: https://digico.biz/wp-content/uploads/2020/02/TN324-SD-Series-iPad-External-Control.pdf (search snippet only; the host was blocked).
- "DiGiCo Opens Up the SD Range with Generic OSC control" (2018): https://digico.biz/digico-opens-up-the-sd-range-with-generic-osc-control/ (snippet only).
- Release notes, snippets only:
  - V1528: https://digico.biz/wp-content/uploads/2022/02/SD-and-Quantum-V1528-Release-Notes.pdf
  - V21: https://digico.biz/wp-content/uploads/2025/11/SD-and-Quantum-V21-Release-Notes.pdf
  - SD V1926: https://support.digico.biz/hc/en-gb/articles/29672999543953-SD-Console-Software-V1926
  - SD V2025: https://support.digico.biz/hc/en-gb/articles/33952872713105-SD-Console-Software-V2025
  - V22 news: https://www.avnation.tv/2026/03/27/digico-announces-v22-software-update/

**Community:**
- S21_HiJack, especially `Documentation/OSC_FIELD_NOTES.md`, `QUANTUM_VERIFICATION.md` and `iPad_handshake.txt`: https://github.com/pob31/S21_HiJack
- FADER_X DiGiCo driver (bare `/Input_Channels/n/fader`, in dB): https://github.com/stagehacks/FADER_X
- d&b Soundscape with DiGiCo SD (Other OSC setup, Suppress OSC retransmit, V1528): https://github.com/dbaudio-soundscape/db-Soundscape-control-with-DiGiCo-SD-Consoles
- KLANG DiGiCo Macro OSC guide: https://www.klang.com/manuals/digico-macro-osc/ (snippet only).
- Hibino V1926 notes: https://hibino-intersound.co.jp/download/file/21735.pdf (snippet only).
- QLab Google Group threads on DiGiCo snapshots: https://groups.google.com/g/qlab/c/L9liDZNwsRQ and https://groups.google.com/g/qlab/c/LR0XuvIeLxM

**Couldn't open (DNS or proxy blocked):** bitfocus.io, digico.biz PDFs, support.digico.biz, klang.com, stagehacks.notion.site, spacebearaudio.com. The GitHub search API was also unavailable to this session. Claims that depend on these sources come from search snippets only.
