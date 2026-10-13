# grandMA2, grandMA3 and ChamSys MagicQ in Bitfocus Companion: research report

Prepared 13 Oct 2026. This was read-only research: nothing was pushed. Local clones are in `/home/user/research/`.

**How sure each claim is.** Each claim carries one of these tags:
- **[Official]**: comes from MA Lighting or ChamSys documentation. Their doc sites (help.malighting.com, docs.chamsys.co.uk, secure.chamsys.co.uk) are blocked from this sandbox, so I read them only through search-engine extracts. Check the exact wording on the page before relying on it.
- **[Code]**: I read it in source code at the commit named.
- **[Community]**: a forum post, GitHub project or third-party product.
- **[Unverified]**: my own inference.

Nothing here has been tested on a console or on onPC.

---

## 0. Short answer

- **Improve grandMA2 first.**
  - Will named a specific MA2 build (onPC 3.9.60.89), so he is actually running it.
  - The Companion MA2 module is the weakest of the three. It has five actions, no feedbacks, one variable and two real bugs.
  - grandMA2 onPC is free and can be driven over the network (Telnet and Web Remote), so we can test without a console.
  - MA2 software is end-of-line (3.9.60.x), so the undocumented Web Remote JSON that gives us fader levels, executor names and cue names is unlikely to change under us.
- **MA3 second.** Its module has better structure but only one feedback, no fader control, and a hard-coded OSC address that depends on the software version. Good readback needs a small Lua plugin on the console.
- **MagicQ last.** The `chamsys-magicq-osc` module is in the best shape of the three: recently modernised, with playback and execute feedback. It also has a new regression (see 2.3). The real blocker is testing: **MagicQ PC only allows OSC in "unlocked" mode**, which needs ChamSys hardware (a MagicQ wing, Connect interface or dongle) **[Official, via search extract]**.

---

## 1. Which modules exist

From `bitfocus/companion-bundled-modules`, plus a probe of the repo names on GitHub:

| Companion id | Repo | Bundled version | Repo `main` version | Last human commit | Runtime / API |
|---|---|---|---|---|---|
| `malighting-grandma2` | bitfocus/companion-module-malighting-grandma2 | 2.3.0 | 2.3.0 | 28 Nov 2025: "store console terminal response as variable" (Greaple, PR #30). Everything since is bots | JS, `@companion-module/base` ^1.8, node18 |
| `malighting-grandma3` | bitfocus/companion-module-malighting-grandma3 | 1.2.2 | 1.4.1 | 14 Aug 2026 (Luca Heß, a batch of "fixed C2..C8, H1, M2, M7, L4+8" commits) | TS, base ~1.14, node-osc |
| `malighting-msc` | bitfocus/companion-module-malighting-msc | 1.4.0 | 1.4.0 | Bots only recently | JS, base ^1.8, `mamsc` lib. MIDI Show Control over Ethernet, for dot2 and grandMA2 |
| `chamsys-magicq-osc` | bitfocus/companion-module-chamsys-magicq-osc | 3.1.1 | 3.2.1 | 1 Oct 2026 (Elliot Matson, PR #44 "split into modules") | JS, base ~2.0.4 (API 2), node22, `osc` lib |
| `chamsys-magicq-udp` | bitfocus/companion-module-chamsys-magicq-udp | 2.1.0 | 2.1.0 | 10 Jul 2024: variable parsing | JS (CommonJS), base 1.x, UDPHelper |
| `chamsys-quickq` | (not cloned) | 1.0.2 | – | – | QuickQ, not MagicQ |

- These names do not exist under bitfocus: `companion-module-chamsys-magicq`, `-malighting-grandma3-osc`, `-chamsys-magicqosc`. They returned auth prompts, which is GitHub's answer for a missing public repo.
- GitHub reports 0 open issues on the MA2 repo and 1 on the MA3 repo. I could not read issue text, because the GitHub tool here is limited to Will's own repos.

---

## 2. What each module does today

### 2.1 grandMA2 (`malighting-grandma2` 2.3.0, master `c9bb1d0`)

**Protocol.**
- Telnet on TCP **30000**, using `TelnetHelper` from module-base **[Code]**.
- The console needs Setup → Console → Global Settings → Telnet set to "Login Enabled" or "Login Disabled" **[Official]**.
- Port 30001 is a read-only System Monitor **[Official]**.
- Login: it waits for `Please login`, then sends `login <user> <pass>`. Defaults are `administrator` / `admin`.

**Actions** (all of them):
1. `command`: run a custom command line. Supports variables.
2. `button`: a hard-key press or release, sent as `LUA 'gma.canbus.hardkey(id, true|false, false)'`, from a list of about 140 keys (Go+, Go−, Pause, X1–X20, Fix/Select/Off/Temp/Top/On/Learn/Goto, Esc, Oops and so on).
3. `wheel`: `LUA 'gma.canbus.wheel(n)'`.
4. `encoder`: `LUA 'gma.canbus.encoder(idx, steps, nil)'` with direction and a 1–100 step. Picks one of 8 encoders.
5. `encoder_p`: encoder press or release.

**Feedbacks:** none.
**Variables:** `response` only (the last chunk of Telnet text, ANSI stripped).
**Presets:** none.
**State readback:** none.

**Encoders.**
- Only *console* encoders are emulated, through Lua `gma.canbus`.
- There is no executor fader control apart from typing a raw command.
- `gma.canbus` presses virtual hardware keys. I have not confirmed whether it behaves the same on onPC without a wing **[Unverified]**.

**Bugs I can see [Code]:**
1. **Crash on Telnet negotiation.**
   - The `iac` handler calls `socket.write(...)`, but `socket` is not defined (it should be `this.socket`).
   - `TelnetHelper` does emit `iac`: module-base 1.14.1 `dist/helpers/telnet.js:56`. Any IAC DO/WILL from the console would throw a ReferenceError inside a stream event, which is likely an uncaught exception that kills the module process.
   - Whether MA2 sends IAC is **[Unverified]**.
2. **Reconnect timer leak.**
   - `destroy()` never clears `socketTimer`, and the retry uses `setInterval`. After the connection is deleted or disabled while the console is down, the timer keeps calling `init_tcp()`, creating sockets for a dead instance.
   - Reconnect also fights the helper: `TCPHelper` already auto-reconnects every 2 s (module-base `tcp.js`, `reconnect: true`), and the module destroys it and builds its own 10 s loop on top.
3. **Status is wrong.**
   - Ok is set only when the text `Logged in as User` arrives and does not contain `guest`.
   - If Telnet is set to "Login Disabled", or the user logs in as guest, the status never becomes Ok, although commands still go out.
   - Nothing ever detects a console that has silently stopped answering: there is no heartbeat.
4. **Unquoted login.** `login administrator admin` is sent unquoted. MA's command line expands abbreviations, and on the forum `Login Al bundy` became `Login Align bundy`, so the fix is to quote both values **[Community]**.
5. **Bad option values are sent as-is.**
   - The `encoder` direction dropdown has no default, so a new action sends `gma.canbus.encoder(0, NaN, nil)`.
   - `wheel` sends `NaN` for non-numeric input.
   - User text is pasted inside `LUA '...'` without escaping a `'`.
6. **No message boundaries.** The `response` variable is whatever TCP chunk arrived last, so it can be half a line or several lines.
7. **No command queue or spacing.** Commands are written straight to the socket, and anything sent while disconnected is dropped and only logged at debug level. That suits Go: retrying a Go would skip a cue.
8. Manifest product text says only "GrandMA2"; HELP is minimal.

### 2.2 grandMA3 (`malighting-grandma3`: repo 1.4.1 at `ad5d2a9`, bundle has 1.2.2)

**Protocol.**
- OSC over UDP. It sends to the console's input port (default 8081) and listens on a local port (default 8082). Optional input and output prefixes.
- Console setup: Menu → In & Out → OSC, with "Receive", "Receive Command" and (for feedback) "Send" ticked **[Code, from HELP.md]**.

**Actions** (17):
- Every command action sends `/cmd ,s "<command>"`:
  - Quickey by number or name
  - Select Group by number or name (`SelectFixtures Group n`)
  - MAtricks by number or name
  - Select Sequence by number or name
  - Call Plugin by number or name
  - Call Macro by number or name
  - "At Menu" (At Full / Zero / Default / Normal / Release / Remove, On/Off Selection, Copy/Cut/Paste/Delete Programmer)
  - Run Command (supports variables)
- `exec_button` is the one exception. It sends `/Page<p>/Key<n>` with type `T` on push and `i 0` on release.

**Feedbacks:** one. `sequence_active` (boolean), keyed by sequence number.
**Variables:** none. **Presets:** none, although `configuration-examples/` has a Stream Deck XL page and an MA3 Lua plugin that creates Quickeys for the Command Wing keys.

**Readback.**
- It parses incoming OSC whose address looks like `/<prefix>/14.14.1.6.<seq>`.
- If args[0] contains "Fader", it reads level > 0 as active; otherwise args[1] is taken as the on state.

**Encoders and faders:** no fader action at all, so knobs are impossible today. There is also no Go+, Go− or Pause action apart from a raw command.

**Bugs I can see [Code]:**
1. **Address depends on the software version.**
   - `14.14.1.6` is a hard-coded index path into MA3's object tree (ShowData → DataPools → Default → Sequences).
   - Forum users report other values on other builds, for example `/11.14.1.5.99,sif` **[Community]**. When the tree changes, the only feedback silently stops working.
2. **Feedback probably needs a prefix.**
   - Without an output prefix, an address like `/14.14.1.6.3` splits so that `prefix = '14.14.1.6'` and `gma3Address = undefined`. The switch never matches.
   - So the HELP text's "prefixes are optional" claim appears wrong for feedback. Feedback seems to work only when the console adds a prefix segment **[Code + Unverified]**.
3. **Crash on unexpected data.** `buttonName.includes(...)` throws if args[0] is not a string, or is missing. This runs inside node-osc's message event without a try/catch, so it is probably fatal.
4. **Status is always Ok.** Ok is set once the local UDP port binds. It never checks that the console is there.
5. **Names are not quoted safely.** `Quickey "<name>"` and the like do not escape a `"` in the name.
6. **Current-page option probably wrong.** "Use current page" sends `/Page/Key201`. I could not confirm that MA3 accepts a bare `/Page` as "current page" **[Unverified]**.
7. **Config change can lose the listening port.** `configUpdated` re-binds the server without awaiting errors. If the old port is still closing, the new bind can fail with EADDRINUSE and leave status at ConnectionFailure until the next change **[Unverified]**.

### 2.3 ChamSys MagicQ OSC (`chamsys-magicq-osc`: repo 3.2.1 at `dc4b93d`, bundle has 3.1.1)

**Protocol.**
- OSC over UDP. Defaults: console RX 8000, feedback RX 9000.
- On start it sends `/feedback/pb+exec` to subscribe to feedback.
- It can forward everything it receives to Companion's own OSC listener.

**Actions** (13):
- `pb` set level: `/pb/N ,i 0-100`
- `pbAdjust`: relative. Reads the module's tracked level and sends the absolute result.
- `pbGo` (`/pb/N/go`), `pbFlash` (on, off or toggle, `/pb/N/flash`), `pbPause`, `pbRelease`, `pbJump` (`/pb/N/<cue>`)
- `dbo` (on, off or toggle)
- `swap` (add or swap)
- `execute` (`/exec/P/N ,f 0-1`, or toggle)
- `executeAdjust`
- `tenScene` (`/10scene/i/z`)
- `rpc` (`/rpc ,s`: a ChamSys Remote Protocol command inside OSC)

**Feedbacks** (all boolean): Playback Level (compare against a %), Playback Flash, Execute Level.

**Variables:**
- `pb1..10` and `pb1..10_flash`
- `execP_N`, registered the first time each one is seen

**Readback.**
- Playback fader levels (0–1 float → %), flash state and execute levels.
- No cue names, cue numbers or "playback active" flag. MagicQ's OSC feedback does not appear to carry them **[Official, as far as the extracts go]**.
- Playbacks are limited to 1–10, which is MagicQ's built-in OSC range **[Official]**.

**Bugs I can see [Code]:**
1. **New regression: `Regex` is not imported in `src/main.js`.**
   - `getConfigFields()` uses `Regex.IP` and `Regex.PORT`, but the file imports only `InstanceBase` and `InstanceStatus`.
   - It came in with commit `c07b37f` ("Split index.js into src/ modules", merged 1 Oct 2026 as PR #44). The old `index.js` did import `Regex`.
   - Opening the connection's config will throw a ReferenceError. This is on `main` only (3.2.1); the bundled 3.1.1 predates it.
   - It is a small fix and could be offered upstream.
2. **No heartbeat.** With feedback on, status becomes Ok on the first message received and never drops back. If the console vanishes, it stays green.
3. **Adjust relies on tracked state.** `pbAdjust` and `executeAdjust` start from the module's tracked value. With feedback off, that value is only what Companion last sent, so a fader moved on the desk jumps.
4. **Fader values sent as integer 0–100.** `pb` and `pbAdjust` send integers. MagicQ accepts "float 0.0–1.0 or int 0–100" **[Official, via extract]**, so this is fine, but it limits resolution to 1 % (fine for knobs).
5. `configUpdated` calls `init()` again without `await`, which re-registers everything. Harmless.

### 2.4 ChamSys MagicQ UDP (`chamsys-magicq-udp` 2.1.0, `ecbe09c`)

**Protocol.**
- ChamSys Remote Ethernet Protocol (CREP) as ASCII command strings on UDP 6553, for example `4,50L`, `1G`, `1A`, `1R`, `2,5,0J`, `3P`.
- MagicQ's doc describes a binary header: `CREP` (shown on the wire as `PERC`), version, sequence bytes and length **[Official, via extract]**. **This module sends no header**, only the bare text. Whether MagicQ accepts headerless packets is **[Unverified]**. The module has worked for some people, so it probably does, but it does not follow the spec.

**Actions:** playback level, intensity channel level, Go, Activate, Page, Stop, Fast Forward, Fast Back, Release, Jump to Cue. HELP lists DBO, but **there is no DBO action**.

**Feedbacks, variables, presets, readback:** none.

**Bugs:**
1. `configUpdated` calls `this.status(...)`, a Companion 2 API that does not exist in module-base 1.x. The first status change after editing the config throws a TypeError.
2. No default host, so `UDPHelper(undefined, …)` runs on first add.
3. Option text is concatenated into the command with no number checks.

### 2.5 MA MIDI Show Control (`malighting-msc` 1.4.0)

This is worth knowing about because it is the one existing module that reads **MA2 executor state** back:
- Actions: goto cue, pause, resume, fader set / increase / decrease with fade, fire macro, executor off.
- Feedbacks: executor active, paused, current cue number, fader position.
- Variables: `exec_<page>.<exec>_{active,paused,cue,fader}` for a configured list of executors.

Console setup: MSC mode Ethernet, Exec.Page, command format All, ports 6000–6100 **[Code, from HELP]**.

Limits:
- No names, and no cue *names*.
- Fader info wraps above executor 127.
- Status is Ok as soon as the UDP sockets bind.
- Bug: the `off` message sets `exec.fader = 0` but never updates the `_fader` variable **[Code]**.

---

## 3. What the consoles expose that the modules do not use

### 3.1 grandMA2 (3.9.x)

**Telnet (port 30000)** **[Official]**. Any command-line command works, so the module could offer real actions instead of raw text:
- **Fader level:** `Fader [page].[exec] At <0-100>`. The MA help shows `Fader 5 At 50` **[Official]**. The dotted `Fader 1.5 At 50` form follows the documented syntax, but I have not seen it tested **[Unverified]**.
  - Grand master: `SpecialMaster "grandmaster"."grand" At 50` **[Official]**.
  - Relative `At + 5`: **[Unverified]**.
- **Playback control:** `Go Executor 1.5`, `GoBack Executor 1.5`, `Pause Executor 1.5`, `Off Executor 1.5`, `Toggle Executor 1.5`, `Goto Cue 3 Executor 1.5`, `Flash`, `Temp`, `Swop` **[Official keywords; exact forms Unverified]**.
- **Selection and pages:** `Select Executor 1.5`, `FaderPage 2`, `ButtonPage 2`.
- **Reading state through Telnet is poor.**
  - The MA forum (2018) says fader levels cannot be read from the command line or from Lua, because they belong to the real-time playback engine, not to show objects **[Community]**.
  - Lua *can* read show objects, for example `gma.show.getobj.handle`, `gma.show.getobj.label`, `gma.show.property.get`, and `gma.show.getvar('SELECTEDEXEC')` and `getvar('FADERPAGE')` **[Community]**. Cue names could be pulled that way, but getting the output back over Telnet means parsing text **[Unverified]**.

**Web Remote (WebSocket `ws://<ip>:80/?ma=1`, JSON).** This is the useful one. It is undocumented, but several projects have reverse-engineered it the same way **[Community]**:
- Projects: `johnsudaar/xtouchgma2` (Go, `gma2ws/`), `klnspdr/node-grandma2`, `ArtGateOne/ma2apcmini` (active 2024), a Chataigne module and a Q-SYS plugin.
- **Handshake and login:**
  - Send `{"session":0}`. The console replies with status, then `{session, forceLogin, ...}`.
  - Then send `{"requestType":"login","username":..,"password":md5(pw),"session":S,"maxRequests":10}`.
  - Keep the session alive by sending `{"session":S}` every ~20 s.
- **`playbacks` request** (poll; the community clients poll every ~100 ms):
  - Request: `{"requestType":"playbacks","startIndex":[0],"itemsCount":[N],"pageIndex":P,"itemsType":[2],"view":2,"execButtonViewMode":1,"buttonsViewMode":0,...}`. Page and executor indexes are 0-based; item counts come in multiples of 5. Type 2 is fader executors, 3 is button executors.
  - The reply holds, per executor:
    - the name (`tt.t`)
    - the running flag (`isRun`)
    - `cues.items[]`: the text of the previous, current and next cue (cue number and name)
    - the fader value `v`, with `min`, `max` and value text `vT`
    - button labels and colours
- **`playbacks_userInput`:**
  - Fader: `{execIndex, pageIndex, faderValue: 0..1, type:1}`.
  - Button press or release: `{execIndex, pageIndex, buttonId: 0|1|2, pressed, released, type:0}`.
  - This gives *real* momentary Flash and Temp from a key's down and up events.
- **`command`** (`{"requestType":"command","command":"..."}`), **`keyname`** (hard keys), and **`getdata`** (key LED states, for example `set,clear,solo,high`).
- **Console settings** **[Official]**:
  - Setup → Console → Global Settings → Remotes set to "Login Enabled" (or "Login Disabled").
  - **You cannot log in as Administrator**, so create a separate user with a password.
  - **At most 3 remote users** can be logged in at once.
  - Web-browser remote has existed since 3.1, for consoles and onPC **[Official, product archive]**.

**MIDI Show Control over Ethernet** (ports 6000–6100) **[Official / Code]**:
- Gives cue number, active state, pause state and fader level per executor, pushed by the console.
- This is a fallback source of state if Web Remote is not wanted.

### 3.2 grandMA3

**OSC in.** Configured in In & Out → OSC **[Official, via extracts]**:
- `/cmd ,s` for any command line.
- `/PageN/FaderX ,i|f 0-100`, for example `/Page1/Fader201,i,50`.
- `/PageN/KeyX`, and `ExecutorKnob` addresses.
- These addresses are case-sensitive. The `SendOSC` keyword uses the same syntax: `SendOSC 1 "/Page1/Fader201,i,50"`.

**OSC out (native).**
- With "Send" ticked, MA3 sends **per-sequence** messages keyed by the object-tree handle, for example `/11.14.1.5.99,sif` (name, int, float).
- It does **not** send per-fader `/PageN/FaderX` messages, and the Page / Fader / Key fields do not change this **[Community, MA forum]**.
- Hence the version-dependent `14.14.1.6` in the module.

**Lua plugin route** (what the community uses for motor-fader and button-LED feedback) **[Community]**:
- `GetExecutor(n):GetFader{}` returns the fader level. A loop sends `SendOSC <cfg> "/Fader201,i,<v>"` every 0.5 s (`ArtGateOne/MA3_OSC_FEEDBACK`, riksolo's 2024 "Fader Feedback" plugin, `xxpasixx/pam-osc`).
- The same plugin could send executor names, sequence names, current and next cue names and the current page **[Unverified: needs the right Lua object calls]**.
- We would ship it as an MA3 plugin XML+Lua beside the module, as the existing module already does for Quickeys.

**Web Remote:** in MA3 it is a different thing (a browser view on port 8080, switched on in the Network menu) **[Official]**. It is not a JSON API we can use **[Unverified]**.

**Versions:** the OSC page exists in the 1.9 to 2.x manuals. Handle numbers change between releases **[Community]**. Will's MA3 version is unknown, so ask him.

### 3.3 ChamSys MagicQ

**OSC** **[Official, via extracts]**:
- Set the mode and the TX/RX ports in Setup → View Settings → Network. Port 0 switches a direction off. Set the OSC TX IP to Companion's IP.
- Addresses:
  - `/pb/N` (level, float 0–1 or int 0–100)
  - `/pb/N/go`, `/pause`, `/release`, `/flash`, `/pb/N/<cue>`
  - `/dbo`, `/swap`, `/exec/...`
  - `/feedback/pb`, `/feedback/exec`, `/feedback/pb+exec`, `/feedback/off`
- Only the first 10 playbacks and the first 10 execute grids work through the built-in addresses. MagicQ does not send OSC bundles.
- Feedback covers playback levels, flash and execute state only. **No cue names or cue numbers** in OSC feedback, as far as I could find.

**CREP (UDP 6553)** **[Official]**:
- Commands are `<n>A/R/T/G/S/B/F`, `<n>,<lvl>L` (int 0–100) and `<n>,<cue>,<dec>J`, plus page and channel commands.
- The console also *transmits* CREP for playback sync between consoles. I did not confirm whether that carries usable cue state **[Unverified]**.
- CREP is not available while MagicQ is in network-session mode.

**Unlocked mode.** OSC and the other remote-control protocols are listed as "Unlocked Mode" features. They need MagicQ hardware: Mini Connect, Compact Connect, Stadium Connect, Compact Wing or the Rack Mount Dongle. **MagicDMX interfaces do not unlock it** **[Official, via extract]**.

---

## 4. Recommendation and plan

### 4.1 Why grandMA2 first

1. **Will uses it.** onPC 3.9.60.89 is the exact build he named.
2. **The gap is biggest.** There is no executor control, no feedback and no names. There is also a crash bug and a timer leak.
3. **The data is there.** Web Remote gives executor name, fader %, run state and previous/current/next cue text in one poll. That is everything the D200X layout needs.
4. **It is testable for free.** grandMA2 onPC is free and accepts both Telnet and Web Remote over the LAN.
5. **It is a stable target.** MA2 is in maintenance (3.9.60.x), so the undocumented protocol should not move.

MA3 would need a console-side Lua plugin before the knobs are worth anything. MagicQ's module is already decent, and we cannot test it without ChamSys hardware.

### 4.2 Build approach

- Make a new `grandma2/` module in `companion-tools`, in TypeScript, with module-base, Node 22's built-in `WebSocket` and `node:net` (no new dependencies). Follow the layout of `digico-sd/src/`: `main.ts`, `telnet.ts`, `webremote.ts`, `knobs.ts`, `actions.ts`, `feedbacks.ts`, `variables.ts`, `presets.ts`, `upgrades.ts`, and `test/*.test.mjs`.
- **Keep the old action ids** (`command`, `button`, `wheel`, `encoder`, `encoder_p`) so Will's existing MA2 buttons can be imported. Fix their NaN defaults.
- **Two transports, each optional:**
  - **Telnet (port 30000) for commands.** It is documented, gives a single ordered command line and returns text replies.
  - **Web Remote for state, and for faders and momentary buttons.**
  - If Web Remote is off or login fails, the module still works in "commands only" mode, with feedbacks shown as unknown and grey.

### 4.3 Prioritised work list

1. **Connection robustness** (do this first: everything else depends on it).
   - **Telnet:**
     - Let `TCPHelper` do the reconnecting, with no second timer, and clear everything in `destroy()`.
     - Fix the `iac` bug: reply with WONT/DONT through `this.socket`, inside a try/catch.
     - Quote the login: `Login "user" "pass"`.
     - Set Ok on "Logged in" or after the prompt when login is disabled. Treat guest as a warning, not a silent hang.
     - Split replies into lines and strip ANSI.
     - Heartbeat: send a harmless command (for example an empty line, or `ListVar`?) every ~10 s and expect a prompt within 3 s, otherwise mark it as down **[Unverified which command is cheapest]**.
   - **Web Remote:**
     - Handshake, login with the MD5 password, keep-alive every 20 s.
     - Reconnect with backoff (1, 2, 5, 10 s).
     - Status: "Telnet ok, Web Remote: login refused (Administrator not allowed)" and similar messages.
     - Warn in HELP about the 3-remote-user limit.
   - **Command queue:**
     - One FIFO, with about 30 ms between Telnet lines **[Unverified spacing]**.
     - **Never retry** Go, GoBack, Toggle, Flash or any button event. Drop them with a warning if the link is down, because a duplicated Go skips a cue.
     - Fader sets are absolute, so merge them: only the newest value per executor is sent, and resending is safe.
   - Never let a bad JSON frame or an odd Telnet line throw: wrap every parser in try/catch and log at debug.
2. **Executor fader knobs, step 1–10** (`knobs.ts`, reusing `STEP_SIZES` and `stepLevel()`).
   - Step table in %: `[1, 2, 3, 4, 5, 6, 8, 10, 15, 20]` (proposal).
   - Each click: current level from the poll (or from our last send), plus or minus the step, clamped to 0–100. Send as Web Remote `playbacks_userInput type 1` (0..1), or fall back to Telnet `Fader p.e At n`.
   - Count every click on fast turns. Merge the sends to one per ~40 ms per executor.
   - Encoder press on the selected executor = toggle between 0 % and full or the last level (option).
   - Extra knob actions: grand master (`SpecialMaster`), fader page ±, button page ±, and selected executor ±1.
3. **Go / Back / Pause keys with cue display.**
   - Actions for a chosen or selected executor: `Go`, `GoBack`, `Pause`, `Off`, `Goto Cue n`.
   - Variables per watched executor:
     - `exec_<p>_<e>_name`
     - `_level` (%)
     - `_level_text`
     - `_running` (on/off)
     - `_cue_prev`, `_cue_cur`, `_cue_next` (cue number and name, from the `cues.items` text)
   - The same set again as `sel_*` for the selected executor.
   - The watched list is a config field, for example `1.1-1.15, 1.101-1.105`. Poll only those ranges, in multiples of 5 as the protocol requires.
   - Poll every 150–250 ms, which is plenty for a key display, and only while the Web Remote is logged in.
4. **Selected-executor strip.**
   - `select_exec` (absolute, or ± within the watched list) chooses which executor the knobs and Go/Back/Pause/Flash/Temp keys act on.
   - Optionally also send `Select Executor p.e` so the console follows (off by default).
   - Variables `sel_page`, `sel_exec`, `sel_name`, `sel_level`, `sel_cue_cur`, `sel_cue_next`.
5. **Flash and Temp keys.**
   - Use Web Remote `playbacks_userInput type 0` with `pressed` on key down and `released` on key up, for exec buttons 1–3. These act exactly as the console's executor buttons are assigned (Flash, Temp, Go, Toggle).
   - Falls back to the Telnet `Flash`/`Temp Executor` keyword (latching) when there is no Web Remote.
   - **This needs testing on onPC** to confirm buttonId order and the release behaviour.
6. **On/off feedbacks** (boolean, plain style as in `digico-sd`):
   - executor running
   - fader above a threshold
   - at full
   - selected
   - flash held (local)
   - connection state, with separate states for Telnet and Web Remote
   - Plus advanced/value feedbacks for the level bar text if we want one.
7. **D200X presets** (13 keys + 3 encoders):
   - Encoder 1: selected executor fader; press = to 0 / back.
   - Encoder 2: next executor fader.
   - Encoder 3: grand master; press = fader page +1.
   - Keys:
     - Prev and next executor (select), showing the name.
     - Go+ for the selected executor, showing `sel_cue_next`.
     - Go−, Pause (lit while running) and Flash (momentary) for the selected executor.
     - Temp.
     - Off.
     - 5 quick-select keys for executors 1–5, each showing name, level and a running colour.
   - Build the layout around the 3-wide encoder strip, as the UAD, Panasonic and DiGiCo presets are.
8. **Tests** (`node --test`): step maths and clamping, page/exec range parsing, Web Remote JSON parsing using fixtures taken from the community type definitions, and the queue rules (no retry for Go, merging for faders).
9. **Later:** optional MSC listener as a third state source, and cue-name lookup through Lua over Telnet for executors not on the polled page.

### 4.4 After MA2

- **MA3:**
  - Add `/PageN/FaderX` set and knob actions, Go+/Go−/Pause through `/cmd` (`Go+ Executor 201`, and so on).
  - Escape `"` in names.
  - Make the handle prefix configurable or auto-learned instead of fixed at `14.14.1.6`, and wrap the parser in try/catch.
  - Ship a small Lua plugin that sends executor level, name and current/next cue name for a configured executor list to Companion over OSC (based on `GetExecutor(n):GetFader{}`). Without it there is no knob feedback.
  - Heartbeat: have the plugin send a periodic `/companion/alive`.
- **MagicQ:**
  - Upstream one-line fix: import `Regex` in `src/main.js`.
  - Then add our knob layer (playbacks 1–10, 1–10 steps against the fed-back level), a heartbeat (re-send `/feedback/pb+exec` every ~10 s and mark down if nothing arrives) and D200X presets.
  - Cue names are not available over OSC, so the Go keys cannot show them.

### 4.5 What needs a console or the free software to test

| Item | Free software that can stand in | Can Companion drive it over the network? |
|---|---|---|
| MA2 Telnet commands, login, reconnect | **grandMA2 onPC (free, Windows)** | **Yes.** MA says Telnet reaches "Console or onPC" on port 30000 **[Official]**. Companion on Will's Mac can talk to his PC over the LAN |
| MA2 Web Remote polling, fader set, Flash/Temp press | grandMA2 onPC | **Probably yes.** MA's archive says the web remote works with onPC since 3.1 **[Official]**. I could not confirm the exact onPC menu path. Needs a non-Administrator user |
| `gma.canbus` hard keys and encoders on onPC | grandMA2 onPC | Should run. Whether virtual key presses match a real console is **[Unverified]** |
| MA2 motor-fader feel, timing under a big show, 3-user limit with other remotes in use | Real console or onPC with a show loaded | – |
| MA3 OSC in, `/cmd`, `/PageN/FaderX` | **grandMA3 onPC (free; Win and Mac)** | **Yes, as far as I know.** OSC In & Out is in the onPC software and the module's example plugin targets onPC **[Community]**. Use the same software version as the real console |
| MA3 native OSC out handle numbers, and the Lua feedback plugin | grandMA3 onPC | Yes. Check the handle numbers on Will's actual version |
| MagicQ OSC and CREP | **MagicQ PC/Mac is free, but OSC needs "Unlocked Mode"**, which needs ChamSys hardware (MagicQ wing, Mini/Compact/Stadium Connect, or dongle). A MagicDMX interface does not unlock it **[Official, via extract]** | **Not in plain demo mode.** Test against a real MagicQ console, or a PC with an unlocking wing or interface |
| D200X layout and encoder feel | Will's D200X + Companion 5.1 | – |

What I can do in this sandbox without any console: unit tests against recorded or fabricated JSON and Telnet transcripts, plus a tiny fake Telnet and Web Remote server for the tests. The real-console checks have to be done by Will on his own machines.

---

## 5. Uncertainties to settle with Will or on onPC

- The exact Telnet syntax for page-qualified faders (`Fader 1.5 At 50`), and whether relative `At + 5` works.
- Whether the MA2 Telnet server sends IAC negotiation, which would trigger the current module's crash.
- How the Web Remote button (`buttonId` 0/1/2) maps to the executor's physical buttons, and how `released` behaves for Temp.
- Whether Web Remote on onPC 3.9.60.89 needs anything beyond Global Settings → Remotes.
- Which MA3 version Will runs, and which ChamSys hardware he has, if any (it decides whether MagicQ OSC is even usable).

---

## Sources

**Repos (cloned under `/home/user/research/`):**
- https://github.com/bitfocus/companion-bundled-modules
- https://github.com/bitfocus/companion-module-malighting-grandma2 (master `c9bb1d0`)
- https://github.com/bitfocus/companion-module-malighting-grandma3 (main `ad5d2a9`)
- https://github.com/bitfocus/companion-module-chamsys-magicq-osc (main `dc4b93d`; regression in `c07b37f`)
- https://github.com/bitfocus/companion-module-chamsys-magicq-udp (`ecbe09c`)
- https://github.com/bitfocus/companion-module-malighting-msc (`dd1a58a`)
- Community, MA2 Web Remote: https://github.com/johnsudaar/xtouchgma2 (`gma2ws/`), https://github.com/klnspdr/node-grandma2, https://github.com/ArtGateOne/ma2apcmini, https://github.com/DJFPaul/grandMA2-Chataigne-Module, https://github.com/locimation/qsys-plugins
- Community, MA3 feedback: https://github.com/ArtGateOne/MA3_OSC_FEEDBACK, https://github.com/xxpasixx/pam-osc, https://riksolo.com/blog/grandma3-fader-feedback-2024-05-04/
- `@companion-module/base` 1.14.1 from npm (`dist/helpers/telnet.js`, `tcp.js`)

**MA Lighting docs (read through search extracts only):**
- Telnet: https://help.malighting.com/grandMA2/en/help/key_remote_control_telnet.html
- Telnet keyword: https://help.malighting.com/grandMA2/en/help/key_keyword_telnet.html
- Fader keyword: https://help.malighting.com/grandMA2/en/help/key_keyword_fader.html
- SpecialMaster keyword: https://help.malighting.com/grandMA2/en/help/key_keyword_specialmaster.html
- MA2 Web Remote: https://help.malighting.com/grandMA2/en/help/key_remote_control_web_remote.html
- MA remote product archive: https://www.malighting.com/product-archive/product/ma-remote-control-MAremote/
- MA3 OSC: https://help.malighting.com/grandMA3/2.3/HTML/remote_inputs_osc.html
- MA3 SendOSC keyword: https://help.malighting.com/grandMA3/2.2/HTML/keyword_sendosc.html
- MA3 OSC advanced examples: https://help.malighting.com/grandMA3/2.1/HTML/osc_advanced_examples.html
- MA3 Web Remote: https://help.malighting.com/grandMA3/2.4/HTML/network_webremote.html

**MA forum:**
- Read fader values over Telnet: https://forum.malighting.com/forum/thread/61126-read-fadervalues-over-telnet/
- OSC out: https://forum.malighting.com/forum/thread/7614-osc-out/
- onPC Telnet: https://forum.malighting.com/forum/thread/40505-onpc-telnet-possible/
- MA2 Lua reference (community): https://github.com/Hobadee/grandMA2_LUA_ldoc/blob/master/gma.show.lua

**ChamSys docs (read through search extracts only):**
- OSC: https://docs.chamsys.co.uk/magicq/open-sound-control/OSC.html
- UDP / CREP: https://docs.chamsys.co.uk/magicq/network-control/remote_control_network.html
- Remote protocol commands: https://docs.chamsys.co.uk/magicq/manual/remote_control_commands.html
- MagicQ on PC and Mac (demo vs unlocked): https://docs.chamsys.co.uk/magicq/1.9.7.x/manual/magicq_pc.html
- Controlling MagicQ over UDP (Crestron): https://info.chamsyslighting.com/article/446-controlling-magicq-from-other-systems-using-udp-for-example-crestron
- MagicQ OSC module API v2 PR: https://github.com/bitfocus/companion-module-chamsys-magicq-osc/pull/29
