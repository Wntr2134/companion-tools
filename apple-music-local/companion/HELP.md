## Apple Music (local)

Controls **Apple's Music app on the Mac running Companion**. No Apple login and no internet API. Mac only.

### What it does
- Play / pause / next / previous (restarts the track first if you're past the start, like Music's own button), restart track, seek.
- Music's own volume (not the Mac's system volume), shuffle, repeat (off → all → one), and **favourite** the current song.
- **Your playlists:** the module reads your playlist names from Music. The **Playlists** presets have one key per playlist (the first 24), and the **Play a playlist** action has a list to pick from (or type a name). New playlist? Press a key with **Refresh the playlist list**, or edit the module's settings and save.
- Now playing: track, artist, album, time, volume, shuffle/repeat state, favourite (♥ / ♡). On radio stations the track shows the song and the artist shows the station.
- **First time:** macOS asks *"Companion wants to control Music"*: click **OK**. If you said no: System Settings → Privacy & Security → **Automation** → Companion → tick **Music**.
- Reading the state never opens Music. Play, play/pause and playlist keys will open it if it's closed.

### Apple Music look
Every preset has a faint red music note behind its label, so Apple Music keys are easy to tell apart from other apps' keys (Spotify's have a green mark). Keys that light up (playing, shuffle, repeat, favourite) go Apple Music red with a white note. To remove the note from a key, clear its image in the button editor.

### Now playing card
The **Now playing** preset and the **Wide key viewers** show the track's **album art**, darkened and softly blurred, behind the track and artist, with a thin progress bar along the bottom (red while playing, grey when paused). Some streamed songs and radio stations don't give Music's scripting their cover: those keys use a plain dark background. You can add it to any key as the feedback **Now playing card**: set its **Key shape** to *D200X wide key* or *Normal key*. In Companion's own button grid a wide card shows as a band across the middle of the square; on the D200X it fills the wide key.

### Presets
- **Transport:** play/pause (⏸ / ▶, red while playing), previous, next, shuffle, repeat, favourite, open Music.
- **Now playing:** track and artist on the album-art card, time.
- **Knobs:** volume (push = play/pause), track (turn = previous/next), seek (5 s per click, push = restart).
- **Knobs: − / + buttons and push keys:** the same on plain keys, for Stream Decks without dials and the D200X push row.
- **Playlists:** one key per playlist.
- **Wide key viewers:** now playing, now playing + time, clock + now playing.

### Variables
`track`, `artist`, `album`, `status`, `volume`, `position`, `duration`, `remaining`, `time`, `shuffle`, `repeat`, `favourite`, `play_icon`, `clock`.
