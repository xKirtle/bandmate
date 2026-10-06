# Features

The words in bold are defined in the [glossary](https://github.com/xKirtle/bandmate/blob/main/GLOSSARY.md).

## Write

- **Songs**, each with a **Status** (idea, drafting or finished), a **Cover**, and Details: key, BPM, capo, tuning and notes.
- A **Lyric Sheet** made of **Sections**, each with a free-text **Label** ("Chorus", "Verse 2", "Hook"), put in order by the **Arrangement**. **Duplicate** a Section to sing it again.
- **Alternates**: competing versions of a Section's Lines, one active at a time, all shown in full in **Alternates mode** to choose between.
- **Chords** anchored anywhere in a **Line**, even mid-word, and **Chord Lines** for intros, solos and other instrumental passages.
- A **Scrapbook** for Sections that aren't in the Arrangement: leftovers and loose ideas kept for later.
- **Write mode** for working on a Song and **Read mode** for playing from it. Finished Songs open in Read mode.
- A two-column Song page on desktop, and a layout for writing lyrics on a phone.

![The Song list on desktop, with each Song's Status, key and BPM](../docs/screenshots/song-list.png)

<img class="phone" src="../docs/screenshots/phone-lyric-sheet.png" alt="A Song's Lyric Sheet on a phone">

## Listen

- **Masters**: finished recordings of a Song made elsewhere, attached to it with their own waveform and player.
- A **Beat Library** of **Beats**, shared across Songs, each carrying its credit (producer, source link). Upload a Beat, or [download one from a link](#beats-from-a-link).
- A **Timeline** per Song, with **Tracks** holding **Clips** of Beats or **Sounds** (audio imported into one Song). Clips are trimmed without touching the file.
- Each Track has its own volume, mute and solo. A **Loop** repeats a stretch of the Timeline.
- Undo and redo for every Timeline edit.

### Beats from a link

Paste a link to a video or track on YouTube, SoundCloud, Bandcamp or [any other site yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), and Bandmate downloads its audio as a Beat, with the credit filled in. It uses [yt-dlp](https://github.com/yt-dlp/yt-dlp), which comes with Bandmate.

- One video or track at a time: not playlists, channels or live streams.
- The audio is saved as m4a. A download stops if it's larger than the upload limit (500 MB, unless [set otherwise](/self-hosting#configuration)), or takes longer than 10 minutes.
- A download you don't add to the Beat Library is deleted after an hour, or when Bandmate restarts.
- **If a site stops working**, yt-dlp probably needs a newer version. You don't need to wait for a new Bandmate: open **Settings → About**, and press **Update** beside yt-dlp. Bandmate always uses the newest yt-dlp it has, whether that's your update or the one a later Bandmate brings.

## Sync

- **Cues** link Lines to times on the Timeline. Make them in **Sync mode**, marking each Line "Now" as it starts, or type them in the Cue gutter.
- While the Timeline plays, the Line playing is highlighted and the Lyric Sheet follows it. In Read mode, clicking a cued Line plays from it.
- Shift every Cue at once, and see which Cues are out of order.

![Sync mode cueing a Section's Lines as the Timeline plays](../docs/screenshots/sync-mode.webp)

![A Song in Read mode, with the Line playing highlighted](../docs/screenshots/read-mode.png)

## Record

- **Takes** recorded in the browser as lossless WAV, on the **Chosen Track**, over whatever the Timeline holds.
- Retake a Clip to stack Takes in it, then choose the one it plays.
- **Latency Offset** calibration per device, by tapping or clapping along with a click, and a **Nudge** per Take for the rest.
- An **Input** picker with a level meter, remembered per device.

## Backups

- Back up the Songs you choose, the Beat Library, or both, in **Settings → Backups**, and download a Backup to keep it somewhere else.
- Restore a Backup into this Bandmate or another one, picking what to bring back. Where a Song or Beat is already there, you choose whether to replace it or keep both, and nothing else is touched.
- A Backup restores into the same Bandmate version or a newer one, never an older one.

To copy everything at once, including every Backup, see [copying the data folder](/self-hosting#copying-the-data-folder).

## What's next

What might come next, from **Snapshots** of the Lyric Sheet to rebinding **Shortcuts**, is in the [roadmap](https://github.com/xKirtle/bandmate/blob/main/docs/roadmap.md), along with what's been decided for each. What each version shipped is in its [release notes](https://github.com/xKirtle/bandmate/releases).
