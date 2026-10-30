# Screenshots

The screenshots in the README and on the docs site, `docs/web/`, taken in the dark theme from a demo Bandmate. The desktop and phone shots are at twice their CSS pixels, so they stay sharp on HiDPI screens:

| File                    | Shows                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `write-mode.png`        | The hero Song in Write mode on desktop, with the Timeline open |
| `write-mode-labelled.png` | The hero Song in Write mode with the Chorus's Alternates open, numbered for the key on Inside a song: Status, Details, Write and Read, a Section's Label, Chords, an Alternate, a Cue, the Scrapbook and Rhymes |
| `timeline-labelled.png` | The hero Song's Timeline with a Loop from 0:20 to 0:40 on, the playhead in it and the Take's Clip selected, numbered: Play, Loop, the Loop's stretch, Record, Import audio, Mix down, the mic button, Add a Track, the Chosen Track, the Beat's Clip and the Take's Clip |
| `take-menu-labelled.png` | The Take's Clip menu, numbered: Retake, Takes and Nudge |
| `clip-menu.png` | The Beat's Clip menu, opened by right-clicking it |
| `input-picker-labelled.png` | The mic button's popover, the default input picked and hearing Chromium's fake microphone, numbered 4 and 5: Input and Level |
| `beat-library-labelled.png` | The Beat Library, numbered: Add from link, the search, the Beat's title, its producer, the Song using it and Edit |
| `backups-labelled.png` | Settings' Backups holding the demo Backup, numbered: Scheduled Backups, Upload, New Backup, the Backup and Restore |
| `song-list.png` | The Songs page on desktop: both Folders, then the Songs in none, down to just below the list |
| `chords-look-up.png` | The Chords page's Look up with Cmaj7 typed, in standard tuning: its notes and first page of Voicings, best first |
| `shortcuts-sheet.png` | The shortcuts sheet on the hero Song, opened with ?, down to its first few Shortcuts at their default keys, above the first group its scroll cuts off |
| `phone-song-list.png` | The Songs page on a phone: both Folders, then the Songs in none |
| `phone-timeline.png` | The hero Song on a phone held sideways, the Timeline filling the screen |
| `phone-lyric-sheet.png` | The hero Song in Read mode on a phone                          |
| `chord-chart-guitar.png` | The hero Song's Chord Chart in Read mode, on the guitar |
| `chord-chart-piano.png` | The hero Song's Chord Chart in Read mode, on the piano |
| `read-mode-desktop.png` | The hero Song in Read mode on desktop, at rest, down to the end of Verse 1 |
| `reading-options.png` | The reading options in Read mode, open, on their own |
| `read-mode.webp`        | The hero Song in Read mode following the Line playing through Verse 1, animated |
| `sync-mode.webp`        | Sync mode cueing the Bridge's Lines, animated                  |
| `snapshots.png` | The hero Song's Snapshots, grouped into the last 24 hours, daily and weekly, the oldest Kept and open beside Now, with Verse 1's third Line rewritten since. The capture takes them just before, so it shows them as taken over weeks |
| `rhymes.png` | The hero Song in Rhyme mode with the Chorus's second Alternate chosen, suggesting rhymes for error, its last word, with the caret after it. The capture chooses that Alternate after the Snapshots, so Verse 1 shows their rewrite, and downloads the English rhyming dictionary to that shot's browser alone |
| `calibrating.webp` | Calibrating the default input hands-free in Settings → Recording, from Calibrate to Save, animated. Chromium's fake microphone hears a click file the script writes, so it measures and finishes as it would for real |

The demo content is lorem ipsum, kept in the Backup [`demo.bandmate`](demo.bandmate) beside this file: a hero Song with Chords, a Chord Line, a second Alternate of the Chorus with words of its own, Cues, a Scrapbook Section, a click-track Beat and two Takes, and six other Songs across every Status, one of them in the Folder "Album 2025". Restoring it is also a quick way to fill a dev stack with Songs that have Timelines.

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
   curl -s $url/api/folders -H 'content-type: application/json' -d '{"name": "Demos EP"}'
   ```

   Or, in the app, upload it in Settings, Backups, Restore everything it holds, and make a New folder "Demos EP" on the Songs page. A Backup holds only the Folders its Songs sit in, so the demo's empty Folder is made by hand.

3. Capture:

   ```sh
   cd docs/screenshots
   npm ci
   npm run capture
   ```

   It drives Chromium at `/usr/bin/chromium` (set `CHROMIUM` to use another) against `http://localhost:8080` (set `BANDMATE_URL` to use another), and writes the images here. The animations are recorded from Chromium's screencast, timed against the Timeline playing and the calibration's clicks, so leave the machine idle while it runs, about a minute.

Capturing leaves the Bridge cued, and Verse 1 rewritten with Snapshots taken, so restore again from step 1 before capturing again.

## The walkthrough

`walkthrough.mp4` is a silent video of a song being written, synced, recorded and read in one sitting, about 40 seconds at 1920 by 1200. `walkthrough.mjs` records it from an empty Bandmate: it restores the demo itself, gives it believable words, and refuses to run on a Bandmate with Songs in it, as it changes them. So start one on a new data directory, as in step 1 above, then:

```sh
cd docs/screenshots
npm ci
npm run walkthrough
```

It takes `CHROMIUM` and `BANDMATE_URL` like the capture, also needs ffmpeg with libx264, and takes about a minute. Leave the machine idle while it runs, as it's recorded in real time.

## Changing the demo

Restore the demo into a fresh Bandmate as above, change it in the app, then make a New Backup of every Song and the Beat Library, download it and replace `demo.bandmate` with it. A Backup from an older Bandmate restores into every newer one, so the file only needs replacing when the demo itself changes.
