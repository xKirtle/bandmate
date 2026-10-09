# Features

Bandmate follows a song from the first idea to a rough recording. Here's what you can do with it.

## Your songs

Every song is in one list. Search it by title, filter it by status, tag or whether a song has a finished recording, and sort it by title, status, key, tempo or when you last edited it.

- **Folders** keep songs together, like an EP's. A song sits in one folder at most: drag it onto a folder, or move it from its menu. Deleting a folder asks whether to keep its songs or delete them too.
- **Tags** mark songs with whatever matters to you, like "Album 2023", and a song can have as many as you like. Pick several in the filter to see the songs that have all of them.

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
8. **Line timings**: when each line starts in the song, set as you [sync](#sync). They appear once the [timeline](#timeline) has some audio on it: a beat, a take or another sound.
9. **Scrapbook**: sections that aren't in the song: leftovers and ideas to come back to.

And this is Read mode, here on a phone: the chords over the words, and how to play each one at the top. The button at the top right sets the text size, hides or transposes the chords, and shows or pins the chord shapes.

<img class="phone" src="@screenshots/phone-lyric-sheet.png" alt="A song in Read mode on a phone, with the chord shapes at the top">

## Chords

The **Chords** page, in the side bar, helps with chords away from any song, on guitar, in standard tuning or any other.

- **Look up** a chord by name, like Cmaj7 or D/F#, and see the ways to play it, best first. Prefer one, and that's the shape Read mode shows you.
- **Name it**: put your fingers on the fretboard, and Bandmate tells you which chord you're playing.
- **Suggest**: pick a key, and see the chords that belong in it, the ones borrowed from other keys, and what usually comes after a chord.
- Left-handed? One switch flips every diagram.

## Listen

Keep the music you write to in one library, and use it in any song.

<img src="@screenshots/beat-library-labelled.png" alt="The Beat Library, numbered 1 to 6 to match the list below it">

1. **Add a beat**: upload a file, or [download one from a link](#beats-from-a-link).
2. **Search and filter**: by title or producer, key, tempo, or whether a song uses it.
3. **A beat**: press ▶ to hear it.
4. **Its producer**, kept with the beat as its credit.
5. **The songs that use it.**
6. **Edit it**: its title, credit and details.

You can also attach a song's finished recordings, made elsewhere, to listen back to.

### Beats from a link

Paste a link to a video or track on YouTube, SoundCloud, Bandcamp or [any other site yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), and Bandmate downloads its audio into your library, with the credit filled in.

- It takes one video or track at a time, not playlists or live streams, up to 500 MB [unless you change it](/self-hosting#configuration).
- If a site stops working, open **Settings → About** and press **Update** beside yt-dlp, the downloader Bandmate uses. You don't need to wait for a new Bandmate.

## Timeline

Every song has a timeline: its beat, your takes and any other audio, laid out on tracks and played together.

<img src="@screenshots/timeline-labelled.png" alt="A song's Timeline, numbered 1 to 12 to match the list below it">

1. **Play**, or jump to the start or the end. Click the ruler to move the playhead.
2. **Loop**: repeat a stretch while you write or rehearse.
3. **The stretch it repeats**: drag along the top of the ruler to set it.
4. **Record** a take, see [Record](#record).
5. **Undo and redo** any change on the timeline.
6. **Import audio**: add an audio file to the highlighted track. Dropping a file onto a track does the same.
7. **Mix down**: download the song, or its loop, as one audio file.
8. **Input**: pick the input you record from, see [Record](#record).
9. **Add a beat** from your library, or **a track**.
10. **A track**, with its own volume, mute and solo. New takes go on the highlighted one: click a track's name to choose it.
11. **A beat**: drag it to move it, or its ends to trim it. The file itself is never changed.
12. **A take**, selected. Its **⋯** menu records it again or picks another take, see [Record](#record).

In a narrower window, Import audio, Mix down, the input and then undo and redo fold into a **⋯** at the end of the row, which lists just the ones that don't fit; the input is **Record from…** there. On a phone held upright, the timeline only plays, and offers just Mix down.

A clip's **⋯** menu sets its **tempo** and **pitch**, each on its own or both together: slow a beat down to write over it, or move it a couple of semitones to suit your voice. Select several clips to change them all at once. The file itself is never changed, so you can always set them again, or reset them.

Zoom in with Ctrl and the scroll wheel, or by pinching.

## Sync

Line your lyrics up with the music, so you always know where you are.

- Tap along as the song plays to mark when each line starts, or type the times in.
- As it plays, the current line lights up and the lyrics scroll along with it.
- In Read mode, tap a line to play the song from there.
- Moved the beat? Shift every timing at once.

<img src="@screenshots/sync-mode.webp" alt="Sync mode cueing a Section's Lines as the Timeline plays">

<img src="@screenshots/read-mode.png" alt="A Song in Read mode, with the Line playing highlighted">

## Record

Sing over your beat, right in the browser, in full quality.

<div class="pair">
<img src="@screenshots/take-menu-labelled.png" alt="A take's menu on the Timeline, numbered 1 to 3 to match the list below it">
<img src="@screenshots/input-picker-labelled.png" alt="The inputs to record from, numbered 4 and 5 to match the list below it">
</div>

1. **Retake**: record the part again. Every take is kept. If you've changed the clip's tempo or pitch, reset them first.
2. **Takes**: choose the take the song plays.
3. **Nudge**: shift a take by a few milliseconds, so it sits on the beat.
4. **Input**: every input connected to this device, each channel of an audio interface on its own, its channel first. Pick the one you record from. Each device remembers its own.
5. **Level**: of the input you picked. Sing your loudest, and keep the meter out of the red. Here it's in the red, from a test tone.

**Calibrate** each input in **Settings → Recording**, so your takes land on the beat: it measures how late a click reaches that input on this device. Hands-free is the most exact: rest your headphones on the mic, turn the volume up, and it hears the clicks itself, or tap along on the mic in time with them. If you already know an input's latency, choose **Type it** instead. Bandmate also offers to calibrate the first time you record from an input, where you can skip it and record straight away.

<img src="@screenshots/calibrating.webp" alt="Calibrating an input hands-free in Settings → Recording: the metronome swings as each click is heard, then the result is saved">

The take menu is the **⋯** on a take. The inputs to record from are behind the timeline's mic button, at the end of its row, or **Record from…** in the timeline's **⋯** when the window's too narrow for it.

::: info
Recording only works when you open Bandmate on `localhost` or over HTTPS: browsers don't allow the microphone anywhere else. See [Security](/self-hosting#security) for putting Bandmate behind HTTPS.
:::

## Keyboard shortcuts

On a song's page, press **?**, or the keyboard button by Write and Read, to see every shortcut. The ones you'll use most:

| Keys | What they do |
| --- | --- |
| Space | Play or pause |
| R | Record a take, or stop |
| Ctrl+Z, Ctrl+Shift+Z | Undo, redo |
| Home, End | Go to the start or the end |
| S | Split a clip at the playhead |
| Ctrl+C, Ctrl+X, Ctrl+V | Copy, cut and paste clips |
| Delete | Delete the selected clips |
| Enter | In Sync mode, mark the next line as starting now |
| Ctrl+scroll | Zoom the timeline |

On a Mac, ⌘ works wherever Ctrl does. Choosing your own keys is coming soon.

## Backups

Keep copies of your work, and move it between installs.

<img src="@screenshots/backups-labelled.png" alt="Settings' Backups, numbered 1 to 4 to match the list below it">

1. **Upload** a Backup, made by this Bandmate or another.
2. **New Backup**: of the songs you choose, your beat library, or both.
3. **A Backup**, with when it was made and its size.
4. **Restore** what you pick from it, or download it to keep it somewhere safe. Where a song is already here, you choose to replace it or keep both. On a phone, Restore and Download are in the Backup's ⋯ menu.

A Backup restores into the same version of Bandmate or a newer one. To copy everything at once, see [copying the data folder](/self-hosting#copying-the-data-folder).

## Settings

**Settings**, at the foot of the side bar, has three tabs:

- **This device**: what each device keeps for itself.
  - **Appearance**: three colour palettes, Terracotta (the default), Ink and Olive, each in light and dark. Follow your system's light or dark, or pick one. More palettes may come.
  - **Recording**: every input on this device, each channel of an audio interface on its own, with its latency or "Not calibrated" or "Skipped". Pick the one you record from, or open any of them to see its level, calibrate it as in [Record](#record) without recording from it, or type its latency. Inputs that aren't plugged in keep their latency, listed under **Not connected**, to forget.
  - **Chord diagrams**: flip them for left-handed playing.
- **Backups**: see [Backups](#backups).
- **About**: the version you're running, what changed in it, whether a newer one is out, and the yt-dlp in use.

## What's next

Ideas for Bandmate's future are on the [roadmap](https://github.com/xKirtle/bandmate/blob/main/docs/roadmap.md). It's a wishlist, not a queue: nothing on it is promised, and it isn't in the order things will be built. What each version added is in the [release notes](https://github.com/xKirtle/bandmate/releases).
