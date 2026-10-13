# How it actually works (teaching notes)

This is the "what's happening under the hood" companion to `SETUP-GUIDE.md`. It's written so it can double as a handout for a live-production networking unit: each section is a real problem we hit and how we worked it out.

## 1. USB HID: how the D200X talks to the Mac

- **USB devices describe themselves.** On connect, a device sends descriptors: vendor ID / product ID (the D200X is `2207:0019`) and one or more **interfaces**.
- **HID (Human Interface Device)** is the USB class for keyboards, mice and, here, a control surface. The D200X has two HID interfaces:
  - **Interface 0:** Ulanzi's own protocol (button images, presses, knob turns).
  - **Interface 1:** a normal keyboard, used for hotkeys in Ulanzi Studio.
- **The protocol.** Data moves in 1024-byte **reports**. Every message starts with `7C 7C`, then a 2-byte command and a 4-byte length.
  - A key press arrives as command `0x0101`, with the key index and press/release.
  - Button images go to the device as a ZIP file containing PNGs, split across many reports.
- **What we hit on the Mac:**
  - **Nothing on the bus at all.** macOS blocks new USB accessories until you approve them. We checked with `ioreg`: no device ID = not a software problem.
  - **Only one app can own the interface.** Ulanzi Studio and Companion fight over it.
  - **The device sleeps.** With no traffic for about a minute, it decides nobody is connected and sleeps. Fix: a keep-alive message every 5 s.
- **Try it:** `tools/mac-kit/d200x-probe.mjs` opens the device and prints every press. That's the raw protocol, no Companion involved.

## 2. HTTP control: the Panasonic PTZ camera

- **Each command is a web request.** For example:
  - `http://CAMERA/cgi-bin/aw_ptz?cmd=%23RPC85008000&res=1`
    - `%23` is `#`, URL-encoded.
    - `RPC` = relative pan/tilt move.
    - `8500` = pan, `8000` = tilt, where `8000` means "don't move".
- **Absolute vs relative.**
  - `#AXZ` sets zoom to an exact position.
  - `#RPC` moves *by* an amount.
  - `#Z` + speed means "start moving until told to stop". That's why the stock zoom action ran to the end on a knob: a knob click has no "release" to send the stop.
- **Rate limits.** The camera ignores commands that arrive less than about 130 ms apart. A fast knob spin sends faster than that, so the module **queues** commands and **merges** clicks: five quick clicks become one move of five steps.
- **Retries can be dangerous.** The original module's HTTP library retried failed requests automatically. A retried *relative* move happens twice. Lesson: only retry things that are safe to repeat (that property is called "idempotent").

## 3. TCP with a message protocol: UAD Console

- **UA Mixer Engine listens on TCP port 4710.** UAD Console's window is just a client of it, so we can be another client.
- **TCP is a stream, not messages.** Data can arrive split or joined in any way, so the protocol marks the end of each message with a NUL byte (`\0`). The module collects bytes until it sees one. Our tests deliberately split every message in half to prove this works.
- **Request / reply / subscribe.**
  - `get /devices/0/inputs/3` → JSON reply.
  - `set …/Mute/value/ true` changes a value.
  - `subscribe …/Mute` makes the engine push every future change. That's how a key goes red when someone mutes in Console itself.
- **Echoes.** When we turn a fader fast, the engine echoes each value back slightly late. If we trusted the echo, the fader would jump backwards. So for 400 ms after our own change, we ignore echoes for that value.
- **Reverse engineering.** UA doesn't document any of this. Others worked it out with **Wireshark**, watching the traffic between Console and the engine on `localhost`. `tools/mac-kit/ua-probe.mjs --watch` is our version: click something in Console and see exactly which value changes.

## 4. Things that apply everywhere

- **Discover, don't hard-code.** The UAD module asks the engine what hardware exists, so it works on any Apollo setup, and it rescans when things change.
- **Test without the hardware.** Each module has a *fake* device (a fake camera, a fake mixer engine) so the logic can be tested anywhere. GitHub runs these tests on every change.
- **One step at a time when debugging.**
  - Is the device on the bus? (`ioreg`)
  - Can a tiny script talk to it? (the probes)
  - Does the full app work? (Companion)
  
  Each layer rules out the one below it.
