## NDI Router

Companion makes its own NDI sources ("routes") and chooses which camera each one shows. It works like NDI Router, but controlled from buttons.

**Example:** make a route called *Companion 1*. In **NDI Virtual Input** (or NDI Webcam), choose **YOUR-COMPUTER (Companion 1)** once and leave it. Now a Companion button switches Virtual Input between cameras.

It also works for Studio Monitor, Video Monitor, OBS, vMix: anything that receives NDI.

### Needs
- **NDI Tools** installed on the computer running Companion (it includes the NDI runtime). The module finds it automatically. If it doesn't, set the library path in the settings (examples in the tooltip).
- Companion running: the routes exist only while Companion is open. After a restart, each route goes back to the source it showed last.

### Settings
- **Route names:** one per line, up to 16. Each becomes an NDI source called `YOUR-COMPUTER (name)`.
- **NDI groups / extra IPs:** only if your NDI network uses groups or sources on other subnets.

### Presets (one category per route)
- A key per NDI source: press to show it on that route. **Green** = what the route is showing now.
- **What's showing:** the current source's name. **Red** while something (e.g. Virtual Input) is watching the route.
- **Clear:** route shows nothing (black).

### Actions
| Action | Notes |
|---|---|
| Route a source | Pick a route and a source. *(Type the source name below)* takes the full NDI name, e.g. `STUDIO-PC (Cam 1)`, with variables allowed. |
| Clear a route | Black. |

### Feedback and variables
- **Route is showing source** (green), **Route is being watched** (red).
- `route_1_source` (short name), `route_1_source_full`, `route_1_watchers`, `route_1_name`, and the same for `route_2`… plus `source_count`.

### Mac: switch NDI Virtual Input itself (no route)
The **Virtual Input (Mac: switch in the app)** presets pick the camera in NDI Virtual Input's own menu-bar menu, as if you clicked it. Virtual Input then shows the camera's real name.
- **One-off setup:** System Settings → Privacy & Security → **Accessibility** → turn on **Companion**. (macOS asks the first time; if it was refused, add it there.)
- NDI Virtual Input must be running (its icon in the menu bar).
- You'll see its menu flash open for a moment on each press.
- **Orange** = the camera Companion last picked. If someone changes it by hand in the menu, Companion doesn't know.
- If a key says the source isn't in the menu, run **Mac: list NDI Virtual Input's menu** and check the **Log** tab for the exact names.
- If NDI renames the app or changes its menu in an update, this can stop working. Routes don't have that problem.
- Only need these keys? Clear the route names in the settings: no routes are made.

### Good to know
- No video goes through Companion: the receiver connects straight to the camera, so there's no extra network load.
- A route never offers itself or another route as a source (that would loop).
- Switching is as fast as the receiver reconnects, usually well under a second.
