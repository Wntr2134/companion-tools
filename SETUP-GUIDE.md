# Setup guide: from a brand-new Mac to everything working

Follow the steps in order. Each step says what you should see when it worked. If something doesn't match, stop and check **Troubleshooting** at the bottom.

You will set up:
- **Part A:** Ulanzi D200X: all keys and knobs in Companion
- **Part B:** Panasonic PTZ (AW-HE40): knob pan/tilt/zoom/focus and hold-to-save presets
- **Part C:** UAD Console (Apollo): mutes, faders, monitor

- **Part D:** DiGiCo SD9: snapshots, mutes, faders and monitor sends on the D200X
- **Part E:** Show health page: green/red keys for every device, and alerts
- **Part H:** ChamSys MagicQ lighting: playback faders on the knobs
- **Part G:** Echo360 lecture recording: the auditorium Pro box, and Universal Capture rooms

You only need the parts for the gear you have. **Part 0 is always needed.**

---

## Quick install (no Terminal): for venue and classroom Macs

Use this when a Mac only needs to *run* the modules. Part 0 below is for a Mac where you also want automatic updates from GitHub.

1. Install **Companion** (step 0.5 below).
2. Open <https://github.com/Wntr2134/companion-tools/releases/tag/latest> and download the `.tgz` file for each module you need:
   - `ulanzi-stream-controller-….tgz`: D200X
   - `panasonic-ptz-….tgz`: PTZ cameras
   - `uad-console-….tgz`: Apollo / UAD Console
   - `digico-osc-….tgz`: DiGiCo SD
   - `show-health-….tgz`: show health page (Part E)
   - `echo360-capture-….tgz`: Echo360 recording (Part G)
   - `chamsys-magicq-osc-….tgz`: ChamSys MagicQ (Part H)
3. In Companion, go to **Modules** → **Import module package** and choose the file. Repeat for each one.
4. On each connection or surface integration, click the pencil ✏️ next to the version and pick the version you just imported.
5. Carry on from **Part A / B / C / D**, skipping the "dev version" steps.

To update later: download the new files from the same page and import them again.

---

## Part 0: One-time Mac setup (about 15 minutes)

You need an **admin account** for some of these steps. If you're on a standard account, the Mac asks for an admin name and password. That's normal.

### 0.1 Open Terminal
1. Press **⌘ + Space**, type **Terminal**, press **Enter**.
2. A window with a text prompt opens. All the `grey boxes` below get pasted into this window, followed by **Enter**.

### 0.2 Install Apple's developer tools (gives you `git`)
1. Paste:
   ```bash
   xcode-select --install
   ```
2. A pop-up appears. Click **Install** and wait for it to finish (5–10 min).
   - If it says *"command line tools are already installed"*, that's fine. Carry on.

### 0.3 Install Node.js 22
1. Go to <https://nodejs.org/en/download> in a browser.
2. Pick **version 22 (LTS)**, **macOS Installer (.pkg)**. Don't use 24 or 26: these modules are built for 22.
3. Open the downloaded `.pkg` and click through the installer.
4. **Check:** quit Terminal (⌘ + Q), open it again, and paste:
   ```bash
   node -v
   ```
   ✅ You should see `v22.something`.

### 0.4 Turn on Yarn (the installer the modules use)
1. Paste (it asks for your Mac password; typing shows nothing, which is normal):
   ```bash
   sudo corepack enable
   ```
2. **Check:**
   ```bash
   yarn -v
   ```
   ✅ You should see a version number. If it asks *"Do you want to continue? [Y/n]"*, type `y` and press Enter.

### 0.5 Install Companion
1. Go to <https://bitfocus.io/companion> and download **Companion for macOS** (version **4.3 or newer**; 5.x is fine).
2. Drag it into **Applications** and open it.
3. The Companion launcher window appears. Click **Launch GUI**: the Companion web page opens in your browser.

### 0.6 Download this repo
1. Paste:
   ```bash
   git clone https://github.com/Wntr2134/companion-tools ~/companion-tools
   ```
   - If it asks for a GitHub username and password, the repo is private. Sign in with your GitHub account (use a [personal access token](https://github.com/settings/tokens) as the password), or make the repo public.
2. **Check:**
   ```bash
   ls ~/companion-tools
   ```
   ✅ You should see `panasonic-ptz  SETUP-GUIDE.md  tools  uad-console  ulanzi-d200x  update.sh` (and a few more).

### 0.7 Install and build everything
1. Paste:
   ```bash
   bash ~/companion-tools/update.sh
   ```
2. Wait. It runs through three sections (`== ulanzi-d200x`, `== panasonic-ptz`, `== uad-console`).
   - Yellow `warning` lines are normal.
   - If it asks *"Do you want to continue? [Y/n]"*, type `y`.

   ✅ It should finish with `Done.`

### 0.8 Tell Companion where the modules are
1. In the Companion web page, click **Settings** (left menu), then the **Advanced** tab.
2. Find **Developer**.
3. Turn **Enable Developer Modules** **on**.
4. Next to **Developer modules path**, click **Select** and choose the **companion-tools** folder in your home folder.
   - Choose `companion-tools` itself, **not** a folder inside it.
5. Quit Companion completely: on the launcher, click **Quit**, or press ⌘ + Q on the launcher window. Then open it again and click **Launch GUI**.

✅ Part 0 done. You never need to repeat it on this Mac.

---

## Part A: Ulanzi D200X

### A.1 Get Ulanzi's own app out of the way
Ulanzi Studio fights Companion for the device. If it's installed:
1. Quit it, including its **menu-bar icon** at the top right of the screen (click the icon → Quit).
2. Open **System Settings → General → Login Items**. Remove **Ulanzi Studio** if it's listed.

### A.2 Let the Mac accept the device
1. Open **System Settings → Privacy & Security**.
2. Scroll down to **Allow accessories to connect** and set it to **Always**.
3. Plug the D200X **straight into the Mac** with **the cable that came with it**. Don't use a dock, monitor hub or random cable; many USB-C cables only carry power.
4. If the Mac asks *"Allow accessory to connect?"*, click **Allow**.

### A.3 Turn on the plugin in Companion
1. In Companion, click **Modules** (left menu), then the **Surfaces** section/tab.
2. Find **Ulanzi Stream Controller** and make sure it's **enabled**.
3. Click it. Next to **Module Version**, click the **pencil ✏️** and choose the **dev** version. Click **Save**.
   - This step matters. The store version (v1.0.2) has a bug that makes the D200X loop on and off with Companion 5.
4. Click **Surfaces** (left menu), then **Rescan USB**.

✅ The D200X appears in the Surfaces list, and its keys go blank or show Companion buttons.

### A.4 Load the labelled layout page (recommended)
1. In Companion, click **Import / Export** (left menu), then **Import**.
2. Choose `~/companion-tools/ulanzi-d200x/extras/D200X-layout.companionconfig`.
   - To find your home folder in the file picker: ⌘ + Shift + H.
3. When asked, import it into an **empty page**.

✅ That page shows a label on every key: KEY row 0 col 0 … KNOB 1 TURN, KNOB 1 PUSH, and so on.

How the D200X maps onto Companion's grid:

| Row | Col 0 | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|---|
| 0 | key | key | key | key | key |
| 1 | key | key | key | key | key |
| 2 | key | key | key | WIDE key | (none) |
| 3 | page ◀ (automatic) | **knob 1 TURN** | **knob 2 TURN** | **knob 3 TURN** | page ▶ (automatic) |
| 4 | | **knob 1 PUSH** | **knob 2 PUSH** | **knob 3 PUSH** | |

- **TURN buttons:** in the button editor, tick **Rotary actions**, then add actions under **Rotate left** and **Rotate right**.
- **PUSH buttons** are normal buttons (press / release).
- The two round buttons on the left of the base change page by themselves.

### A.5 Check settings for the D200X
1. **Surfaces** → click the D200X → open its settings.
2. **Small window mode (3_2 slot):** *Full-width button (no clock overlay)*.
3. **Enable idle blank screensaver:** **off**.

---

## Part B: Panasonic PTZ camera (AW-HE40)

### B.1 Add the camera
1. Companion → **Connections** → **+ Add connection**, search **Panasonic**, choose **Panasonic PTZ**, then **Add**.
2. If it shows a **version** choice, pick **dev**. You can also change it later with the pencil ✏️ next to the version.
3. Settings:
   - **Camera IP:** your camera's IP, e.g. `192.168.0.42`
   - **Model:** **AW-HE40**, or leave it on Auto
   - Leave everything else on its default.
4. Click **Save**.

✅ The connection turns **green**.

### B.2 Put pan / tilt / zoom / focus on the knobs
1. Go to **Buttons** and open the D200X page. On the right, click **Presets → Panasonic PTZ → Knobs**.
2. Drag **Pan knob** onto **row 3 col 1** (knob 1 TURN).
3. Drag **Tilt knob** onto **row 3 col 2**, and **Zoom knob** onto **row 3 col 3**.
4. Turn the knobs. Each click moves the camera one small step, and the button shows the live position.

**Changing how big each step is:**
1. Click the knob's button.
2. On each **Knob - … step** action, change **Step size**: **1** = tiny and smooth, **2** = default, **10** = huge.
3. Do it for both **Rotate left** and **Rotate right**.

### B.3 Preset buttons: press to recall, hold 5 s to save
1. **Presets → Panasonic PTZ → Save/Recall button**.
2. Drag **Preset 1: press = recall, hold 5 s = save** onto any key, e.g. row 0 col 0. Then Preset 2 onto the next key, and so on.
3. To use it:
   1. Move the camera where you want it.
   2. **Hold the key for 5 seconds.** It flashes **SAVED**. You can let go.
   3. Later, **tap the key** to go back there. It turns green as the last preset recalled.
   4. Hold it for 5 seconds again any time to overwrite it.

### B.4 One set of knobs for several cameras (optional)
If you have more than one camera: in Companion, **Connections** → click the Panasonic connection → **Help** (the ? icon), section **Selected camera**. In short:
1. Give each camera a **Camera number** in its connection settings.
2. Make a custom variable `ptz_cam`.
3. Make "Cam 1 / Cam 2" keys that set it.
4. Use the **Knobs (selected camera)** presets.

---

## Part C: UAD Console (Apollo)

### C.1 Make sure Console's engine is running
1. Open **UAD Console** once after starting the Mac. You can close its window afterwards: the engine keeps running in the background.
2. You don't need to change any settings in Console.

### C.2 Add the connection
1. Companion → **Connections** → **+ Add connection**, search **UAD**, choose **UAD Console**, then **Add**.
2. If it shows a version choice, pick **dev**.
3. Settings:
   - **Mac running UAD Console (IP):** `127.0.0.1` if Companion and the Apollo are on the same Mac. Otherwise use the Apollo Mac's IP.
   - **Port:** `4710`
4. Click **Save**.

✅ The connection turns **green**. Its log (click the connection, then **Logs**) says something like *Found 2 device(s), 52 channels*.

### C.3 Put channels on buttons
1. **Buttons** → **Presets → UAD Console**. There's one category per channel, named as in Console (e.g. *Apollo x4: In 1: ANALOG 1*).
2. For each channel you want, drag on:
   - **Mute (toggle)**: tap to mute, tap to unmute. The key goes red when muted.
   - **Mute while held (momentary)**: muted only while you hold the key.
   - **Fader knob**: put this on a D200X **TURN** button (row 3). Turning changes the level, and the key shows the dB.
   - **Solo (toggle)**
3. Under the **Monitor** category:
   - **Monitor level knob**: turn = volume, push = mute.
   - **Dim**

### C.4 Talkback, cue mixes and meters
- **Talkback:** **Presets → UAD Console → Talkback** → *Talkback (hold to talk)*. Hold the key to talk; it turns orange while talking.
  - If it doesn't switch talkback, run `node ~/companion-tools/tools/mac-kit/ua-probe.mjs --watch`, click **TALK** in Console, and send the output.
- **Cue mix page** (a performer's headphone mix on the D200X):
  1. Drag the **Cue strip (selected channel): channel buttons** onto the keys: one per instrument.
  2. Drag **Select CUE 1** (2, 3…) onto keys.
  3. Drag **Knob: selected channel → selected cue level** onto a TURN button, and optionally **Knob: selected channel fader**.
  4. To use it: tap an instrument key, tap the cue, turn the knob.
- **Meters:** in the connection's settings, **Level meters** = *Selected channel only* (default) or *Every channel in use*. The fader knob preset shows a bar like `████░░░░`.

The module keeps itself up to date on its own: renamed channels, Apollos plugged in or unplugged, sample-rate changes.

---

## Part D: DiGiCo SD9

### D.1 On the console
1. **Master screen → Setup → External Control.** Set **Enable External Control** to **Yes**.
2. **Add Device → DiGiCo Pad.**
   - **IP:** your Mac's IP address. On the Mac: System Settings → Network.
   - **Send:** `7000`
   - **Rcv:** `7001`
   - **Enabled:** ticked
3. Load the command set **`iPadv2sd8-9-11-12`**. Without it, the console ignores Companion.
4. Set **Suppress OSC Retransmit** to **On**. This version of the module works either way.
5. Only **one** DiGiCo Pad connection works at a time. If you also use the DiGiCo iPad app, see "iPad relay" in the module's help.

### D.2 In Companion
1. **Connections → + Add connection** → search **DiGiCo** → **digico-osc** → choose the **dev** version.
2. **Mixer IP:** the console's IP. Leave the ports on their defaults: Companion listens on 7000 and sends to 7001. Save.

✅ The status goes from *Connecting* to **OK** within a few seconds. If it stays on Connecting, the console isn't answering: check the IP, the ports, and that the command set is loaded.

### D.3 Put it on the D200X
**Buttons → Presets → digico-osc:**
- **Snapshots (D200X):** ◀ prev / current (shows the name) / next ▶ / undo
- **Selected channel strip:**
  - *fader knob* (push = mute) on knob 1
  - *send to aux knob* on knob 2
  - *choose channel knob* on knob 3
- **Inputs:** *select* keys pick the channel for the strip; *mute* keys mute directly.
- **Control Groups:** a mute key, plus a fader knob (push = mute).

Step size works like the other modules: **1** = tiny, **2** = default, **10** = big.

---

## Part E: Show health page

### E.1 Devices with their own Companion connection (console, cameras, UAD, D200X)
Companion already knows whether these are connected. For each one:
1. Make a key with the device's name as its text.
2. Add the feedback **internal → Connection: status**, pick the connection, and set the style to **red** for *Error/Disconnected*.
   - Add a second copy set to **green** for *OK*.

### E.2 Everything else (amps, Dante gear, switches, stage boxes)
1. **Connections → + Add connection** → **Show Health**.
2. In **Device list**, one line per device:
   ```
   FOH SD9, 192.168.1.100
   Stage rack, 192.168.1.101
   Amp rack, 192.168.1.50, 80
   ```
   - `Name, IP` checks with ping.
   - `Name, IP, port` checks that TCP port. Use this for gear that ignores ping; port 80 works for most devices with a web page.
3. Save. **Presets → Show Health**:
   - **Devices**: one key per device. Green = up, red = down, and the key shows how long it's been in that state.
   - **Summary**: **ALL OK**, or **2 DOWN** in red.

A device only turns red after two missed checks in a row, so one dropped ping doesn't flash it. Pressing any of these keys checks everything straight away.

### E.3 Alerts (optional)
To get told when something drops mid-show:
1. **Triggers → + Add trigger**.
2. Event: **Variable changed**. Variable: `$(show-health:down_count)`.
3. Condition: value is greater than 0.
4. Action: for example jump the D200X to the health page, flash a key, or send a message with a webhook module (Pushover, Slack, Discord).

---

## Part G: Echo360 lecture recording

### G.1 Auditorium (Echo360 Pro box)
1. **Ask Collarts AV/IT** for three things:
   - the Pro's **IP address**
   - whether the Companion Mac can reach it (port **8443**, or **8080**)
   - the **Local Generic User Login** (Echo360 → Settings → Device Defaults)

   Use the generic user, never the admin login.
2. **Optional check from Terminal** on that Mac. It only reads, so it can't change anything:
   ```bash
   curl -sk -u 'instructor:PASSWORD' https://DEVICE-IP:8443/status/monitoring
   ```
   - XML text back means it's reachable.
   - A connection error: try `http://DEVICE-IP:8080/status/monitoring` instead.
3. **Add the connection:** Companion → **Connections → + Add connection** → **Echo360 Capture**.
   - **Device type:** Echo360 Pro / Pod / SafeCapture HD
   - **Host:** the IP
   - **Protocol and port:** whichever worked in step 2
   - **Username and password:** the generic user
   - Save.

   ✅ It goes green, and the **Default capture profile** list fills in from the box.
4. **Presets → Echo360 Capture:**
   - **REC**: shows state + elapsed time. One press starts an ad hoc recording; pressing again while recording does nothing.
   - **PAUSE / RESUME**
   - **HOLD STOP**: you must hold it for 2 seconds, because stopping uploads straight away.
   - **+5 / +15 min**
   - **Next capture**: when the next scheduled recording starts.
5. **Test first** with the module's **test mode**. It makes a practice recording that is never uploaded. Do this in a free room before using it with a class.

### G.2 Every other room (Universal Capture on the lectern Mac)
Universal Capture has no control connection, so Companion sends its keyboard shortcuts instead. That means **the keys can't show whether it's recording**; they say *NO STATUS*.
1. **Add the connection:** **Connections → + Add connection** → **Echo360 Capture**. Set **Device type** to *Universal Capture on this Mac (keyboard shortcuts)*.
2. **Give Companion permission:** System Settings → **Privacy & Security → Accessibility** → turn on **Companion**. Without this, macOS blocks the keystrokes; the connection's log will say so.
3. **Presets → Universal Capture (no status):** PAUSE/RESUME, **HOLD FINISH** (2-second hold), EXTEND, OPEN UC.
4. The lecturer still clicks **Record** in Universal Capture to start. There's no start shortcut.

---

## Part H: ChamSys MagicQ (lighting)

### H.1 In MagicQ PC
1. Plug in the **Compact Connect** before you start MagicQ. Without ChamSys hardware, MagicQ PC is in demo mode, and remote control is switched off.
2. Go to **Setup → View Settings → Network**:
   - set **OSC mode** to send and receive
   - set **OSC transmit / receive ports**: note them, e.g. receive 8000, transmit 9000
   - set **OSC TX IP address** to the Companion Mac's IP, or `127.0.0.1` if it's the same Mac

   Menu names vary a little between MagicQ versions. Look for the OSC settings on the Network page.

### H.2 In Companion
1. **Connections → + Add connection** → **ChamSys MagicQ OSC**. If it shows a version choice, pick **3.3.0** (or **dev**).
2. Enter MagicQ's IP and the ports, matching H.1 *the other way round*: Companion sends to MagicQ's receive port and listens on MagicQ's transmit port. Turn **feedback** on. Save.

   ✅ It goes from *Connecting* to **OK** when MagicQ sends its first update. Move a playback fader on MagicQ to trigger one.

   If it keeps flipping to *Disconnected* while MagicQ sits idle, set **No reply timeout** to `0`.

### H.3 On the D200X
**Presets → ChamSys MagicQ OSC:**
- **Knobs:**
  - *selected playback fader* (push = Go)
  - *choose playback*
  - *playback 1 fader*
- **Keys:**
  - *select PB 1–10*: each shows its level
  - *Go*, *Pause*, *Release*
  - *Flash*: only while held
  - *DBO*, *Swap*
  - a connection status key

Step size works like the other modules: **1** = tiny, **2** = default, **10** = big.

---

## Getting updates

Whenever something new has been merged to GitHub, run:
```bash
bash ~/companion-tools/update.sh
```
Companion normally picks up the change by itself. If a module still behaves the old way, quit and reopen Companion.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node -v` says something other than 22 | Install Node **22** from nodejs.org (step 0.3), then reopen Terminal. |
| `yarn` error *"engine node is incompatible"* | Run `bash ~/companion-tools/update.sh` again. If it still fails, send the error. |
| A module isn't in the Add Connection list | Check step 0.8: the path must be the `companion-tools` folder. Restart Companion. |
| D200X never appears in Surfaces | Step A.2 again: accessories = Always, direct cable, Ulanzi Studio quit. Then run the check: `bash ~/companion-tools/tools/mac-kit/d200x-mac-check.sh` |
| D200X keeps flicking on/off, log says *"Invalid key in record"* | The surface plugin is on the store version. Switch it to **dev** (step A.3). |
| D200X goes black after about a minute | Run `update.sh` (the keep-alive fix is in the dev version), and check the screensaver is off (A.5). |
| A knob moves the wrong way | Swap the actions under **Rotate left** and **Rotate right**. |
| Panasonic connection is red | Check the camera IP. Open `http://CAMERA-IP` in a browser: the camera's web page should load. |
| UAD connection is red | Open UAD Console once, then check the IP is `127.0.0.1` on the same Mac. Then run `node ~/companion-tools/tools/mac-kit/ua-probe.mjs`. It should list your devices. |
| Anything else | Copy the connection's or surface's **Logs** and send them over. |
