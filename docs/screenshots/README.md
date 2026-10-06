# Screenshots

The README's screenshots, taken in the dark theme from a demo Bandmate. The desktop and phone shots are at twice their CSS pixels, so they stay sharp on HiDPI screens:

| File                    | Shows                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `song-list.png`         | The Song list on desktop                                       |
| `write-mode.png`        | The hero Song in Write mode on desktop, with the Timeline open |
| `phone-lyric-sheet.png` | The hero Song's Lyric Sheet on a phone                         |
| `read-mode.png`         | The hero Song in Read mode, with the Line playing highlighted  |
| `sync-mode.webp`        | Sync mode cueing the Bridge's Lines, animated                  |

The demo content is lorem ipsum, kept in the Backup [`demo.bandmate`](demo.bandmate) beside this file: a hero Song with Chords, a Chord Line, a second Alternate, Cues, a Scrapbook Section, a click-track Beat and two Takes, and six other Songs across every Status. Restoring it is also a quick way to fill a dev stack with Songs that have Timelines.

## Retaking them

When the UI changes and the screenshots go stale, restore the demo into a fresh Bandmate and recapture. Capturing needs Node, Chromium and ffmpeg built with libwebp; restoring needs curl and jq.

1. Build the web app and start Bandmate on an empty data directory:

   ```sh
   (cd web && npm ci && npm run build)
   rm -rf /tmp/bandmate-demo
   BANDMATE_DATA_DIR=/tmp/bandmate-demo go run ./cmd/bandmate
   ```

2. In another terminal, restore everything in the demo Backup into it:

   ```sh
   url=http://localhost:8080
   id=$(curl -s --data-binary @docs/screenshots/demo.bandmate $url/api/backups/upload | jq .id)
   songs=$(curl -s $url/api/backups/$id/songs | jq -c 'map(.id)')
   beats=$(curl -s $url/api/backups/$id/beats | jq -c 'map(.id)')
   curl -s $url/api/backups/$id/restore -H 'content-type: application/json' -d "{\"songs\": $songs, \"beats\": $beats}"
   ```

   Or, in the app, upload it in Settings, Backups, and Restore everything it holds.

3. Capture:

   ```sh
   cd docs/screenshots
   npm ci
   npm run capture
   ```

   It drives Chromium at `/usr/bin/chromium` (set `CHROMIUM` to use another) against `http://localhost:8080` (set `BANDMATE_URL` to use another), and writes the images here. The animation is recorded from Chromium's screencast, timed against the Timeline playing, so leave the machine idle while it runs, about half a minute.

Capturing leaves the Bridge cued, so restore again from step 1 before capturing again.

## Changing the demo

Restore the demo into a fresh Bandmate as above, change it in the app, then make a New Backup of every Song and the Beat Library, download it and replace `demo.bandmate` with it. A Backup from an older Bandmate restores into every newer one, so the file only needs replacing when the demo itself changes.
