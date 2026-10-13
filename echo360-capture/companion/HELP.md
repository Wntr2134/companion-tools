## Echo360 Capture

Start, pause, resume, extend and stop Echo360 lecture captures from Companion (for example from a Ulanzi D200X on the lectern).

The module has two separate modes. Pick one under **Device type**:

| Device type | For | Status on the buttons |
|---|---|---|
| **Echo360 Pro / Pod / SafeCapture HD** | A capture appliance in the rack (e.g. the auditorium Pro) | Real state and timers, read from the device every 2 s |
| **Universal Capture: Classroom** | UC installed on a room computer, if it answers the Capture API (unconfirmed) | As above, if it works |
| **Universal Capture on this Mac** | The Universal Capture app on the Mac that runs Companion | **NO STATUS**: keyboard shortcuts only |

> **Untested on real hardware.** This was built from Echo360's Capture API guide and four open-source drivers that were used on real devices, and tested against a simulated device. Try it in a free room first, using **Test mode** on the start action (a confidence-monitor capture that is never kept).

---

### Capture appliance mode (Pro, Pod, SafeCapture HD)

#### What you need (ask AV/IT first)
These are institution credentials, so ask your AV or IT team before using them. You need:
- **The device's IP address or hostname**, and whether the Companion Mac can reach it (the device's network often sits on its own VLAN).
- **The "Local Generic User Login"**: in EchoVideo, **Settings → Device Defaults → Local Generic User Login**. It's usually `instructor`. Use this one, **not** the Local Admin Login: the generic user can do everything this module needs.
- If you have room-manager rights, **EchoVideo → Settings → Rooms** shows the device type, serial and firmware. Its **Log in to Device** link shows the device's address, protocol and port.

#### Settings
- **Protocol / Port**: most devices use **https on 8443** with a self-signed certificate (the module accepts that for this device only). Older units often use **http on 8080**.
- **Allow old TLS**: tick only if an older unit refuses to connect over https.
- **Check status every**: 2000 ms is a sensible default. The module never has more than one request in flight, and backs off to every 10 s while it can't reach the device.
- **Default capture profile**: the list fills in once the module has connected (profile names are set by each institution).
- **Default ad hoc length** and **Default ad hoc title**: used by the REC key. The title can use variables, e.g. `$(internal:date_d)`.

#### Check the connection from Terminal first (read-only, harmless)
```sh
curl -sk -u 'instructor:PASSWORD' https://DEVICE:8443/status/system      # try http://DEVICE:8080 if this fails
curl -sk -u 'instructor:PASSWORD' https://DEVICE:8443/status/monitoring
curl -sk -u 'instructor:PASSWORD' https://DEVICE:8443/status/captures
```
If these return XML, the module will work with the same settings. `system-version`, `api-version` and `capture-profiles` tell you the firmware and profile names. Please save the output (with titles removed) so the module can be checked against real replies.

#### Presets (category "Lecture capture", sized for the D200X)
- **REC**: shows `IDLE`/`REC`/`PAUSED` and the elapsed time. Press to start an ad hoc capture with the defaults. It only sends the start command when nothing is capturing, so a double press can't make two recordings.
- **Pause / resume**: amber while paused.
- **HOLD STOP**: you must **hold it for 2 seconds**. A short press does nothing. Stopping uploads straight away and can't be undone.
- **+5 MIN / +15 MIN**: extend the capture, showing the time left. Flashes when under 5 minutes are left. The device won't extend past the start of the next scheduled capture; it extends as far as it can instead.
- **NEXT**: time until the next scheduled capture.
- **START NOW**: starts a scheduled capture early, only while it's waiting to start.
- **Last device message**: the device's last reply, or why the module sent nothing.

#### Safety rules built in
- Each press sends **at most one** command. Nothing is ever retried: if the device doesn't answer, the button shows an error and the next status check shows what really happened.
- Repeat presses of the same button within 1.5 s are ignored.
- **Resume only sends when paused.** (The device uses the same command to start a waiting scheduled capture early, so a careless Resume could start the next lecture.)
- Pause/resume refuses to act if the last status reading is out of date.
- There are no reboot or diagnostics actions.
- Titles, sections and presenters are shown in variables but never written to the log.

#### Variables
`state`, `state_label` (REC, PAUSED, STARTING, IDLE, DONE, OFFLINE), `elapsed`, `remaining`, `duration_min`, `end_time`, `title`, `section`, `presenter`, `profile`, `next_title`, `next_start`, `next_in`, `device_name`, `serial`, `version`, `api_version`, `location`, `room`, `last_message`.

Elapsed and remaining use the device's own clock, so they don't drift if the Mac's clock is off. They tick every second between status checks. Whether pausing pushes back the end time hasn't been confirmed on a real device yet.

---

### Universal Capture on this Mac (keyboard shortcuts, no status)

Universal Capture (the app) has **no control API**. In this mode the module presses Universal Capture's own shortcuts on the Mac running Companion:

| Button | Shortcut |
|---|---|
| Pause / resume | Cmd+6 |
| Finish and upload (**hold 2 s**) | Cmd+8 |
| Extend (live and UC: Classroom recordings only) | Cmd+1 |
| Open Universal Capture | Cmd+4 |

Know these limits:
- **There is no start shortcut.** The lecturer clicks **Record** in Universal Capture. The app minimises after its countdown.
- **The shortcuts are toggles with no feedback**, so the module can't know whether Universal Capture is recording or paused. Buttons in this mode say **NO STATUS** and never show a timer.
- **Companion needs Accessibility permission** to send keystrokes: **System Settings → Privacy & Security → Accessibility → Companion** (turn it on, then restart Companion). Without it, the keys turn magenta and the message mentions Accessibility.
- **Bring Universal Capture to the front** (on by default) activates the app before each shortcut. Change **Universal Capture app name** if the app is named differently on your Mac.
- This mode only works when Companion runs on a Mac. On Windows or Linux it logs a warning and does nothing.
- Universal Capture auto-finishes a recording that has been paused for more than about 20 minutes (according to university guides).

Presets are in the category **Universal Capture (no status)**: PAUSE/RESUME, HOLD FINISH, EXTEND and OPEN UC.

If you'd rather not use the module for this, Companion's built-in **System → Run shell** action can do the same thing:
```sh
osascript -e 'tell application "System Events" to keystroke "6" using command down'   # pause/resume
osascript -e 'tell application "System Events" to keystroke "8" using command down'   # finish (put it on a 2 s hold)
```
These have no status either.

---

Not affiliated with Echo360. Echo360 is a trademark of its owner, used here only to describe compatibility.
