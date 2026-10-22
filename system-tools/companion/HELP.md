## App Launcher

Lists the apps installed on the computer running Companion, then launches or quits them from a key.

- **Mac:** the apps in `/Applications` (and its sub-folders, e.g. Utilities) and `~/Applications`. Tick *include built-in apps* for Safari, Notes and so on. You can add more folders.
- **Windows:** every Start Menu shortcut that points at a program. Uninstallers and web links are left out. Store apps (e.g. Settings) don't show; type their name instead.

### Presets
One key per app, under **Apps A–C**, **Apps D–F** and so on. Press = launch, or bring to the front if it's already open. The key goes **green while the app is running**.

### Actions
| Action | Notes |
|---|---|
| Launch / bring to front | Pick from the list, or choose *(Type a name or path below)*. Variables work there. |
| Quit | Asks the app to quit (it may ask to save). Tick **Force quit** to close it straight away; unsaved work is lost. |
| Launch if closed, quit if open | One key that toggles. |
| Rescan for apps | Run after installing or removing apps. |

### Feedback and variables
- **App is running**: green by default.
- `$(app-launcher:app_count)`, `$(app-launcher:running_count)`, `$(app-launcher:last_launched)`.

### Good to know
- It only works on the computer Companion runs on. To launch apps on another computer, use the **VICREO Listener** module.
- The running check looks at the process list every 3 seconds (you can change this in the settings, or set 0 for off).
- If a launch does nothing, the **Log** tab says why.
