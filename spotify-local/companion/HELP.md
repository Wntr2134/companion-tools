## Spotify (local)

Controls the **Spotify app on the computer running Companion**. No Spotify login, no internet API, and a free account works too.

### Mac: full control
- Play / pause / next / previous / restart track, shuffle, repeat, Spotify volume, seek.
- **Play a playlist, album or track:** paste a Spotify *Share → Copy link* (or a `spotify:` URI) into the **Play a playlist** preset. Handy for walk-in or interval music.
- Now playing: track, artist, album, time, volume, shuffle/repeat state, plus the album art URL.
- **First time:** macOS asks *"Companion wants to control Spotify"*: click **OK**. If you said no: System Settings → Privacy & Security → **Automation** → Companion → tick **Spotify**.
- Reading the state never opens Spotify. Play, play/pause and playlist keys will open it if it's closed.

### Windows: media keys
- Play / pause / next / previous use the keyboard's media keys, and the track and artist come from Spotify's window title.
- The volume knob / − + keys change the **system** volume. Spotify has no volume control from outside on Windows.
- No shuffle, repeat, seek or Spotify volume on Windows. Media keys go to whichever app is playing media, so pause other players (e.g. a browser) if it gets confused.
- Playlist keys open the playlist in Spotify. On Windows you may need to press play.

### Spotify look
Every preset has a faint Spotify mark behind its label, so Spotify keys are easy to tell apart from other apps' keys. Keys that light up (playing, shuffle, repeat) go Spotify green with a dark mark. To remove the mark from a key, clear its image in the button editor.

### Now playing card
The **Now playing** preset and the **Wide key viewers** show the track's **album art**, darkened and softly blurred, behind the track and artist, with a thin progress bar along the bottom (Spotify green while playing, grey when paused). Made for the D200X's wide key, and it works on any key. On Windows (no album art from Spotify) it uses Spotify's dark background with the same bar. You can add it to any key as the feedback **Now playing card**: set its **Key shape** to *D200X wide key* or *Normal key* (Companion doesn't tell modules a key's real shape). In Companion's own button grid a wide card shows as a band across the middle of the square; on the D200X it fills the wide key.

The **Clock + now playing** viewer uses this module's own `clock` variable (HH:MM, the computer's time).

### When nothing is playing
The now-playing key and the wide key viewers never go blank: when Spotify is closed or stopped they show a **clock and the date**. To show something else, edit the connection and change *When nothing is playing, viewers show (line 1 / line 2)*. Any variables work there, e.g. another module's status or the System Tools CPU and memory.

### Presets
- **Transport:** play/pause (⏸ / ▶, green while playing), previous, next, shuffle, repeat, open Spotify.
- **Now playing:** track and artist on the album-art card, time.
- **Knobs:** volume (push = play/pause), track (turn = previous/next), seek (Mac, 5 s per click, push = restart).
- **Knobs: − / + buttons and push keys:** the same on plain keys, for Stream Decks without dials and the D200X push row.
- **Playlists:** one key to copy and edit per playlist.

### Variables
`track`, `artist`, `album`, `status`, `volume`, `position`, `duration`, `remaining`, `time`, `shuffle`, `repeat`, `play_icon`, `uri`, `artwork_url`.
