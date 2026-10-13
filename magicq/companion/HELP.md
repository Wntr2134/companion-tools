**Chamsys MagicQ**

Go to [Chamsys](https://secure.chamsys.co.uk/magicq) to get more information about the diffrent consoles

We currently support the following actions, feedbacks and variables:

## Actions

| Action                       | What it does                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Set the playback fader level | Sets the playback fader level by the given value 0 - 100 %                                                 |
| Adjust Playback level        | Adjusts the playback fader level by the given value 0 - 100 %                                              |
| Go on Playback               | Advance the cue list on the playback given, as you would by pressing the go button on the console Playback |
| Flash playback               | Turn on, turn off, or toggle the flash button                                                              |
| Pause Playback               | Pauses the running cue / cuelist on the given playback                                                     |
| Release Playback             | Releases the cue / cuelist on the given playback                                                           |
| Playback jump to cue         | Jumps to the given cue on the given playback                                                               |
| Desk Black Out               | Turn on, turn off, or toggle DBO                                                                           |
| Set Swap Mode                | Sets the swap mode to add or swap                                                                          |
| Execute                      | Control or toggle Execute buttons / faders                                                                 |
| Adjust Execute level         | Adjusts the execute fader level by the given value 0 - 100 %                                               |
| 10 Scene                     | Control 10Scene buttons / faders                                                                           |
| RPC Command                  | Send a RPC command to the console                                                                          |

## Feedbacks

| Feedback       | What it does                                                       |
| -------------- | ------------------------------------------------------------------ |
| Playback Level | Set feedback based on the playback fader level (0 - 100%)          |
| Playback Flash | Set feedback based on the playback flash button (on/off)           |
| Execute Level  | Set feedback based on the execute fader or button level (0 - 100%) |

## Variables

- Playback Level
- Playback Flash
- Execute Level

## Knob & D200X additions (companion-tools version 3.3.0)

This copy adds an encoder-friendly layer on top of the module above. Everything above still works.

**Fixes compared with v3.2.1:**

- **Config screen:** 3.2.1 forgot to import `Regex`, so opening the connection's settings threw an error. Fixed.
- **Connection status** no longer stays green forever:
  - it shows _Connecting_ until MagicQ actually sends something
  - while MagicQ is quiet, Companion asks for feedback again (`/feedback/pb+exec`) every 10 s, which also gets feedback going again after MagicQ restarts
  - nothing from MagicQ for the **No reply timeout** (default 30 s, 0 = never) means _Disconnected_
  - when MagicQ comes back it goes green again and feedback is requested straight away
- **Bad packets** can't break anything: a level that isn't a number is ignored, levels are kept to 0-100 %, and a packet that isn't valid OSC is logged instead of turning the status red.
- **Sockets and timers** are closed on shutdown and when you change the settings, and a late message on an old socket is ignored.
- **Set / Adjust playback level** use the same echo guard as the knob steps (see below).

**Knob steps:** one click = one step, however fast you turn. Companion keeps its own target level while the knob is turning, and ignores MagicQ's report of that playback for 0.4 s after each click so a late report can't drag the fader back. Step size 1-10 means:

| Step size   | 1   | 2 (default) | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  |
| ----------- | --- | ----------- | --- | --- | --- | --- | --- | --- | --- | --- |
| % per click | 1   | 2           | 3   | 4   | 5   | 6   | 8   | 10  | 15  | 20  |

**New actions** (named `[Knob]`, `[Selected]` and `[Console]`):

- **[Knob] Playback fader step:** any playback number. MagicQ only reports playbacks 1-10 back; above 10 Companion works from the level it last sent.
- **[Selected] Select playback** and **Next / previous playback (knob)** (wraps round, 1-10 by default).
- **[Selected] Playback fader step, Go, Pause, Release, Flash:** act on the selected playback. Flash has On, Off and Toggle; for a momentary flash use On on press and Off on release (the preset does this).
- **[Console] DBO toggle** and **Add / Swap toggle:** MagicQ doesn't report these back, so Companion remembers what it last sent.

**New feedbacks** (plain on/off):

- Playback fader above a level (0 = fader up at all), Playback at full, Playback flash on
- This playback is selected, Selected playback above a level, Selected playback flash on
- DBO on, Swap mode (both as last sent from Companion)
- Console connected

MagicQ's OSC feedback has no "playback active" flag, no cue numbers and no cue names, so keys can't show those.

**New variables:**

- `pb_1_level` … `pb_10_level` (whole %)
- `sel_pb`, `sel_level`, `sel_flash`
- `connection`: connected, waiting, disconnected or send only

**Presets:**

- **D200X knobs:** selected playback fader (push = Go), choose playback, playback 1 fader (push = Go)
- **Selected playback keys:** Go, Pause, Release, Flash (held)
- **Choose playback 1-10:** each key shows that playback's level, goes green when its fader is up and blue when selected
- **Console:** DBO, Swap, connection status

**Setting up MagicQ:**

1. MagicQ only takes OSC in **Unlocked Mode**. On a PC or Mac that means ChamSys hardware connected (for Will: the **Compact Connect** plugged in and recognised). In plain demo mode OSC remote control doesn't work, and a MagicDMX interface doesn't unlock it.
2. In MagicQ go to **Setup → View Settings → Network**:
   - set **OSC mode** (OSC transmit and receive)
   - **OSC RX port** = this connection's _Target Port_ (default 8000)
   - **OSC TX port** = this connection's _Feedback Port_ (default 9000); a port of 0 turns that direction off
   - **OSC TX IP** = the IP of the computer running Companion
   - if your MagicQ version has a setting to allow remote control, turn it on
3. In Companion set _Target IP_ to the MagicQ computer and tick _Enable Feedback_.
4. Only playbacks 1-10 and execute pages 1-10 work through MagicQ's built-in OSC addresses.
5. The ChamSys docs say CREP (UDP remote control) isn't available while MagicQ is in network-session mode. Whether OSC is affected the same way wasn't confirmed; if nothing gets through, try it outside a network session.

**Not yet tested on Will's setup** (MagicQ PC with a Compact Connect, Companion 5.1 on macOS, D200X). Please check and report:

- whether the status goes green, and whether it ever shows _Disconnected_ while MagicQ is just sitting idle (if so, set the No reply timeout to 0 and tell us)
- whether faders moved on MagicQ show up on the D200X, and whether knob turns feel right
- whether MagicQ sends a level back after Companion sets one
- whether Flash on press / off on release behaves as a momentary flash
