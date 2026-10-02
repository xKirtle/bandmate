# Screenshots

The README's screenshots, taken in the dark theme from a demo Bandmate. The desktop and phone shots are at twice their CSS pixels, so they stay sharp on HiDPI screens:

| File                    | Shows                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| `song-list.png`         | The Song list on desktop                                             |
| `write-mode.png`        | The hero Song in Write mode on desktop, with the Timeline open       |
| `phone-lyric-sheet.png` | The hero Song's Lyric Sheet on a phone                               |
| `read-mode.png`         | The hero Song in Read mode, with the Line playing highlighted        |
| `sync-mode.webp`        | Sync mode cueing the Bridge's Lines, animated                        |
| `social-preview.png`    | GitHub's social preview (1280×640), from the hero Song in Write mode |

The demo content is lorem ipsum, made by [`cmd/demoseed`](../../cmd/demoseed): a hero Song with Chords, a Chord Line, a second Alternate, Cues, a Scrapbook Section, a generated click-track Beat and two Takes, and six other Songs across every Status.

## Retaking them

When the UI changes and the screenshots go stale, reseed a fresh Bandmate and recapture. Capturing needs Node, Chromium and ffmpeg built with libwebp; the seed needs only Go.

1. Build the web app and start Bandmate on an empty data directory:

   ```sh
   (cd web && npm ci && npm run build)
   rm -rf /tmp/bandmate-demo
   BANDMATE_DATA_DIR=/tmp/bandmate-demo go run ./cmd/bandmate
   ```

2. In another terminal, seed it. The seed refuses a Bandmate that already has Songs or Beats.

   ```sh
   go run ./cmd/demoseed -url http://localhost:8080
   ```

3. Capture:

   ```sh
   cd docs/screenshots
   npm ci
   npm run capture
   ```

   It drives Chromium at `/usr/bin/chromium` (set `CHROMIUM` to use another) against `http://localhost:8080` (set `BANDMATE_URL` to use another), and writes the images here. The animation is recorded from Chromium's screencast, timed against the Timeline playing, so leave the machine idle while it runs, about half a minute.

Capturing leaves the Bridge cued, so reseed from step 1 before capturing again.

The social preview isn't used by the README: GitHub shows it when the repo's link is shared. It only takes effect once uploaded in the repo's Settings → General → Social preview.
