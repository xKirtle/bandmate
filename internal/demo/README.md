# The built-in Demo

[`demo.bandmate`](demo.bandmate) is the Demo the Tour shows (ADR 0020): a one-Song Backup holding the Demo Song, "Paper Boats", with its Lyric Sheet and Timeline, and the Demo Beat its Clip plays. The binary embeds it. Each time a Tour starts, Bandmate restores it over the Demo it holds, marks what it restored as the Demo, and leaves that out of every list, count and Backup of the user's Songs and Beats.

The Demo Beat is a generated 8-bar loop in A minor at 90 BPM. The Tour only shows, so it's never played.

## What it must hold

- One Song, and only the Beat its Clip uses. A Backup holding other than one Song is refused when the Tour starts.
- The Sections Verse, Chorus, Verse 2, then the Chorus again as a Duplicate, with Chords throughout. The Verse's first Line starts with `[Am]Folded`, which the Tour's Chords step quotes.
- No Folder and no Tags: restoring the Song would make them among the user's.
- Nothing else: no Masters, Cover, Takes or Scrapbook Sections, and no Snapshots, since none of them is shown and each adds to the binary.

## Rebuilding it

Build it in a dev stack on an empty data directory, so nothing else gets into it:

1. Start the API and the web app on a fresh data directory:

   ```sh
   (cd web && npm install && npx vite build)
   BANDMATE_DATA_DIR=$(mktemp -d) go run ./cmd/bandmate
   # in another terminal
   cd web && npm run dev
   ```

2. In the browser, add the Demo Beat to the Beat Library, then write the Demo Song: its title, Key and BPM, and the Sections above. Add the last Chorus with "Duplicate a Section…" at the end of the Lyric Sheet, picking the Chorus, then delete any Section the new Song started with. On the Timeline, put the Demo Beat on the first Track.
3. In Settings › Backups, make a New Backup of just that Song, and download it.
4. Replace `demo.bandmate` with the download, keeping the name.
5. Run `go test ./internal/app -run Demo`. It restores the new file as the Tour does, and checks the Backup is whole.

A newer Bandmate restores a Backup an older one made, so the file doesn't need rebuilding when the database changes. Rebuild it only to change what the Demo holds.
