## System Tools

Your computer from Companion keys: the computer Companion runs on. (This used to be **App Launcher**: everything it did is still here, with the same actions.)

**Mac permission, once:** System Settings → Privacy & Security → **Accessibility** → turn on **Companion**. Needed for moving windows, keyboard shortcuts, typing text and locking the screen. After a Companion update, if it stops working, remove Companion from that list with **−** and add it again.

### Apps (Mac and Windows)
- One key per installed app under **Apps A–C**, **Apps D–F** and so on. Press = open, or bring to the front. **Green while running.**
- Actions: launch, quit (tick *Force quit* only if it hangs), launch-or-quit toggle, hide, hide all the others, show all, rescan.
- Mac: the apps in `/Applications` (and sub-folders) and `~/Applications`; tick *include built-in apps* for Safari, Notes and so on. Windows: the Start Menu.

### Your Dock (Mac)
**Your Dock** presets: one key per app in your Mac's Dock (Finder first, then in Dock order), showing the app's name, green while it runs. The action *Open the app in a Dock position* does the same on any key. Rearrange the Dock and the keys follow (checked every minute, or press *Re-read Dock*).

### Bluetooth (Mac)
**Bluetooth** presets: one key per paired device. Press to connect or disconnect; blue while connected. Pair devices once in System Settings → Bluetooth. If you have the free *blueutil* installed (`brew install blueutil`) it's used, as it's the most reliable; otherwise macOS's own Bluetooth system is used, which may ask to let Companion use Bluetooth. Turning Bluetooth itself on or off isn't here: use a Shortcuts-app shortcut with *Set Bluetooth*.

### Windows and screens (Mac)
- **Window: move / resize**: any app's window (or the one in front) onto a screen, in a position: fill, halves, thirds, two-thirds, quarters, centre large, centre, or *same place, other screen*. It can open the app first.
- **Screens:** screen 1 has the menu bar; the others are numbered left to right. The list in the action shows their names.
- **Window layouts:** arrange windows however you like, press **Save layout N**, and **Layout N** puts them all back later (matched by window title). Six slots, kept in `~/Library/Application Support/Companion Tools/`.
- **Arrange apps (written list):** one line per app, `App name, screen, position`, e.g. `Resolume Arena, 2, fill`.
- **Can't move:** windows in full screen (green button) and some apps that fix their own size. The log says which.
- **Magnet keys** press Magnet's default shortcuts, for people who use Magnet. They only work with Magnet running and its shortcuts unchanged. The built-in window moving doesn't need Magnet and can move windows that aren't in front.

### Show machine
- **Keep awake**: stops the Mac sleeping (and the screens dimming, unless you untick it). Amber while on. Off with the key, or when Companion closes.
- Sleep the screens, lock, screen saver, eject all disks, dark mode (blue while on).

### Sound
- Volume knob (push = mute, red when muted), microphone knob, and − / + keys for Stream Decks.
- Volume shows **–** for outputs macOS can't set (some audio interfaces, HDMI). Windows: the volume keys and mute.
- Switching the output device needs an extra tool, so it isn't here.

### Desktop, keys and text
- Mission Control, show desktop, the front app's windows, desktop left / right.
- **Keys: press a keyboard shortcut**: pick the key and tick ⌘ ⌥ ⌃ ⇧. Optionally name an app to bring to the front first.
- **Paste text** (instant, through the clipboard) and **type text** (key by key).

### Shortcuts app
One key per shortcut in Apple's Shortcuts app, and a **Run a shortcut** action. Use it for Focus / Do Not Disturb, wallpapers, smart home and anything else Shortcuts does. New shortcut? Press **Refresh shortcuts**.

### Wide key viewers and variables
Viewers: clock and date, CPU and memory, disk and battery, IP and uptime, volume and keep awake.

Variables: `clock`, `date`, `date_short`, `cpu`, `memory`, `cpu_memory`, `disk_free`, `disk_used`, `battery`, `disk_battery`, `ip`, `uptime`, `volume`, `input_volume`, `muted`, `keep_awake`, `dark_mode`, `screen_count`, `screens`, `dock_1`…`dock_16`, `dock_count`, `bt_connected`, `app_count`, `running_count`, `last_launched`. Spotify and Apple Music can show these when nothing is playing (their *When nothing is playing* settings).
