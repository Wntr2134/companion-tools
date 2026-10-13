# Echo360 and Bitfocus Companion: research report

Prepared 13 Oct 2026. This was read-only research: nothing was pushed. Copies of the open-source code I read are in `/home/user/research/echo360-sources/`.

**How sure each claim is.** Each claim carries one of these tags:
- **[Official]**: an Echo360 document. I could only read these through search-engine extracts, because the sandbox proxy blocks `support.echo360.com`, `echo360.org(.au)`, `aca.im` and `web.archive.org`.
- **[Code]**: I read it in working source code from someone who drove real devices.
- **[Community]**: a forum post or university guide.
- **[Unverified]**: my own inference.

Nothing here has been tested on real Echo360 hardware.

---

## TL;DR

1. **No Companion module for Echo360 exists.** The 604 bundled modules don't include one, there is no `bitfocus/companion-module-echo360*` repo, and GitHub has no Echo360 Companion manifest. (`etc-echo` is ETC lighting, not Echo360.) We'd be first.
2. **Hardware capture devices** (Echo360 Pro, Pod, legacy SafeCapture HD (SCHD) and the older EchoSystem appliances) expose the **Echo360 Capture API**. It is a small REST API on the device:
   - Requests are `application/x-www-form-urlencoded` POSTs and GETs.
   - Responses are XML.
   - Authentication is HTTP **Basic** with the device's local login.
   - It has every call we need: `/status/monitoring`, `/status/captures`, `/status/system`, and `/capture/new_capture|pause|record|stop|extend`.
   - Four independent open-source drivers agree on the endpoints and payloads (Crestron C#, Python, Ruby, Crystal), plus a PHP monitor. **This is the route to build on.** Confidence: high for the API shape; medium for which port and TLS setup a 2026 Pro or Pod uses.
3. **Universal Capture (the software)** has no documented local control API for the Personal edition.
   - It does have **global-ish keyboard shortcuts**: Cmd+6 pause/resume, Cmd+8 stop/finish, Cmd+1 extend, Cmd+4 open. There is **no start shortcut.**
   - Echo360 says the Capture API also covers "Universal Capture: Classroom" installations, but I found no port or details for that, so it must be probed on the real machine.
4. **The Echo360 cloud Public API** (OAuth2 client credentials) has **no documented "start or stop a live capture now" call**. It is for schedules, media, users and reporting, and needs admin-issued, institution-wide credentials. It is not suitable for a lecturer's button. I found no rate-limit documentation.
5. **Collarts is very likely a Universal Capture site, at least partly.** Echo360's own case study says Collarts records every session and spent a 2018 grant on "five new microphones for use with Universal Capture and cameras" for the auditorium. Will needs to find out room by room whether a Pro or Pod (or a UC: Classroom PC or Mac) is in the room. That decides which half of the module design applies.

---

## 1. Existing Companion modules

| Where I looked | Result |
|---|---|
| `bitfocus/companion-bundled-modules` (shallow clone, HEAD 1 Oct 2026, 604 modules) | None. Nearest are `epiphan-pearl` (relevant, see §2.4), `extron-smp351` and `etc-echo` (lighting) |
| `git ls-remote` on `bitfocus/companion-module-echo360`, `-echo360-capture`, `-echovideo`, `-echo360-pro` | None exist (a control repo, `epiphan-pearl`, answers) |
| GitHub repo search "companion-module echo360" | 0 results |
| GitHub code search `echo360 filename:manifest.json path:companion` | 0 results |
| Web search (Bitfocus, Reddit, forums) | Nothing. One article suggests Vicreo Listener hotkeys as a general workaround |

**Conclusion [Code/Community]: there is nothing to analyse or fork.**

---

## 2. Echo360 control options

### 2.1 Product landscape (what Collarts might have)

| Product | What it is | Control path |
|---|---|---|
| **Echo360 Pro** | Current rack appliance | Capture API [Official] |
| **Echo360 Pod** | Current small appliance | Capture API. The Pod FAQ says it "supports the Capture Device API and third-party integration with AMX or Crestron" [Official, via search extract] |
| **SafeCapture HD (SCHD)** | Legacy appliance, pre-2018 | Capture API v3.0.x. This is what most open-source drivers were written against [Code] |
| **EchoSystem capture appliance (EC-series)** | Older still | Capture API v3.0 [Official PDF title] |
| **Universal Capture: Personal** (Mac/Win app) | Lecturer's own laptop or desktop | Keyboard shortcuts and the menu bar only. No API found |
| **Universal Capture: Classroom** | UC installed on a room PC or Mac, scheduled by EchoVideo | Echo360 says the Capture API is used to talk to "a Universal Capture installation", but port and auth are unconfirmed [Official, partial] |
| **Epiphan Pearl publishing to EchoVideo** | Third-party hardware | Pearl's own REST API. Epiphan's release notes say it can pause, resume and start ad hoc EchoVideo events from Crestron or QSC. A **Companion module already exists** (`epiphan-pearl`) |

### 2.2 The Capture API (device-local REST)

**Documentation.**
- The official PDF is the "EchoSystem Device Capture API Version 3.0.1 Reference Guide" (mirror: https://aca.im/driver_docs/Echo360/EchoSystemCaptureAPI_v301.pdf) and v3.0 (https://echocloud.atlassian.net/wiki/download/attachments/590184591/EchoSystemCaptureAPI_v30.pdf).
- Echo360 says the current version is **3.0.2** (https://support.echo360.com/hc/en-us/articles/360042045412-EchoVideo-Capture-API and https://support.echo360.com/hc/en-us/articles/360038693311-EchoVideo-API-and-SDK-Documentation).
- I could not download any of these PDFs (proxy). Everything below comes from search extracts plus the drivers in §3, which quote the PDF section numbers (3.1.x, 3.3.x).

**Transport and authentication.**
- **Base URI**: Echo360's examples use `https://<device-ip>:8443/...` with `curl --user admin:password --insecure`. That means a **self-signed certificate** [Official].
  - The PHP monitor (kerbeh) uses **`http://<ip>:8080/...`** [Code].
  - tonyallan's README says some devices only do plain `http` [Code].
  - The Crestron thread for SCHD used 8443, and says the port is changeable in the device web UI [Community].
  - Echo360's firewall article lists 443 and 80 inbound for the device web UI [Official].
  - **The module needs a configurable scheme and port**, defaulting to `https` and 8443, with 8080/http as the fallback.
- **Authentication**: HTTP Basic (`Authorization: Basic base64(user:pass)`) [Code, all drivers].
  - In EchoVideo, the credentials are the institution's **Device Defaults → "Local Admin Login" / "Local Generic User Login"**. They are pre-filled as `admin` / `instructor` with password `password`, and admins can change them (https://support.echo360.com/hc/en-us/articles/360035404651-EchoVideo-Common-Settings-Device-Defaults) [Official, via extract].
  - Per the API guide: "All of the calls listed in the Status API Calls and Capture API Calls sections … can be performed by any user with login access"; **diagnostics calls are admin-only** [Official, via extract].
  - **So the instructor (generic user) login is enough**, and the module should never ask for the admin login.
  - On EchoSystem (ESS) the device could also check a user's credentials against the server and cache them (`/diagnostics/clear_cache` docstring) [Code]. Whether EchoVideo-era devices still do that is unknown.
- **Responses**: `text/xml`. Commands return `<ok text="…"/>` or `<error text="…"/>`. Examples [Code, tonyallan docstrings quoting the PDF]:
  - `<ok text="Capture scheduled for start" />` (new_capture)
  - `<ok text="Extend by 300 seconds recieved" />` (sic)
  - `<ok text="Command (pause) submitted" />`, `<ok text="Command (record) submitted" />`, `<ok text="Command (stop) submitted" />`
  - `<error text="Failed on command (stop).  No capture is running." />`
  - HTTP 401 for bad or insufficient credentials.

**Status calls (GET)** [Code: tonyallan, Navitas, PlaceOS/ACA, kerbeh]

| Path | PDF § | Use | Key fields |
|---|---|---|---|
| `/status/system` | 3.1.1 | Connection test, device info, profile list | `wall-clock-time`, `utc-offset`, `serial-number`, `system-version`, `up-since`, `last-sync`, `content/state`, `api-versions/api-version`, `capture-profiles/capture-profile` (list), `monitor-profiles`, `max-capture-duration-minutes`, `max-live-capture-extend-duration-minutes`, `location`, `host-address` |
| `/status/captures` | 3.1.2 | Current and next capture together | `current/…` and `next/…`: `schedule/type`, `schedule/start-time`, `schedule/duration`, `schedule/parameters/title`, `…/section`, `…/presenters/presenter`, `…/capture-profile/name`, `state`, `start-time`, `duration` |
| `/status/current_capture` | 3.1.4 | Current only. Also has `sources/source` with `class` (vga/audio/video), `signal-present`, `thumbnail`, and audio `channels/channel/{position,average,peak}` | as above |
| `/status/next_capture` | 3.1.3 | Next scheduled | as above |
| `/status/monitoring` | 3.1.5 | Real-time, light. **Best poll target** | `state`, `start-time` (GMT), `duration` (s), `original-duration`, `output-type`, `confidence-monitoring` |
| `/monitoring/<thumbnail-file>.jpg` | 3.1.6 | Confidence JPEG of an input, e.g. `vga_display_graphics-channel1-stream0.jpg` | the image |

**State values seen in real code**: `inactive`, `waiting` (pre-roll, about 10 s after new_capture in tonyallan's log), `active` (recording), `paused`, `complete` (for about 20 s after stop, then back to `inactive`) [Code: tonyallan README log, Navitas `GetRemaining`]. Echo360's own extract also mentions "pending" [Official].

When there is no current or next capture, the `<current>` or `<next>` element is present but empty (ACA and PlaceOS special-case this) [Code].

**Capture control calls (POST, form-encoded)** [Code: tonyallan docstrings quote PDF §3.3]

| Path | PDF § | Body | Behaviour |
|---|---|---|---|
| `/capture/new_capture` | 3.3.1 | `duration=<seconds>&capture_profile_name=<exact profile name>&description=<title>`. "All parameters must be defined" | Creates **and starts** an ad hoc capture. Goes to `waiting`, then `active` |
| `/capture/confidence_monitor` | 3.3.2 | same | Dummy capture, never archived. Handy for safe testing |
| `/capture/extend` | 3.3.3 | `duration=<seconds>&extend=Submit+Query` | Extends the current capture. **Can't pass the next scheduled capture's start**; it extends as far as allowed instead |
| `/capture/pause` | 3.3.4 | empty | Only works while recording |
| `/capture/record` | 3.3.5 | empty | **Two meanings**: resumes a *paused* capture, **or** starts a *waiting/pre-roll scheduled* capture early |
| `/capture/stop` | 3.3.6 | empty | Stops. "captures are processed and uploaded immediately upon stopping" |
| `/diagnostics/…` | 3.2 | — | Admin only (reboot, restart_all, ping, recovery uploads). **The module should not expose these** |

Points the drivers expose that matter for our design:
- **There is no separate "resume" endpoint.** Resume is `/capture/record`, so a careless Resume key could start a waiting scheduled capture early. Our Resume action must only send `record` when the polled state is `paused`.
- **PlaceOS and ACA's `extend()` POSTs to `/capture/confidence_monitor`.** That is a copy-paste bug. Navitas and tonyallan both use `/capture/extend`. Don't copy the PlaceOS/ACA version.
- Navitas sends `profileName` default `"Audio and Video"` and tonyallan `"Standard Lecture"`. **Profile names are site-specific strings.** Read them from `/status/system` → `capture-profiles` and offer them as a dropdown.
- Navitas computes remaining time as `duration − (deviceClock − start-time)`, using the device's `wall-clock-time` rather than the controller's clock. That implies **pause does not stop the end-time clock** [Code, inferred by Navitas; Unverified by me]. Test it on real hardware.
- **Limits.** `/status/system` reports `max-capture-duration-minutes` and `max-live-capture-extend-duration-minutes`. For UC, university guides say a pause longer than **20 minutes auto-completes** the recording [Community]. Appliance pause limits are unknown.
- **Old TLS.** A 2015 Crestron thread reported that a TCP-client approach "could lock up the unit". The vendor was unsure about external control without an SSL certificate [Community, dated]. Use plain HTTPS requests with no keep-alive, and poll gently (Navitas used a 3 s timeout, keep-alive off, and one request at a time).

### 2.3 Universal Capture (software)

- **No local control API found** for UC: Personal. No AppleScript dictionary, URL scheme or local port is documented. Echo360's admin pages mention a debug web console (Ctrl+Shift+L) only [Official, via extract].
- **Keyboard shortcuts** (official "Control a Universal Capture Recording", https://support.echo360.com/hc/en-us/articles/11077390582157):

  | Shortcut | Action |
  |---|---|
  | **Cmd+6** (Win Ctrl+6) | Pause/Resume (toggle) |
  | **Cmd+8** (Win Ctrl+8) | Finish (stop) and upload |
  | **Cmd+1** (Win Ctrl+1) | Extend (live and UC: Classroom recordings only) |
  | **Cmd+4** (Win Ctrl+4) | Open UC |

  Use the top-row number keys, not the numpad. **There is no shortcut to start a recording**: the lecturer clicks Record and UC minimises after a countdown. Older Personal Capture used Alt+F5/F6 instead [Community: Melbourne, UNLV, Wayne State, Warwick guides].
- **Can Companion send these?** Companion on the same Mac could fire the keystrokes with an `osascript -e 'tell application "System Events" to keystroke "6" using command down'` shell action. That needs macOS Accessibility permission for Companion. Vicreo Listener is the other route.
  - **But toggle shortcuts give no feedback.** We can't know whether UC is recording, so we can't show "REC 00:42:10". At best we'd show a local stopwatch, which drifts from the truth. [Unverified]
  - UC also shows its state in the menu-bar icon, and we could perhaps read that through Accessibility APIs. That's fragile, and I'd advise against it.
- **UC: Classroom.** Echo360 says the Capture API serves "Universal Capture: Classroom installations", and the "UC: Device" web interface exists for Pro, Pod *and* UC: Classroom. The port and auth are in an article I couldn't reach ("Device Communication in EchoVideo Environment"). If Collarts rooms run UC: Classroom on a Mac, there's a decent chance the same Capture API answers on that Mac. **Will should probe it (§5).** [Official, partial; Unverified for Mac]

### 2.4 Epiphan Pearl (in case Collarts rooms use it)

EchoVideo integrates Pearl-2, Pearl Mini and Nexus. Pearl's REST API can pause, resume and start ad hoc EchoVideo events (https://epiphan.com/userguides/pearl-mini/Content/startHere/releaseNotes/whatsNew-details.htm). Companion already ships `epiphan-pearl`. If a room has a Pearl, use that module, not a new one. [Official/Code]

### 2.5 The EchoVideo cloud Public API

- **What it is**:
  - OAuth2 `client_credentials`. An institution admin creates the client ID and secret in EchoVideo, and the secret is shown once (https://support.echo360.com/hc/en-us/articles/360035034252).
  - Access and refresh tokens.
  - Swagger docs per region. Australia is **https://echo360.net.au/api-documentation** (Collarts is probably on the AU/APAC region).
  - The base path is `/public/api/v1/…`, e.g. `/public/api/v1/reporting/reports` [Official, via extract].
- **Start/stop now?** I found **no documented endpoint to start, pause or stop a live capture in a room.**
  - The cloud side covers schedules (also CSV imports), sections, media, users and reporting. An Epiphan article mentions a "Scheduling API".
  - Ad hoc device captures from the cloud are a **UI feature**: Create → "New Device Capture", pick the room and duration. That runs until the duration ends or the next scheduled capture starts (https://support.echo360.com/hc/en-us/articles/11077054661645).
  - In theory you could create a schedule starting "now" through the API, but that's unverified and slow (devices sync schedules periodically). It still couldn't pause.
- **Rate limits**: nothing found. The Swagger article warns the UI is not built for heavy configuration changes.
- **Verdict**: not suitable. It needs institution-wide admin credentials (far too much power to put on a lecturer's Mac), has no pause, and is slow. At most it's a *read-only* source for "next scheduled capture" if IT ever issues a limited client. [Medium confidence: I could not read the Swagger itself, because echo360 domains are blocked from this sandbox.]

---

## 3. Open-source clients (the best evidence)

| Source | Lang / platform | What it shows | Notes |
|---|---|---|---|
| **tonyallan/echo360** `capture_device.py` (2014) https://github.com/tonyallan/echo360 | Python 2 CLI, plus a Raspberry Pi LCD controller | Every status, capture and diagnostics call, with curl examples and `<ok>`/`<error>` bodies **copied from the PDF**, section numbers 3.1.1–3.3.6. Real state-transition log. Default user `admin` | Best single reference. Written against SCHD, Capture API 3.0, system-version 5.4. Its Pi "a = start/extend, b = pause/resume, c = stop" is essentially our D200X design |
| **rdriscoll/navitas** `Echo360.cs` (3 Series and 4 Series) https://github.com/rdriscoll/navitas | Crestron SIMPL# | Polls `/status/monitoring` every 2 s, `/status/current_capture` and `/status/system` less often. Basic auth over HTTP. Pause toggles to `record` when paused. Extend uses `duration=…&extend=Submit+Query`. Ad hoc call with the profile default "Audio and Video". Remaining-time maths from the device clock. States `active/waiting/paused/complete/inactive` | Production Crestron code used in classrooms. Note: it URL-escapes the *whole* body string, which would also encode the `&` and `=`. If that worked, the device parser is lenient, but it may be a latent bug. We should encode only the values |
| **PlaceOS/drivers** `drivers/echo360/device_capture.cr` https://github.com/PlaceOS/drivers/blob/master/drivers/echo360/device_capture.cr | Crystal | Same endpoints. Polls system and captures every 15 s. Basic auth. XML parsed to JSON. The default profile is the first `capture-profiles` entry | `extend` bug (posts to confidence_monitor). Cites the v3.0.1 PDF |
| **acaprojects/ruby-engine-drivers** `modules/echo360/device_capture.rb` | Ruby (ACAEngine) | Same as PlaceOS (its ancestor) | Same extend bug |
| **kerbeh/echo360-monitor** (archived) https://github.com/kerbeh/echo360-monitor | PHP | `GET http://<ip>:8080/status/current_capture` with Basic auth. Parses `current/state`, `sources/source` (vga `signal-present` and `thumbnail`; audio `channels/channel/average\|peak`), `schedule/start-time`, `duration`, `parameters/title\|section`. Fetches `:8080/monitoring/<thumbnail>`. Says credentials come from Echo's "Device Defaults" | Proves **port 8080 plain HTTP** worked on the SCHD/EchoSystem generation, and that audio levels are available for a meter |

None of these target Pro/Pod firmware explicitly. Echo360 says the same Capture API (3.0.2) covers Pro and Pod, so expect the same paths, but **verify on the device**.

---

## 4. Proposed module design (`echo360-capture`, plain JS, @companion-module/base ~1.14, uad-console style)

### Layout (copy uad-console)
```
echo360-capture/
  companion/manifest.json, HELP.md
  src/main.js          InstanceBase: config, status, wiring
  src/echo-client.js   HTTP + Basic auth, tiny XML reader, poller, state model (no Companion imports)
  src/controls.js      actions, feedbacks, variables, presets
  test/echo.test.mjs   node:test against a fake device (node:http/https server serving canned XML)
```
- Use no npm dependencies beyond base. Use Node's `https.request` with a **module-scoped `https.Agent({ rejectUnauthorized: false, keepAlive: false })`**. Never set the process-wide TLS environment flag.
- An optional "certificate fingerprint" field can pin a SHA-256 on first use. This is a nice touch, not required.
- If Node 22's OpenSSL refuses an old SCHD's TLS, set `minVersion: 'TLSv1'` and `ciphers: 'DEFAULT:@SECLEVEL=0'` on that agent, or use http:8080.
- XML is tiny and flat, so a ~40-line tag/attribute extractor is enough. Make it tolerant of empty `<current/>`.

### Config
| Field | Type | Default |
|---|---|---|
| Device type | dropdown: Echo360 Pro/Pod/SCHD (Capture API) · UC: Classroom (Capture API) | Pro/Pod |
| Host / IP | textinput (regex IP or hostname) | |
| Protocol | dropdown https/http | https |
| Port | number | 8443 (8080 suggested when http) |
| Username | textinput | `instructor` (with a note: use the generic user, not admin) |
| Password | `secret-text` | |
| Poll interval | number, ms, 1000–10000 | 2000 (Navitas uses 2 s for monitoring) |
| Default capture profile | dropdown, filled from `/status/system` | first profile |
| Default ad hoc duration | number, minutes | 60 |
| Default title | textinput (Companion variables allowed) | `Ad hoc $(internal:date_d)…` |
| Show room name | textinput, local label | |

### Polling
- **Every poll interval:** `GET /status/monitoring` gives the state, start time and duration.
- **About every 10 s:** `GET /status/captures` gives the title, section, presenter and next capture.
- **About every 60 s, and on connect:** `GET /status/system` gives the device clock offset, profiles, max extend, version and serial.
- Allow one request in flight at a time, with a 3 s timeout.
- **Status mapping:**
  - 401 → `BadConfig` ("wrong username or password").
  - Timeout or refused → `ConnectionFailure`.
  - XML parse error → `UnknownWarning`.
- Back off to 10 s while disconnected.
- Keep the device-to-Mac clock offset from `wall-clock-time` so the elapsed timer ticks locally each second between polls, without drifting.

### Actions
| Action | Request | Guard |
|---|---|---|
| **Start ad hoc capture** (title, duration min, profile) | `POST /capture/new_capture` | Only if state is `inactive` or `complete`. Otherwise log "already recording" and do nothing. Use `confidence_monitor` instead when "test mode" is ticked |
| **Start scheduled capture now** | `POST /capture/record` | Only if state is `waiting` |
| **Pause** | `POST /capture/pause` | Only if `active` |
| **Resume** | `POST /capture/record` | **Only if `paused`** (otherwise it would start a waiting scheduled capture) |
| **Pause/Resume toggle** | either of the above | Based on the last polled state; refuse if the state is stale (> 2× poll) |
| **Stop** | `POST /capture/stop` | Only if `active` or `paused` |
| **Extend** (+5, +15, custom minutes) | `POST /capture/extend` `duration=<s>&extend=Submit+Query` | Only if `active` or `paused`. Show the device's `<ok>` text. Remember that it may be clipped by the next schedule |
| **Refresh now** | immediate poll | — |

**Safety rules**
- **Never auto-retry** start, stop, pause, record or extend. Each press sends exactly one request. On timeout or error, show it and let the poll reveal the truth.
- Debounce each control action: ignore repeats within 1.5 s.
- Every action **re-polls immediately** after the response.
- Stop is only offered in presets as a **2-second hold**. Use the base 1.14 duration group `steps: [{ down: [], up: [], 2000: { options: { runWhileHeld: true }, actions: [stop] } }]`.
- Start is a single press, but guarded by state (double presses can't create two captures).
- **No diagnostics actions** (reboot etc.).
- **Privacy**: titles, sections and presenters are personal or course info. Log state changes, not titles, at info level.

### Feedbacks (boolean, with sensible default styles)
- `recording` (state `active`): red.
- `paused`: amber, plus an optional flash using Companion's `$(internal:time_s)`-style blink, or a separate `blink` variable we toggle each second.
- `starting` (`waiting`): amber/red outline.
- `idle` (`inactive` or `complete`): grey.
- `error`: last command returned `<error>`, or the device is in an error state. Purple or magenta, held for 10 s.
- `connected` / `disconnected`: the disconnected style is dark with a "NO LINK" label.
- `remaining_below` (option: minutes): flash when there's less than N minutes left.
- `next_capture_within` (option: minutes): optional.

### Variables
| Variable | Meaning |
|---|---|
| `state` | raw: `inactive/waiting/active/paused/complete` |
| `state_label` | `REC` / `PAUSED` / `STARTING` / `IDLE` / `DONE` / `OFFLINE` |
| `elapsed` | `HH:MM:SS` since start-time (wall-clock, includes pauses; **verify**) |
| `remaining` | `HH:MM:SS` until start + duration |
| `duration_min`, `end_time` | planned length and local end time |
| `title`, `section`, `presenter` | from `/status/captures` current |
| `profile` | current capture profile |
| `next_title`, `next_start`, `next_in` | next scheduled capture |
| `device_name`, `serial`, `version`, `api_version`, `location` | from `/status/system` |
| `last_message` | last `<ok>`/`<error>` text |
| `audio_peak_l/r` (optional, phase 2) | from `/status/current_capture`, for a meter |

### D200X presets (the D200X is 5×3 keys, so these fit one row plus spares)
1. **Big REC key**:
   - Text `$(echo360:state_label)\n$(echo360:elapsed)`. A single press starts an ad hoc capture with the defaults.
   - Feedbacks: red when recording, amber flash when paused, grey when idle, dark "NO LINK" when disconnected.
   - When already recording, a press does nothing (guarded), so lecturers can't double-start.
2. **Pause/Resume**: toggle, amber when paused, showing `PAUSED $(echo360:elapsed)`.
3. **STOP (hold 2 s)**:
   - Label "HOLD\nSTOP", and an "up" with no action.
   - Feedback goes red only when stop is possible.
   - Preview style dims it when idle.
4. **+5 min**, 5. **+15 min**: show `$(echo360:remaining)` left.
6. **Status/next** text key: `NEXT $(echo360:next_in)`.

On the D200X's small LCD, use `size: 'auto'` and two-line text. The D200X reaches Companion through our existing plugin in `ulanzi-d200x/`, so these presets are just ordinary Companion buttons. Nothing D200X-specific is needed in the module.

### UC: Personal fallback (separate, optional, and clearly labelled)
- If a room only has UC: Personal on the lecturer's Mac, the module can't give truthful status.
- The honest option is a tiny "keystroke" preset set using Companion's built-in *System → Run shell* action with `osascript`. Cmd+6 is labelled "UC Pause/Resume" and Cmd+8, held 2 s, is "UC Finish". Label them **"no status feedback"**.
- I'd keep that out of the module itself, or behind a feature flag, so lecturers never see a fake REC timer. [Recommendation]

### Tests (node:test, fake device)
- **The fake server** serves `/status/*` XML that changes with an internal state machine. It is checked with Basic auth, and returns `<error>` for invalid transitions, exactly as the docstrings show.
- **Test cases:**
  - 401 maps to BadConfig.
  - Start sends exactly one `new_capture` with the correct form body (values URL-encoded, `&` and `=` not encoded).
  - Resume when `waiting` sends **nothing**.
  - Stop timeout is **not retried**.
  - Extend body includes `extend=Submit+Query`.
  - Elapsed and remaining use the device clock offset.
  - Empty `<current/>` gives idle.
  - The poller recovers after the server restarts.
  - The XML reader handles attributes and nested lists (`capture-profiles`).

---

## 5. What needs testing on real hardware, and how Will can find out what Collarts has

### Finding the device model and firmware
1. **Ask Collarts AV/IT first** (and get their blessing, because these are institution credentials). Things to ask:
   - Which rooms have an Echo360 **Pro / Pod / SCHD** versus **UC: Classroom** versus lecturer laptops with **UC: Personal**.
   - The device IP and VLAN.
   - Whether the Companion Mac can reach that VLAN on 8443/8080.
   - The **"Local Generic User Login"** from EchoVideo → Settings → Device Defaults.
2. **In EchoVideo** (if Will has admin or room-manager rights): Settings → Rooms → the room shows the device type, serial/MAC and firmware, plus a **"Log in to Device"** link to the legacy device web UI. That link's URL reveals the IP, scheme and port.
3. **In the room**:
   - A Pro is a 1RU rack unit labelled Echo360. A Pod is a small box.
   - An SCHD is a 1RU "SafeCapture HD" with a front status light.
   - UC: Classroom shows as the Universal Capture app on the lectern PC or Mac, launching on a schedule.
   - Some rooms also have a **Delcom capture-control light**, which is a USB light/button for pause/extend.
4. **From a Mac on the right network** (read-only, harmless):
   ```sh
   curl -sk -u 'instructor:PASSWORD' https://DEVICE:8443/status/system      # try http://DEVICE:8080 if this fails
   curl -sk -u 'instructor:PASSWORD' https://DEVICE:8443/status/monitoring
   curl -sk -u 'instructor:PASSWORD' https://DEVICE:8443/status/captures
   ```
   `system-version`, `api-version`, `serial-number` and `capture-profiles` answer the model and firmware question, and give us real XML for the fake-server fixtures. **Please save these outputs** and send them, with titles redacted.
5. **For UC: Classroom on a Mac**, run on that Mac while UC is running: `lsof -nP -iTCP -sTCP:LISTEN | grep -i -E 'echo|universal|capture'`. Then try the same curl against `https://127.0.0.1:<port>/status/system`.

### Test plan on the real device (in a free room, using `confidence_monitor` first)
1. **Auth:** does the *instructor* login work for status and capture calls? Is admin required anywhere we need it?
2. **TLS:** does Node 22 connect to its certificate and TLS version? Is http:8080 enabled?
3. **States:** record the exact `state` strings through start → waiting → active → pause → paused → resume → stop → complete → inactive. Note how long `waiting` and `complete` last.
4. **Elapsed and remaining with pause:** does pausing push the end time back, or does `duration` stay wall-clock? Does `start-time` change after resume?
5. **Extend:** cap per press, total cap (`max-live-capture-extend-duration-minutes`), and behaviour near the next scheduled capture (clipped, or `<error>`).
6. **Pause limit** on the appliance: does a long pause auto-stop, as UC's 20-minute limit does?
7. **Ad hoc captures** (title/description): where do they land in EchoVideo, and which section or owner? Ad hoc device captures may go to a default location and need someone to publish them. Check with IT that lecturers' ad hoc recordings end up somewhere sensible.
8. **Conflicts:** press Start when a scheduled capture is in `waiting`. Does `new_capture` error, or override? (Our guard should send nothing, but confirm the device's own behaviour.)
9. **Stop:** confirm stop uploads immediately and can't be undone. That's why it's a 2 s hold.
10. **Polling load:** poll at 2 s for an hour during a test capture and confirm the device web UI and recording are unaffected (given the old Crestron "lock-up" anecdote).
11. **Network loss:** pull the Mac's network mid-recording. The recording must carry on, and Companion should show NO LINK and recover.
12. **Audio levels** (optional): check whether `/status/current_capture` reports channel peak/average on this firmware, before building a meter.

---

## Confidence summary

| Claim | Confidence |
|---|---|
| No Echo360 Companion module exists | High |
| Capture API paths, methods, form bodies and XML replies | High (4 independent drivers plus PDF quotes) |
| Works the same on current Pro/Pod firmware (API 3.0.2) | Medium (Echo360 says so, but no code targeting Pro/Pod was found) |
| Default port 8443 https (vs 8080 http) on Collarts' devices | Medium-low: configurable, so probe |
| Instructor (non-admin) login can start, stop, pause, extend | Medium (API guide extract) |
| UC: Personal has no API, only Cmd+6 / Cmd+8 / Cmd+1 / Cmd+4 shortcuts and no start key | High for the shortcuts, medium for "no API" |
| UC: Classroom answers the Capture API on the room machine | Low: Echo360 hints yes, no details |
| Cloud Public API can't start or stop live captures; no rate limits published | Medium (couldn't open the Swagger) |
| Collarts uses Universal Capture (at least partly) | Medium (Echo360 case study, details from 2018) |

## Sources
- Echo360, EchoVideo: Capture API — https://support.echo360.com/hc/en-us/articles/360042045412-EchoVideo-Capture-API
- Echo360, API and SDK Documentation (Capture API 3.0.2 PDF; regional Swagger URLs) — https://support.echo360.com/hc/en-us/articles/360038693311-EchoVideo-API-and-SDK-Documentation
- EchoSystem Device Capture API v3.0.1 Reference Guide (mirror) — https://aca.im/driver_docs/Echo360/EchoSystemCaptureAPI_v301.pdf
- EchoSystem Capture API v3.0 PDF — https://echocloud.atlassian.net/wiki/download/attachments/590184591/EchoSystemCaptureAPI_v30.pdf
- Echo360, Common Settings – Device Defaults — https://support.echo360.com/hc/en-us/articles/360035404651-EchoVideo-Common-Settings-Device-Defaults
- Echo360, Pod FAQs — https://support.echo360.com/hc/en-us/articles/360035034912-EchoVideo-Pod-FAQs-and-How-To-s
- Echo360, Control a Universal Capture Recording (shortcuts) — https://support.echo360.com/hc/en-us/articles/11077390582157-EchoVideo-Control-a-Universal-Capture-Recording
- Echo360, Universal Capture Specifications / Overview — https://support.echo360.com/hc/en-us/articles/360035035332 , https://support.echo360.com/hc/en-us/articles/11077013986061
- Echo360, Creating a New Device Ad Hoc Capture — https://support.echo360.com/hc/en-us/articles/11077054661645-EchoVideo-Creating-a-New-Device-Ad-Hoc-Capture
- Echo360, Generating Client Credentials / Swagger token — https://support.echo360.com/hc/en-us/articles/360035034252 , https://support.echo360.com/hc/en-us/articles/360035034312
- Echo360, Reporting API (`/public/api/v1/…`) — https://support.echo360.com/hc/en-us/articles/360042030652-EchoVideo-Reporting-API
- Echo360, Port Configuration — https://support.echo360.com/hc/en-us/articles/360035405771-Port-Configuration-for-Live-Streaming
- Echo360 blog, Collarts / Jason Torrens — https://echo360.com/blog-collarts/
- Mixdown, Collarts recording every lecture — https://mixdownmag.com.au/collarts-isolate-innovate-part-1
- tonyallan/echo360 — https://github.com/tonyallan/echo360
- rdriscoll/navitas (Crestron) — https://github.com/rdriscoll/navitas
- PlaceOS/drivers echo360 — https://github.com/PlaceOS/drivers/blob/master/drivers/echo360/device_capture.cr
- acaprojects/ruby-engine-drivers echo360 — https://github.com/acaprojects/ruby-engine-drivers/blob/master/modules/echo360/device_capture.rb
- kerbeh/echo360-monitor — https://github.com/kerbeh/echo360-monitor
- Crestron groups.io, Echo360 SafeCapture HD — https://groups.io/g/crestron/topic/echo360_safecapture_hd/35785725
- University of Melbourne UC guide — https://lms.unimelb.edu.au/staff/guides/lecture-capture/recording-live-and-remote-lectures/universal-capture
- UNLV Echo360 shortcuts — https://utlv.screenstepslive.com/s/faculty/a/1293644-echo360-recording-keyboard-shortcuts
- Epiphan Pearl Mini release notes (EchoVideo control) — https://epiphan.com/userguides/pearl-mini/Content/startHere/releaseNotes/whatsNew-details.htm
- bitfocus/companion-bundled-modules — https://github.com/bitfocus/companion-bundled-modules
