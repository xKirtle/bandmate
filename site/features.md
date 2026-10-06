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
- A **Beat Library** of **Beats**, shared across Songs, each carrying its credit (producer, source link). Upload a Beat, or paste a link to a video on YouTube, SoundCloud, Bandcamp or any other site [yt-dlp](https://github.com/yt-dlp/yt-dlp) reads, and Bandmate fetches its audio with the credit filled in.
- A **Timeline** per Song, with **Tracks** holding **Clips** of Beats or **Sounds** (audio imported into one Song). Clips are trimmed without touching the file.
- Each Track has its own volume, mute and solo. A **Loop** repeats a stretch of the Timeline.
- Undo and redo for every Timeline edit.

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

## What's next

What might come next, from **Snapshots** of the Lyric Sheet to rebinding **Shortcuts**, is in the [roadmap](https://github.com/xKirtle/bandmate/blob/main/docs/roadmap.md), along with what's been decided for each. What each version shipped is in its [release notes](https://github.com/xKirtle/bandmate/releases).
