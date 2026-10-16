## UAD Console

Controls a Universal Audio Apollo through **UA Mixer Engine**, the background part of UAD Console, over its local TCP port 4710. This is the same connection Console's own window uses.

UA doesn't document this protocol. It was worked out from UA-Midi-Control and cuefinger, so a future UAD update could change it.

### Setup
- UAD Console must have been opened at least once since boot. Mixer Engine keeps running after you close the window.
- **Host:** `127.0.0.1` if Companion runs on the same Mac as the Apollo. Otherwise use that Mac's IP; Mixer Engine also accepts network connections.
- The module reads **whatever Apollos the Mac has** when it connects, and keeps the lists up to date by itself:
  - channel renamed in Console: updated straight away
  - Apollo connected or disconnected: everything re-read
  - channel count changed (e.g. ADAT channels at a higher sample rate): picked up within 20 s
  - **Advanced - Re-read channels** forces a re-read if you ever need it.
- Buttons store a device number + channel number. On a different Mac or interface, check each button's channel dropdown.

### Presets (easiest way to start)
Every channel gets its own preset category:
- **Mute (toggle)**: press on, press off.
- **Mute while held (momentary)**: muted only while the button is held.
- **Fader knob**: for a D200X TURN button. Rotate to change level; the button shows the name and dB, and turns red when muted.
- **Solo (toggle)**: inputs only.
- **Monitor**: level knob (push = mute) and Dim.

### Talkback
Presets → **Talkback**:
- **Talkback (hold to talk)**: press and hold to talk.
- **Talkback (press on / press off)**: latches.

The key turns orange while talkback is on. The module works out how your Console version switches talkback: a talkback switch on the device or monitor if there is one, otherwise un-muting the TALKBACK channel. The `talkback_method` variable shows which it picked. If TALK doesn't do the right thing, run `node tools/mac-kit/ua-probe.mjs --watch`, click TALK in Console, and send the output.

### Cue strip (selected channel)
A cuefinger-style headphone-mix page for the D200X. You pick a **channel** and a **cue/aux**, and the knobs work on that pair.
- **Presets → Cue strip (selected channel): channel buttons**: one key per channel in use. The key turns blue when that channel is selected.
- **Presets → Cue strip (selected channel)**:
  - **Select AUX/CUE** keys
  - **Knob: selected channel → selected cue level**
  - **Knob: selected channel fader**: shows a meter bar
  - **Knob: choose channel**: turn to step through channels
  - **Mute selected channel in selected cue**

Variables: `sel_name`, `sel_level`, `sel_send_name`, `sel_send_level`, `sel_send_mute`, `sel_meter`, `sel_meterbar`.

### Meters
Connection setting **Level meters**:
- **Off**
- **Selected channel only** (default)
- **Every channel in use**: adds `in_N_meter` and `in_N_meterbar` variables. It's more network traffic; button updates are capped at 10 per second.

### Actions
| Action | Notes |
|---|---|
| Channel - Mute / Solo | Toggle, On or Off. Momentary = On on press, Off on release. |
| Channel - Fader level: set / step | Step per knob click in dB: 0.5 to 5 in 0.5 dB steps (default 0.5 dB). Turning up from -inf starts at -60 dB. |
| Channel - Pan: set / step | -100 = left, 100 = right. |
| Send - Level: set / step, Send - Mute | Input → aux/cue send. |
| Preamp - 48V / Pad / Phase / Low cut | Toggle, On or Off. |
| Preamp - Gain: step | Moves Console's 0–1 gain control. |
| Monitor - Level: set / step, Mute, Dim | The Apollo's monitor output. |
| Advanced - Send raw command | Anything the protocol accepts, e.g. `set /devices/0/inputs/0/Mute/value/ true`. |

### Variables
`in_1_name`, `in_1_level`, `in_1_mute`, `in_1_solo`, `in_1_pan`. Auxes are `aux_N_…`, and the monitor is `mon_1_level`, `mon_1_mute` and `mon_1_dim`. A second device gets a `d1_` prefix.

### Step per knob click
- **Fader, send and monitor level:** pick the dB per click, 0.5 to 5 in 0.5 dB steps. Default 0.5 dB.
- **Pan and preamp gain:** Step size 1 to 10 (1 = tiny, 2 = default, 10 = big).

Buttons made before 0.3.0 are converted automatically: the old 1–10 size becomes the nearest dB choice (sizes above 5 dB become 5 dB).
