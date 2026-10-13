# UAD Console (UA Mixer Engine) control protocol: notes

Sources: [raduvarga/UA-Midi-Control](https://github.com/raduvarga/UA-Midi-Control), [franqulator/cuefinger](https://github.com/franqulator/cuefinger). Unofficial and reverse-engineered: Universal Audio doesn't document it, so it could change.

- Plain TCP to **port 4710** on the Mac running UA Mixer Engine (it starts with UAD Console and keeps running after Console quits). Cuefinger also connects from other machines on the LAN.
- Every message, in both directions, ends with a **NUL byte** (`\0`).
- Commands: `get <path>`, `set <path> <value>`, `subscribe <path>`, `unsubscribe <path>`.
- Replies are JSON: `{"path": "...", "data": {"properties": {...}, "children": {...}}}`.
- Keep-alive: Console sends `set /Sleep false` about every 3 s.

## Useful paths

| What | Path |
|---|---|
| Devices | `/devices` → `children` = device ids |
| Inputs / auxes / outputs | `/devices/{d}/inputs`, `/devices/{d}/auxs`, `/devices/{d}/outputs` |
| Channel name | property `Name` (`value` = custom, `default` = factory) |
| Mute | `set /devices/{d}/inputs/{i}/Mute/value/ true` |
| Solo | `.../Solo/value/ true` |
| Fader (dB) | `.../FaderLevel/value/ -6.0` |
| Fader (0–1) | `.../FaderLevelTapered/value/ 0.75` |
| Pan | `.../Pan/value/ -1..1` (stereo: `Pan2`) |
| Send level | `.../sends/{s}/Gain/value/ <dB>` (or `GainTapered` 0–1) |
| Send mute | `.../sends/{s}/Bypass/value/ true` |
| Preamp | `.../preamps/0/{48V,Pad,Phase,LowCut}/value true`, `GainTapered` 0–1 |
| Monitor level | `/devices/{d}/outputs/{o}/CRMonitorLevel/value/ <dB>` |
| Dim | `/devices/{d}/outputs/{o}/DimOn/value/ true` |

Run `tools/mac-kit/ua-probe.mjs` to list what your Console version actually exposes.
