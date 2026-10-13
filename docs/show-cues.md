# Show cues: one press moves the desk, cameras and lights together

Companion can chain everything in this repo. Three recipes, simplest first. They use the module labels `digico-osc`, `panasonic-ptz` and so on. If your connection has a different label, use that label instead.

## 1. A GO key (no setup on the console)

One D200X key fires the next DiGiCo snapshot, and the cameras follow.

1. Make a key called `GO`.
2. Under **Press**, add:
   - **digico-osc: Snapshots / Fire Next Snapshot**
3. That's it for the desk. The cameras follow in recipe 2.

Add lighting to the same key if you like, e.g. an MA2/MA3/MagicQ "Go" action. Everything on one key runs in order, top to bottom.

## 2. Cameras follow the console's snapshot, however it was fired

This uses a **trigger**, so it works whether the snapshot was fired from the D200X, from the desk, or by MIDI or timecode.

1. Plan the numbering: camera preset N = the shot for snapshot N. If you need room, use an offset: snapshot 1 → preset 11, and so on.
2. **Triggers → + Add trigger**:
   - **Event:** *Variable changed* → `$(digico-osc:snap_current_num)`
   - **Action:** *panasonic-ptz: Preset - Recall by number (variables allowed)*
     - Preset number: `$(digico-osc:snap_current_num)`
     - Add (offset): `0`, or e.g. `10`
3. For several cameras, add the same action once per camera connection, each with its own offset if their presets are numbered differently.

When the snapshot changes, the trigger fires straight away. If a snapshot has no matching preset, the camera replies with an error. The module logs it and nothing moves.

## 3. The desk drives Companion (DiGiCo V1926 or later)

Console macros can send OSC. So a macro, or a snapshot that runs one, can press Companion keys, switch the D200X page, or set a variable.

1. **In Companion:** **Settings → Protocols → OSC**. Turn the OSC listener on and note the port (default **12321**).
2. **On the SD9:**
   1. Go to **External Control** and add an **OSC (Macro OSC)** device pointing at the Mac's IP, port 12321.
   2. Make a macro whose action sends OSC to that device, for example:
      - `/location/2/0/0/press`: press page 2, row 0, column 0
      - `/custom-variable/scene/value` with a string argument `Chorus`: set a Companion custom variable
   3. Attach the macro to a snapshot (snapshot macro), a key, or a GPI.
3. In Companion, a trigger on `$(custom:scene)` can then do anything: change the D200X page, recall camera shots, start an Echo360 recording.

> Exact console menu names differ between DiGiCo software versions. Check them on your desk; the Companion side is as above.

## Things to test on the night before trusting them
- Does snapshot fire → camera move happen fast enough? The trigger is near-instant, but cameras take their own travel time.
- With **Suppress OSC Retransmit** on, does `snap_current_num` still update when the snapshot is fired *on the desk*? If not, use recipe 1 (GO key) for now, and tell me.
- If you fire snapshots quickly in a row, cameras get one recall per change. Panasonic queues them 130 ms apart.
