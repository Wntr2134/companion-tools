## grandMA2 (knobs)

Controls a grandMA2 console or **grandMA2 onPC** (written for 3.9.60.89) from Companion, with a knob layer for the Ulanzi D200X.

- **Telnet** (port 30000) sends the commands. This part follows MA's documented Telnet remote.
- **Web Remote** (optional) reads back executor names, fader levels, running state and cue names, and can press executor buttons for real momentary Flash/Temp. This part is **reverse-engineered** from community projects and **not yet tested on 3.9.60.89**. If it isn't set up or doesn't work, everything else still works on Telnet alone.

This is a separate module from the store's "malighting-grandma2" (its id is `grandma2-plus`), so both can be installed. It keeps the store module's five actions with the same ids and options.

### Console / onPC setup
1. **Setup → Console → Global Settings**:
   - **Telnet:** *Login Enabled*.
   - **Remotes:** *Login Enabled* (only needed for the Web Remote).
2. For the Web Remote, make a **separate user with a password** (Setup → Console → User & Profiles Setup). The Web Remote **won't accept Administrator**. Give it at least *Playback* rights; use *Setup* if commands get refused.
3. **At most 3 remote users** can be logged in at once (web browsers, phones and this module all count).
4. onPC on Windows: allow grandMA2 onPC through the Windows firewall on the private network (TCP 30000 and 80).
5. Check the Web Remote: open `http://<console IP>/` in a browser. The MA web remote login page should appear; log in with the new user once to prove the password.

### Connection settings
| Setting | Notes |
|---|---|
| Console / onPC IP | |
| Log in on Telnet, user, password | Default `administrator` / `admin`. The login is sent quoted (`Login "user" "pass"`), so names aren't expanded by the command line. Untick if Telnet is set to *Login Disabled*. |
| Gap between commands | Default 50 ms. Commands go out one at a time. |
| Check the console every | A blank line every 10 s; if the console says nothing for 25 s the module reconnects. |
| Use the Web Remote, user, password | The user from step 2. The password is sent as an MD5 hash, as the browser remote does. |
| Read back every | Default 250 ms. |
| Send fader moves by | *Web Remote when connected* (default) or *Telnet only*. |
| Start page, Executors | Which executors get variables, presets and readback, e.g. `1-15` or `1-15, 101-105`. Page +/- actions move the page from there. |
| Selecting an executor here also selects it on the console | Off by default. Sends `Select Executor p.e`. |
| Fader / Grand master command | Templates with `{page}`, `{exec}`, `{level}`. Defaults `Fader {page}.{exec} At {level}` and `SpecialMaster "grandmaster"."grand" At {level}`. Try `Executor {page}.{exec} At {level}` if the console rejects the default. |

**Status:** *Connecting* until the console answers, **OK** once logged in on Telnet (or the prompt shows when login is off), *Disconnected* when it stops answering. Web Remote problems (refused login, switched off) show after the OK message. *Logged in as guest* is a warning: check the password.

### Safety rules
- **Go, Go-, Pause, Flash, Temp, key presses and custom commands are never repeated.** If the link is down when you press the key, the command is dropped and logged, not sent later (a late Go would skip a cue).
- **Fader moves are merged.** Fast knob turns count every click locally, but only the newest value per executor goes out. A fader value waiting while the link is down is sent when it comes back.

### Presets for the D200X
On the D200X a knob's turn and its push are separate buttons (row 3 and row 4 of the page).

**D200X: knobs**
| Knob | Turn | Push (pick one) |
|---|---|---|
| 1 | *Knob 1 turn: selected executor fader* (name + %) | *Go+*, *Flash while held*, or *fader to 0 / back* |
| 2 | *Knob 2 turn: fader of the executor after the selected one* | *select the next executor* |
| 3 | *Knob 3 turn: grand master* | *next page* |

Also *Knob: choose the selected executor* and *Knob: page*.

**D200X: selected executor keys:** ◀ previous / next ▶ executor, **Go+** (shows the next cue), **Go-**, **Pause** (green while running), **Flash** and **Temp** (while held), **Off**, **Top**, an info key (page.exec, level, current cue) and a connection status key.

**Quick select:** one key per executor in the list, showing name and level. Blue = selected, green = running.

**Executor N:** Go+, Flash while held and a fader knob for each executor in the list.

### Actions
| Action | Notes |
|---|---|
| Executor: Go+ / Go- / Pause / Off / On / Toggle / Top / Goto cue | `Go Executor p.e` etc. Executor = *Selected*, *after the selected one*, or a number; page 0 = the module's current page. |
| Executor: Flash / Temp (momentary) | Put *Press* on key down and *Release* on key up. *Command* sends `Flash On Executor p.e` / `Flash Off Executor p.e`. *Web Remote: hold executor button 1-3* presses the real button (use the one set to Flash or Temp on the console), and falls back to the command without the Web Remote. |
| Executor: hold button 1-3 (Web Remote) | Any executor button, exactly like a finger on the console. |
| Executor: fader step (knob) | Step size 1-10 (below). Clamped to 0-100 %. |
| Executor: fader set, fader to 0 / back | |
| Grand master: step / set | The module can't read the grand master back, so it starts from 100 % and tracks what it sent. |
| Page: next / previous, go to | Changes the module's page, and by default sends `FaderPage n` (or ButtonPage / Page / nothing). |
| Selected executor: choose / next / previous | Steps through the executor list, wrapping round. |
| Run custom command | `command`, as in the store module. Sent over the Web Remote if Telnet is down. |
| Console key press / release, Move wheel, Rotate console encoder, Console encoder press / release | `button`, `wheel`, `encoder`, `encoder_p` from the store module (Lua `gma.canbus`), with the missing-direction and NaN bugs fixed. |

### Step sizes (% per knob click)
| Size | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| % | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 15 | 20 |

Default 2. Without the Web Remote the module only knows what it sent itself: a fader moved on the console isn't seen, and the first click starts from 0 % (or the last value sent).

### Feedbacks
Executor running · fader above a level · fader at full · executor is the selected one · connected (Telnet, Web Remote, or both). Running needs the Web Remote.

### Variables
- Per executor in the list (current page): `exec_N_name`, `exec_N_level`, `exec_N_running` (on/off), `exec_N_cue`, `exec_N_next`, `exec_N_prev`.
- Selected executor: `sel_exec`, `sel_label` (page.exec), `sel_name`, `sel_level`, `sel_running`, `sel_cue`, `sel_next`, `sel_prev`. The executor after it: `nxt_…`.
- `page`, `gm_level`, `telnet`, `webremote`, `response` (last Telnet line).

Names, cues and running need the Web Remote; without it the name is `Exec page.exec`.

### Not yet tested on the console
See `NOTES.md` in the module folder. In short: the fader, grand master, Flash/Temp On/Off and Top command forms, whether a blank line is the best heartbeat, which executor button the Web Remote's button 1-3 means, and the whole Web Remote exchange on 3.9.60.89.
