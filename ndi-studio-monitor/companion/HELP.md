## NDI Studio Monitor

Controls **NDI Studio Monitor** (part of NDI Tools for Windows) over its built-in web control. Companion can be on the same PC or another computer on the network.

### Setup in Studio Monitor
1. Open Studio Monitor, then ☰ menu → **Settings → Application** → turn on **Web control**. It shows the address (IP and port).
2. Web login: **admin / admin** by default, unless the web password was turned off when NDI Tools was installed.
3. Each Studio Monitor window has its own address. Add one connection per window you want to control.

### Presets
- **Sources:** a key per NDI source, green when it's showing. **None** = black.
- **Overlay (PiP):** a key per source to show it picture-in-picture (blue when it's the overlay), plus **Hide overlay**.
- **Status:** *Showing now* (source name), *Record* toggle with time (red while recording), *Audio mute* toggle (red when muted).

### Actions
| Action | Notes |
|---|---|
| Show a source | Pick from the list, *None*, or type a full NDI name (variables allowed). |
| Overlay a source | Picture in picture, or alpha (for keyed graphics). |
| Hide the overlay | |
| Audio mute | Toggle, on or off. |
| Record | Toggle, on or off. Records the main source to Studio Monitor's record folder. |
| Advanced: send configuration JSON | Anything else Studio Monitor's web API accepts. |

### Variables
`source`, `source_full`, `overlay`, `overlay_mode`, `audio_muted`, `recording`, `rec_time`, `source_count`.

### Not covered
- **Mac (NDI Video Monitor)** has no web control, so it can't be controlled this way. To switch what it shows, point it at an **NDI Router** route (see the NDI Router module).
