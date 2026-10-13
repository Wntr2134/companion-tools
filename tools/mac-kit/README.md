# D200X + UAD Console: Mac test kit

Put all three files in `~/Downloads`. All of them only read, except `--test-mute`,
which flips one mute for 2 seconds and then puts it back.

## A. D200X (do this first)

1. Quit **Companion** and **Ulanzi Studio**. That includes Studio's menu-bar icon.
   Also remove Studio from System Settings > General > Login Items.
2. Plug in the D200X and run the read-only system check:
   ```bash
   bash ~/Downloads/d200x-mac-check.sh ~/companion-dev/companion-surface-ulanzi-stream-controller 2>&1 | tee ~/Desktop/d200x-check.txt
   ```
3. Test the device with node-hid, with Companion still closed:
   ```bash
   cd ~/companion-dev/companion-surface-ulanzi-stream-controller
   node ~/Downloads/d200x-probe.mjs
   ```
   Press every key, including the wide one and both page keys. Turn each knob
   both ways and press it. Then press Ctrl+C. The probe prints every index it saw.

| Probe result | Meaning | Fix |
|---|---|---|
| `no Ulanzi HID interface visible` | macOS never enumerated 2207:0019 | Plug in through a plain USB 2 hub, then try another cable or port |
| `plugin would NOT claim` | This unit or macOS reports a different PID or interface | Send me the output. It's a one-line filter change in `src/main.ts` |
| `FAILED TO OPEN` | Another app holds the device, or macOS privacy is blocking it | Quit Studio. Then add Terminal and Companion under Privacy & Security > Input Monitoring |
| `OPENED OK` and events print | The Mac side works | The problem is in Companion. See step 4 |

4. If the probe works, open Companion. Check that Developer Modules is on and that
   **Modules > Surfaces > Ulanzi Stream Controller** is enabled. Click **Rescan USB**
   on the Surfaces tab. If the device still doesn't appear, copy the launcher's
   **Show logs** output from just after the rescan.

## B. UAD Console (can run in parallel)

UAD Console must be open, because it starts UA Mixer Engine.
```bash
node ~/Downloads/ua-probe.mjs                      # list devices, channels, mute and level
node ~/Downloads/ua-probe.mjs --test-mute 0 0      # flip input 0 mute, watch Console, auto-restore
node ~/Downloads/ua-probe.mjs --dump /devices/0/inputs/0   # raw JSON for one channel
```
Send me the output of all three. It shows exactly which properties your Console
version exposes, and I'll build the Companion module from that.
