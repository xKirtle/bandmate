# Features

Bandmate follows a song from the first idea to a rough recording. Here's what you can do with it.

## Write

Write lyrics the way you would in a notebook, with the chords right where you play them.

<img src="@screenshots/write-mode-labelled.png" alt="A song in Write mode, numbered 1 to 9 to match the list below it">

1. **Status**: where the song is at: an idea, a draft, or finished.
2. **Song details**: its key, tempo, capo and tuning, and notes of your own.
3. **Write and Read**: Read mode shows the song large and uncluttered, to play from. Finished songs open in it.
4. **A section**: one part of the song, named however you like: a verse, a chorus, a hook. Move sections around, or repeat one wherever it comes back.
5. **Chords**: typed in brackets right before the syllable they land on, even mid-word. Read mode shows them above the words.
6. **A line of chords alone**: for intros, solos and other parts without words.
7. **Alternates**: other versions of a section. Write a few, and pick the one the song uses. The others wait here until you change your mind.
8. **Line timings**: when each line starts in the song, set as you [sync](#sync).
9. **Scrapbook**: sections that aren't in the song: leftovers and ideas to come back to.

Every song is in one list, with its status, key and tempo at a glance. And you can write on your phone too, in a layout made for it.

<img src="@screenshots/song-list.png" alt="The Song list on desktop, with each Song's Status, key and BPM">

<img class="phone" src="@screenshots/phone-lyric-sheet.png" alt="A Song's Lyric Sheet on a phone">

## Listen

Bring in the music you're writing to, and lay it out on a timeline.

- Keep your beats in one library, credited to their producers, and use them in any song.
- Upload a beat, or [download one from a link](#beats-from-a-link).
- Arrange beats and other audio on a multi-track timeline: trim clips, loop a part, and set each track's volume, or mute or solo it. Undo anything.
- Attach finished recordings of a song, made elsewhere, to listen back to.

### Beats from a link

Paste a link to a video or track on YouTube, SoundCloud, Bandcamp or [any other site yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), and Bandmate downloads its audio into your library, with the credit filled in.

- It takes one video or track at a time, not playlists or live streams, up to 500 MB [unless you change it](/self-hosting#configuration).
- If a site stops working, open **Settings → About** and press **Update** beside yt-dlp, the downloader Bandmate uses. You don't need to wait for a new Bandmate.

## Sync

Line your lyrics up with the music, so you always know where you are.

- Tap along as the song plays to mark when each line starts, or type the times in.
- As it plays, the current line lights up and the lyrics scroll along with it.
- In Read mode, tap a line to play the song from there.
- Moved the beat? Shift every timing at once.

<img src="@screenshots/sync-mode.webp" alt="Sync mode cueing a Section's Lines as the Timeline plays">

<img src="@screenshots/read-mode.png" alt="A Song in Read mode, with the Line playing highlighted">

## Record

Sing over your beat, right in the browser.

- Record takes in full quality over whatever's on the timeline.
- Record a part again as often as you like, and pick the take you keep.
- Calibrate once per device, by tapping or clapping along to a click, so your takes land on the beat. Fine-tune any take by hand.
- Pick your microphone and watch its level. Bandmate remembers it for each device.

## Backups

Keep copies of your work, and move it between installs.

- Back up some songs, your beat library, or both, in **Settings → Backups**, and download the file to keep it somewhere safe.
- Restore into this Bandmate or another one. If a song is already there, choose to replace it or keep both.
- A Backup restores into the same version of Bandmate or a newer one.

To copy everything at once, see [copying the data folder](/self-hosting#copying-the-data-folder).

## What's next

Ideas for what comes next, like snapshots of your lyrics and your own keyboard shortcuts, are on the [roadmap](https://github.com/xKirtle/bandmate/blob/main/docs/roadmap.md). What each version added is in the [release notes](https://github.com/xKirtle/bandmate/releases).
