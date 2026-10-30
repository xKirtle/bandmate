# Inside a song

A reference for everything you do with a song open, from the first idea to a rough recording: look up the part you're stuck on. The Songs, Chords and Beats pages are on [a page of their own](/features), and Settings, keyboard shortcuts and Backups on [another](/settings).

## Write

Write lyrics the way you would in a notebook, with the chords right where you play them.

<img src="@screenshots/write-mode-labelled.png" alt="A song in Write mode, numbered 1 to 9 to match the list below it">

1. **Status**: where the song is at: an idea, a draft, or finished.
2. **Song details**: its key, tempo, capo and tuning, the languages it's sung in, and notes of your own. Languages offers only those Bandmate suggests [rhymes](#rhymes) in, so others aren't on the list yet.
3. **Write and Read**: [Read mode](#read) shows the song large and uncluttered, to play from. Finished songs open in it.
4. **A section**: one part of the song, named however you like: a verse, a chorus, a hook. Move sections around, or repeat one wherever it comes back.
5. **Chords**: typed in brackets right before the syllable they land on, even mid-word. Read mode shows them above the words.
6. **Alternates**: other versions of a section. Write a few, and pick the one the song uses. The others wait here until you change your mind.
7. **Line timings**: when each line starts in the song, set as you [sync](#sync). They appear once the [timeline](#timeline) has any audio on it.
8. **Scrapbook**: sections that aren't in the song: leftovers and ideas to come back to.
9. **Rhymes**: suggestions for the word you're writing. See [Rhymes](#rhymes).

### How you play a chord

To say how you play a chord in this song, write its frets after its name in the brackets, from the lowest string to the highest, with `x` for a string you don't play: `[Em:x-0-9-9-x-x]`, or without the dashes, `[Em:x099xx]`, while no fret is past 9.

- **What you see**: Write mode shows the frets as you typed them, and Read mode shows only the chord's name, like any other. Printing from either mode does the same.
- **On guitar**: the shape drawn for it at the top is those frets, counted from the capo.
- **One chord at a time**: it's that one chord's, so another `[Em]` in the song is drawn its own way. While a chord is played more than one way, its shapes at the top are numbered in the order they first come, Em ¹, Em ², and each Em over the words carries its shape's number.
- **Transposed, or on piano**: it's drawn like any other Em, and the numbers go.
- **If it doesn't work**: if the brackets stay in the lyrics, Bandmate couldn't read the name or the frets. If the shape at the top is empty, the frets are for more or fewer strings than the song's tuning has.

### Rhymes

Turn **Rhymes** on as you write. It's there on a wide window, like a desktop's, and can't be on while you [sync](#sync).

<img src="@screenshots/rhymes.png" alt="Rhymes on beside the Lyric Sheet, suggesting rhymes for error, the last word of the line being written">

- Download a rhyming dictionary for each language you write in, in **Settings → Rhyming dictionaries**, on each device you write on.
- A song's rhymes are in the languages set in its details.
- Rhymes go by how words sound, not how they're spelt. A word that isn't in the dictionary, like a made-up one, gets none.

Want rhymes in your language? See [Adding a rhyming language](https://github.com/xKirtle/bandmate/blob/main/CONTRIBUTING.md#adding-a-rhyming-language).

### Snapshots

Bandmate keeps copies of a song's lyrics and Scrapbook as they were, so you can get back to how the song was before you changed it. It takes one each time you start editing after 10 minutes or more away, and one just before you delete a section from the Scrapbook, or one of a section's alternates. Deleting doesn't ask first: Undo brings it back while you're still on the song, and restoring that Snapshot does after you've left.

In Write mode, the clock button beside Write and Read opens them. Pick one to see it beside the song as it is now, and step to the one before or after with ‹ › or the ↑ ↓ keys. To take back just one line, select and copy it from the Snapshot.

<img src="@screenshots/snapshots.png" alt="The Snapshots, grouped by age, with a kept one open beside Now and a changed line highlighted on both sides">

Snapshots thin out as they age: every one from the last day stays, then one a day for a month, then one a week. To keep one for good, such as the version you played at an open mic, press its lock to **Keep** it, and it's never thinned. Press the lock again to let it thin out.

**Restore this Snapshot** makes your lyrics and Scrapbook the Snapshot's. What you have now is kept as a Snapshot first, marked "Before restoring", and Undo takes the restore back too. Lines still there keep their timings, and lines it brings back get the timings they had.

A [Backup](/settings#backups) of a song holds its Snapshots, so restoring the Backup, here or on another install, brings them back too.

## Read

Read mode shows the song large and uncluttered, to play from: the chords over the words, and how to play each one at the top. Here it is on a phone.

<img class="phone" src="@screenshots/phone-lyric-sheet.png" alt="A song in Read mode on a phone, with the chord shapes at the top">

### Reading options

The button at the top right sets:

- **Text size**.
- **Chords**: transpose or hide them.
- **Chord shapes**: show, pin or resize them, larger to read them from a music stand further off, smaller to fit more on a phone.
- **Instrument**: guitar or piano, for the chord shapes here and on the [Chords](/features#chords) page.

The chord shapes' size is separate from the text size, and both hold for every song on that device.

### Chord shapes

Hover or tap a chord, or tap its shape at the top, to step through the other ways to play it, and prefer one.

Press the speaker to hear the shape strummed, in the song's tuning. It plays the shape as you'd finger it, so the capo doesn't change it, and it plays over the song if that's playing.

With piano picked, in the reading options, on the [Chords](/features#chords) page or in [Settings](/settings#settings), the shapes are piano keys instead, all drawn over the same keys so they line up, and the speaker plays the keys together. The song's tuning doesn't matter on piano.

<img src="@screenshots/chord-chart-guitar.png" alt="The chord shapes at the top of a song in Read mode, on guitar: a fretboard diagram for each chord">
<img src="@screenshots/chord-chart-piano.png" alt="The same chord shapes on piano: each chord's keys coloured on the same stretch of keyboard">

### Auto-scroll

To play a song through from a music stand without line timings, press **Auto-scroll**, beside the reading options, or **A**. The lyrics scroll on their own at a steady pace, whatever the text size. It stops at the end of the song, and starts from the top again if you press it there.

- **Speed**: from 1 to 10, with − and + on the bar that floats at the bottom, in the reading options, or with **[** and **]**. Each song keeps its own speed on that device.
- **Pause**: on the same bar, or press **A** again.
- **Skip ahead or go back**: scroll by hand, and it carries on from there.

While the timeline plays, the line playing leads instead, so Auto-scroll stops. Where the browser allows, and Bandmate is served over HTTPS, the screen stays on while it runs.

### Print

Print with your browser's own print, **Ctrl+P** (**⌘P** on a Mac), or save a PDF from there. What you get depends on the mode you're in:

- **From Read mode**: what Read mode shows on that device, and nothing else: the title, the key, capo, tuning and BPM, then the lyrics, transposed or without chords as you have them, with the chord shapes at the top if they're showing. A transposed song's key prints as written, with how far it's transposed beside it.
- **From Write mode**: the lyrics as written: chords and all, the key as it is, no chord shapes, and none of the editing tools.

Either way it's black on white, one column at a size made for paper whatever the text size, with page numbers, and a section only splits across two pages when it's longer than one.

## Timeline

Every song has a timeline: its beat, your takes and any other audio, laid out on tracks and played together.

<img src="@screenshots/timeline-labelled.png" alt="A song's Timeline, numbered 1 to 11 to match the list below it">

1. **Play**, or jump to the start or the end. Click the ruler to move the playhead.
2. **Loop**: repeat a stretch while you write or rehearse.
3. **The stretch it repeats**: drag along the top of the ruler to set it.
4. **Record** a take, see [Record](#record).
5. **Import audio**: add an audio file to the highlighted track. Dropping a file onto a track does the same.
6. **Mix down**: download the song, or its loop, as one audio file.
7. **Input**: pick the input you record from, see [Record](#record).
8. **Add a beat** from your library, or **a track**.
9. **A track**, with its own volume, mute and solo. New takes go on the highlighted one: click a track's name to choose it.
10. **A beat**: drag it to move it, or its ends to trim it. The file itself is never changed.
11. **A take**, selected. Its **⋯** menu records it again or picks another take, see [Record](#record).

In a narrower window, Import audio, Mix down and then the input fold into a **⋯** at the end of the row, which lists just the ones that don't fit; the input is **Record from…** there. On a phone held upright, the timeline only plays, and offers just Mix down.

**Undo** and **Redo** are at the top of the song's page, beside Write and Read. Undo takes back your changes to the song's sections, alternates, Scrapbook, timeline and line timings, one at a time, until you leave the song, in Read mode and on a phone too. They're off while you record a take or a merge is being made. Undoing a change to the lyrics stops syncing.

Undo takes back everything you typed in a section's lines, its label or an alternate's name since you clicked in, in one go. While you're still in the box, Ctrl+Z undoes your typing a bit at a time, as in any text box.

A clip's **⋯** menu sets its **tempo** and **pitch**, each on its own or both together: slow a beat down to write over it, or move it a couple of semitones to suit your voice. Select several clips to change them all at once. The file itself is never changed, so you can always set them again, or reset them.

Zoom in with Ctrl and the scroll wheel, or by pinching.

Hold ← or → on the ruler to scan the song, faster with Shift.

## Sync

Line your lyrics up with the music, so you always know where you are.

- Tap along as the song plays to mark when each line starts, or type the times in.
- As it plays, the current line lights up and the lyrics scroll along with it.
- In Read mode, tap a line to play the song from there.
- Moved the beat? Shift every timing at once, from **Cues** above the lyrics, where you can also clear them all.

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
3. **Nudge**: move a clip's audio inside it by a few milliseconds, so it lands on the beat. Alt+drag the clip to do the same by hand. The clip keeps its place either way, and it works on any clip, not just one you've recorded.
4. **Input**: every input connected to this device, each channel of an audio interface on its own, its channel first. Pick the one you record from. Each device remembers its own.
5. **Level**: of the input you picked. Sing your loudest, and keep the meter out of the red. Here it's in the red, from a test tone.

The take menu is the **⋯** on a take. The inputs to record from are behind the timeline's mic button, at the end of its row, or **Record from…** in the timeline's **⋯** when the window's too narrow for it.

::: info
Recording only works when you open Bandmate on `localhost` or over HTTPS: browsers don't allow the microphone anywhere else. See [Security](/self-hosting#security) for putting Bandmate behind HTTPS.
:::

### Calibrate

Calibrate each input in **Settings → Recording**, so your takes land on the beat. There are two ways:

- **Hands-free**, the most accurate: rest your headphones on the mic and turn the volume up, and the mic hears the clicks itself.
- **Tap along**: tap or clap on the mic in time with the clicks.

<img src="@screenshots/calibrating.webp" alt="Calibrating an input hands-free in Settings → Recording: the metronome swings as each click is heard, then the result is saved">

If you know an input's latency already, you can **Type it** in instead, though measuring it is more accurate. Bandmate also offers to calibrate before your first take on an input.
