# ⚠️ DEPRECATED MODULE

**This module is deprecated and is no longer maintained.**

Please switch to the **`panasonic-cameras`** module, which replaces this one and
receives all new features, camera support and bug fixes.

**How to migrate**

1. In Companion, add a new connection and search for **Panasonic Cameras** (`panasonic-cameras`).
2. Configure it with the same camera IP address.
3. Rebuild your buttons using the actions/feedbacks of the new module.
4. Remove this (`panasonic-ptz`) connection.

Bug reports and feature requests for this module will not be handled — please raise them on the
[panasonic-cameras module](https://github.com/bitfocus/companion-module-panasonic-cameras/) instead.

---

Panasonic PTZ Cameras

## This module supports the following Panasonic PTZ cameras.

**AW-HE2, AW-HE50, AW-HE60, AW-HE120, AW-HE130, AW-HR140, AW-UE4, AW-SFU01, AK-UB300, <br/>AW-HE40 series, AW-HE42 series, AW-UE70 series, AW-UE150 series**

**HE40 series**

- AW-HE35, AW-HE38, AW-HE40, AW-HE48, AW-HE58, AW-HE65, AW-HE70
- AW-HN38, AW-HN40, AW-HN65, AW-HN70
- AW HEF5

**HE42 series**

- AW-HE42, AW-HE68, AW-HE75

**UE70 series**

- AW-UE63, AW-UE65, AW-UE70
- AW-UN70

**UE150 series**

- AW-UE100, AW-UE150, AW-UE155
- AW-UN145

**Disclaimer, not all models supports all actions, variables and feedbacks. But it should be auto sorted so that you can only use actions, feedbacks, variables and presets that works with your model**

## When using more than on PTZ

**When Configuring** more than one instance, please make sure you have **"AUTO TCP"** enabled or change the **TCP** port accordingly, this is a port used in companion, and you will not find a setting for it on the cameras. The TCP port **NEEDS** to be unique for each PTZ instance you add. It's strongly recomended to leave **"Auto TCP"** turned on.

## Actions

The actions are separated into the following categories.
It's recommended to use the presets as much as possible as there is a lot of actions.

**Pan/Tilt**

- Up, Down, Left, Right, UpLeft, UpRight, DownLeft, DownRight
- Set Pan/Tilt Speed
- Set Pan and Tilt speeds independently
- Pan/Tilt Speed Up
- Pan Speed Up
- Tilt Speed Up
- Pan/Tilt Speed Down
- Pan Speed Down
- Tilt Speed Down
- Pan/Tilt Home
- Adjust pan/tilt velocity on speed change

**Lens**

- Zoom In
- Zoom Out
- Set Zoom Speed
- Zoom Speed Up
- Zoom Speed Down
- Adjust zoom quickness on speed change
- Focus Far, Focus Near
- Set Focus Speed
- Focus Speed Up
- Focus Speed Down
- Adjust focus quickness on speed change
- Focus Mode (Auto/Manual)
- One Touch Auto Focus (OTAF)

**Exposure**

- Set Iris
- Iris Open
- Iris Close
- Iris Mode (Auto/Manual)
- Set Gain
- Gain Up
- Gain Down
- Set Shutter
- Shutter Up
- Shutter Down
- Set Pedestal
- Pedestal Up
- Pedestal Down
- Set ND Filter
- ND Filter Up
- ND Filter Down

**System**

- Power Off
- Power On
- Installation position Desktop and Hanging
- Tally Off
- Tally On
- SD Card Recording Start/Stop

**Save presets**

- Save Preset 1-100

**Recall Presets**

- Recall Preset 1-100
- Set Preset Playback Speed
- Set Preset Playback Time (AW-UE150)
- Set Preset Playback Mode (AW-UE150)

## Variables

A list of all the available Variables in this module sorted into the following categories. For their correct naming, refer to the list under "Edit" "Instance".

**System**

- PTZ Series
- PTZ Model
- PTZ Name
- Firmware Version
- PTZ Error Codes
- Power ON/OFF
- Install Position
- Tally State

**Lens**

- Auto Focus Mode
- Pan/Tilt, Zoom and Focus Speed

**Exposure**

- Auto Iris Mode

## Feedbacks

A list of all the available Feedbacks in this module sorted into the following categories.

**System**

- Power ON/OFF
- Tally State
- Install Position

**Lens**

- Auto Focus Mode

**Exposure**

- Auto Iris Mode

Current support is based on "HD/4K Integrated Camera Interface Specifications" version 1.12 from Apr. 27, 2020.

For additional actions, please raise a feature request on [GitHub](https://github.com/bitfocus/companion-module-panasonic-ptz/).

## Knob (encoder) control: Will's additions

These are for rotary controls like the Ulanzi D200X knobs or a Stream Deck +. Each knob click moves the camera **one fixed step**. Turning fast adds up the clicks instead of losing them or running the lens to the end.

**Quick start:** drag a preset from the **Knobs** category (Pan, Tilt, Zoom, Focus) onto a knob's button. Rotary actions are already on, and the button shows the live position.

| Action | What it does |
|---|---|
| Knob - Pan/Tilt step | Relative move (`#RPC`), the same size both ways. |
| Knob - Zoom step | Moves to an exact zoom position (`#AXZ`). "Camera web step" method = `directctrl?zoom=±1`. |
| Knob - Focus step | Moves to an exact focus position (`#AXF`). Can switch the camera to manual focus first. |
| Lens - Go to zoom/focus position (%) | 0% = wide / near, 100% = tele / far. |
| Position - Refresh … variables | Reads the current positions now. |

**Step size: 1 to 10** (default 2) on every knob action. 1 gives tiny steps that feel smooth when you keep turning; 10 gives big jumps.

| Size | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Pan/tilt (camera units) | 256 | 640 | 1024 | 1280 | 1920 | 2560 | 3584 | 5120 | 7168 | 10240 |
| Zoom/focus (% of range) | 0.4 | 1 | 1.5 | 2 | 3 | 4 | 6 | 8 | 12 | 16 |

Buttons made with the earlier free-number step are converted to the nearest size automatically.

**Variables:** `zoomPosition`, `focusPosition` (%), `zoomPositionRaw`, `focusPositionRaw`, `panPosition`, `tiltPosition`.

**Settings:**
- **Minimum gap between commands**, default 130 ms (Panasonic's minimum). Raise it if fast spins still drop steps.
- **Position read interval**, default 3 s; 0 = off.

**Other fixes in this version:**
- Ticking "adjust on speed change" no longer throws an error.
- Commands are queued and spaced, time out after 2 s, and are never automatically retried. A retry could make a relative move happen twice.
- Camera error replies (`er1`/`er2`/`er3`) are logged.
- Camera events split or joined across TCP packets are handled.

## Preset buttons: press to recall, hold 5 s to save

Presets → **Save/Recall button** → *Preset N: press = recall, hold 5 s = save*.
- **Short press:** recall preset N. The button turns green while it's the last preset recalled from Companion.
- **Hold 5 seconds:** save the camera's current position as preset N. It saves while you're still holding, the button flashes **SAVED**, and letting go doesn't also recall.
- **Hold again** any time to overwrite it.

## Selected camera: one set of knobs for several cameras

1. **Variables** page → add a **custom variable** called `ptz_cam` with value `1`.
2. On each Panasonic connection, set **Camera number** (1, 2, 3…) in its settings.
3. Make camera select keys. Action: **internal → Custom variable: Set value**, `ptz_cam` = 1 (or 2, 3…). For the highlight, add the Panasonic feedback **Camera - This camera is the selected one** from that camera's connection.
4. For each knob, drag **Presets → Knobs (selected camera)** from camera 1's connection. Then, in the button, add the same knob actions from camera 2's connection (and camera 3's…), with **Only when this camera is selected** ticked.

Turning a knob then only moves the selected camera.

## Preset by number (for linking)
**Preset - Recall by number (variables allowed)** accepts a number or a variable, plus an optional offset.

Example: `$(digico-osc:snap_current_num)` recalls the camera preset that matches the console's current snapshot. Put it in a trigger on that variable. See `docs/show-cues.md` in the repo.
