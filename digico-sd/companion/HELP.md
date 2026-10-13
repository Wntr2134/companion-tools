## companion-module-digico

# DiGiCo SD / Quantum --- DiGiCo Module OSC Setup

To use this module, configure a **DiGiCo Pad** external-control
connection on a DiGiCo SD or Quantum console, using (as an example):

- **Console Send port:** `7000`
- **Console Receive port:** `7001`

> **Port direction is from the console's perspective:**\
> `7000` = console → Companion\
> `7001` = Companion → console

## 1. Open External Control

On the console Master screen, go to:

**System → External Control**

Set:

**Enable External Control → YES**

## 2. Add the Remote Device

Under **External Devices**:

1.  Press **Add Device**.
2.  Select **DiGiCo Pad**.
3.  Give the device a descriptive name, such as `Companion`.

> Use **DiGiCo Pad**, not **Other OSC**, when you want the DiGiCo
> remote-control command set.

## 3. Enter the Remote IP Address

Enter the **IP address of the computer that's running the DiGiCo Companion module.

This is the IP address of the computer, **not the console IP address**.

## 4. Configure the UDP Ports

Set the DiGiCo Pad device to:

Setting Value

---

**Send** `7000`
**Rcv** `7001`
**Enabled** Yes

The resulting network flow is:

```text
DiGiCo Console                      Companion Computer
      │                                    │
      │────── UDP → port 7000 ────────────>│
      │       OSC feedback/status          │
      │                                    │
      │<───── UDP → port 7001 ─────────────│
      │       OSC control commands         │
```

Therefore, configure the DiGiCo Companion module as follows:

```text
Receive/listen port: 7000

Send destination:
    IP address: <DiGiCo console IP>
    UDP port:   7001
```

## 5. Enable the Device

In the **Enabled** column for the new DiGiCo Pad device, enable the
device.

## 6. Load the Commands Allowed File

At the bottom of the **External Control** window, locate **Commands
Allowed**.

If the console reports that no commands are enabled:

1.  Press **Clear All** if an old or incorrect command set may already
    be loaded.
2.  Press **Load**.
3.  Select the command file appropriate for the console family.

### SD8 / SD9 / SD11 / SD12

For an SD8, SD9, SD11, SD12, or SD12-96, load:

```text
iPadv2sd8-9-11-12
```

### Quantum Consoles

For a Quantum console, select the corresponding **iPad v2 Quantum
command file** shown in the console's **Load** dialog.

For any Quantum console, load:

```text
ipad_q3
```

## 7. Verify Commands Are Enabled

After loading the command file, verify that **Commands Allowed** no
longer reports:

```text
No commands are enabled
```

The permitted command set should now be populated.

## 8. Note the Console IP Address

The External Control window displays the console's **Local IP Address**.

Use this as the destination IP address when the DiGiCo Companion Module sends commands to the console:

```text
Companion → DiGiCo Console

Destination IP:   <console Local IP Address>
Destination port: 7001
```

The console sends feedback to the Companion Computer configured in the DiGiCo Pad entry:

```text
DiGiCo Console → Companion Computer

Destination IP:   <Companion Computer IP address>
Destination port: 7000
```

## 9. Recommended Settings for OSC Development

In summary, here are the settings:

- **Enable External Control:** Yes
- **Device Type:** DiGiCo Pad
- **Send:** `7000`
- **Rcv:** `7001`
- **Device Enabled:** Yes
- **Bundles:** Off initially
- **Suppress OSC Retransmit:** On
- **Commands Allowed:** Correct iPad v2 file for the console

Keeping **Bundles** off

## SD12 / SD12-96 Quick Reference

```text
System
 └── External Control
      │
      ├── Enable External Control: YES
      │
      ├── Add Device
      │    └── DiGiCo Pad
      │
      ├── Name: Companion
      ├── IP Address: <Companion IP>
      ├── Send: 7000
      ├── Rcv:  7001
      ├── Enabled: YES
      ├── Bundles: OFF
      ├── Suppress OSC Retransmit: ON
      │
      └── Commands Allowed
           ├── Clear All
           └── Load
                └── iPadv2sd8-9-11-12
```

## Network Summary

```text
                 UDP 7000
       OSC feedback / console status
DiGiCo ───────────────────────────────> Companion
Console

DiGiCo <─────────────────────────────── Companion
Console
       OSC commands / control
                 UDP 7001
```


---

## Knob & D200X additions (companion-tools version)

This copy adds an encoder-friendly layer on top of the module above. Everything above still works.

**Fixes compared with v0.9.1:**
- **Port defaults** now match this guide: Companion listens on 7000 and sends to 7001.
- **Toggles and knob steps** use the value Companion just sent. They now work with *Suppress OSC Retransmit* on, and every click of a fast turn counts.
- **Relative changes** are clamped to the parameter's range.
- **A new cross-fade** on the same control stops the old one.
- **Connection status:**
  - it shows *Connecting* until the console actually replies
  - Companion asks the console for its name every 5 s
  - no reply for 15 s means *Disconnected*
  - when the console comes back, everything is re-read
- **Queries** wait 400 ms (it was 150 ms) and retry once.

**New actions** (named `[Knob]`, `[Strip]` and `[Selected]`):
- **[Knob] Fader step:** Input, Aux, Group, Matrix or Control Group. Step size runs from 1 to 10 dB per click: 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 10. Turning up from −∞ starts at −60 dB.
- **[Knob] Input → aux send step**
- **[Strip] Mute / Input solo:** Toggle, On or Off. For a momentary mute, use On on press and Off on release.
- **[Selected]:**
  - pick a channel and an aux with keys, or turn a knob to step through them
  - then the fader knob, send-to-aux knob and mute act on that channel

**New feedbacks:**
- Muted, Soloed, Selected
- Current snapshot is N
- Console connected

**New variables:**
- `snap_current_num`, `snap_current_name`, `snap_next_name`, `snap_prev_name`
- `sel_name`, `sel_label`, `sel_level`, `sel_mute`, `sel_aux_name`, `sel_send_level`
- `input_N_name` / `input_N_level`, and the same for `aux_`, `group_`, `matrix_` and `cg_`
- `connected`, `console_name`

**Presets:**
- **Snapshots (D200X):** ◀ prev, current (name), next ▶, undo
- **Selected channel strip:** knobs for fader (push = mute), send to aux, choose channel, choose aux
- **Inputs:** mute and select keys
- **Control Groups:** mute keys, and fader knobs (push = mute)

**Talkback and mute groups:** the console doesn't offer these over this protocol. Instead:
1. Build a console **macro** that does it.
2. Assign the macro to an **OSC macro button** in the Macro Editor.
3. Use the module's *Macros / Buttons / press* action on a key.

**Not yet tested on a real SD9.** Please report:
- whether the console echoes changes back to Companion
- whether faders and mutes moved on the desk show up in Companion
- whether macro numbers are off by one
