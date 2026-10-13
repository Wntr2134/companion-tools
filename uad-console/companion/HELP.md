## UAD Console

Controls a Universal Audio Apollo through **UA Mixer Engine**, the background part of UAD Console, over its local TCP port 4710. This is the same connection Console's own window uses.

UA doesn't document this protocol. It was worked out from UA-Midi-Control and cuefinger, so a future UAD update could change it.

### Setup
- UAD Console must have been opened at least once since boot. Mixer Engine keeps running after you close the window.
- **Host:** `127.0.0.1` if Companion runs on the same Mac as the Apollo. Otherwise use that Mac's IP; Mixer Engine also accepts network connections.
- Channel names are read when the module connects. Use **Advanced - Re-read channels** after renaming channels in Console.

### Presets (easiest way to start)
Every channel gets its own preset category:
- **Mute (toggle)**: press on, press off.
- **Mute while held (momentary)**: muted only while the button is held.
- **Fader knob**: for a D200X TURN button. Rotate to change level; the button shows the name and dB, and turns red when muted.
- **Solo (toggle)**: inputs only.
- **Monitor**: level knob (push = mute) and Dim.

### Actions
| Action | Notes |
|---|---|
| Channel - Mute / Solo | Toggle, On or Off. Momentary = On on press, Off on release. |
| Channel - Fader level: set / step | Step size 1–10 per knob click (1 = 0.25 dB … 10 = 10 dB, default 2 = 0.5 dB). Turning up from -inf starts at -60 dB. |
| Channel - Pan: set / step | -100 = left, 100 = right. |
| Send - Level: set / step, Send - Mute | Input → aux/cue send. |
| Preamp - 48V / Pad / Phase / Low cut | Toggle, On or Off. |
| Preamp - Gain: step | Moves Console's 0–1 gain control. |
| Monitor - Level: set / step, Mute, Dim | The Apollo's monitor output. |
| Advanced - Send raw command | Anything the protocol accepts, e.g. `set /devices/0/inputs/0/Mute/value/ true`. |

### Variables
`in_1_name`, `in_1_level`, `in_1_mute`, `in_1_solo`, `in_1_pan`. Auxes are `aux_N_…`, and the monitor is `mon_1_level`, `mon_1_mute` and `mon_1_dim`. A second device gets a `d1_` prefix.

### Step sizes (dB per click)
| Size | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Fader / send / monitor | 0.25 | 0.5 | 1 | 1.5 | 2 | 3 | 4 | 6 | 8 | 10 |
