# Setup guide: from a brand-new Mac to everything working

Follow the steps in order. Each step says what you should see when it worked. If something doesn't match, stop and check **Troubleshooting** at the bottom.

You will set up:
- **Part A:** Ulanzi D200X: all keys and knobs in Companion
- **Part B:** Panasonic PTZ (AW-HE40): knob pan/tilt/zoom/focus and hold-to-save presets
- **Part C:** UAD Console (Apollo): mutes, faders, monitor

You only need the parts for the gear you have. **Part 0 is always needed.**

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
