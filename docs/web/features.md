# Songs, Chords and Beats

A reference for the pages in Bandmate's side bar: look up the part you're stuck on. What you do with a song open is on [Inside a song](/song), and Settings, keyboard shortcuts and Backups on [a page of their own](/settings).

## Your songs

Songs not in a folder are listed here, and search and filters look at every song, folders included. Search by title, filter by status, tag or whether a song has a [Master](/song#masters), and sort by title, status, key, tempo, Master or when you last edited it.

<img src="@screenshots/song-list.png" alt="The Songs page: two folders, then the songs in neither, each with its status, key and tempo">

- **Folders** keep songs together, like an EP's. A song sits in one folder at most: drag it onto a folder, or move it from its menu. Deleting a folder asks whether to keep its songs or delete them too.
- **Tags** mark songs with whatever matters to you, like "Album 2023", and a song can have as many as you like. Pick several in the filter to see the songs that have all of them.

## Chords

The **Chords** page, in the side bar, helps with chords away from any song, on guitar, in standard tuning or any other, or on piano. Pick one under **Instrument**; that device remembers it, and Read mode shows chords on it too. Switch it here, in Read mode's reading options, or in Settings.

<img src="@screenshots/chords-look-up.png" alt="Look up showing Cmaj7: its notes, then its shapes as chord diagrams, best first">

- **Look up** a chord by name, like Cmaj7 or D/F#. Press the speaker to hear a Voicing strummed on a recorded nylon-string guitar, in the tuning you picked: each note is recorded on its own string, so the same chord played up the neck sounds as it would there. Prefer one, and that's the shape Read mode shows you.
- **Name it**: put your fingers on the fretboard, or press keys on the piano, and Bandmate tells you which chord you're playing, reading the lowest note as the bass. Press the speaker to hear it, even if it isn't a chord.
- **Suggest**: pick a key — a tonic and major or minor, or type it — and see the chords that belong in it, the ones borrowed from other keys, and what usually comes after a chord. Each one shows a way to play it: the one you prefer, or else the best. Press the speaker to hear it strummed. **More Voicings** opens it in Look up, with the other ways.

### Hearing, copying and left-handed playing

- The rising bars arpeggiate the shape: they play it one note at a time, low to high, so you can hear each note.
- On guitar, the copy button beside a shape copies it the way you [write it in a song](/song#how-you-play-a-chord), brackets and all, like `[Em:x-7-9-9-8-7]`: paste it straight into a line in Write mode. In Name it, each name your shape reads as has its own, so copy the one you want. The frets are for the tuning picked here, so paste it into a song in that tuning.
- Left-handed? Turn it on in Settings, under **This device**, and every diagram flips, the fretboard too, and so does the [Tuner](#tuner)'s headstock. The piano doesn't flip.

### On piano

- Each way to play a chord is drawn as the keys from C3 to C5, the ones to press coloured and marked with a dot: root position and each inversion, for one hand, around middle C.
- A slash chord like C/G starts with the inversion that has its bass lowest, then plays the bass under the others with your left hand.
- Prefer one, and it comes first in Look up and is the one Suggest shows; it's kept apart from the shapes you prefer on guitar.
- The speaker plays the keys together, on a recorded grand piano.
- In Name it, tap a key to press it and again to let it go, or use the arrow keys and Space.

## Tuner

The **Tuner** page, in the side bar, tunes your guitar, by eye or by ear. Pick the tuning to tune to under **Tuning**, a named one or six notes of your own: it's the same one the Chords page uses, so after tuning to Open G, Chords shows Open G shapes, and the other way round. Your device remembers it.

<img src="@screenshots/tuner.png" alt="The Tuner listening in standard tuning: a guitar's headstock with the low strings' pegs down the left and the high strings' down the right, and between them the A2 it hears on the 5th string, a wave, then 8 cents sharp over an arrow down and Tune down; under the headstock, the input it listens on">

Press **Listen** and play a string. Between the pegs, the Tuner shows the note it hears, the string whose note is nearest, how many cents sharp or flat of it you are, and which way to tune to it: an arrow up and **Tune up** when you're flat, an arrow down and **Tune down** when you're sharp. The arrow is the way to turn the peg, not where the note is. The wave there drifts as a strobe tuner's does: one way when you're flat, the other when you're sharp, faster the further off you are. Tune until it stands still and says **In tune**, within 5 cents. If your device asks for reduced motion, the wave stays still, and the cents, the way to tune and **In tune** tell you instead. A screen reader hears the cents and the way to tune together. It listens on the [input you record from](/song#record) until you pick another under the headstock: press the button beside **Listens on**, pick one of your inputs, and check its level meter moves as you play. Your device remembers it, so a guitar on Input 2 of an interface can be tuned while you record vocals from Input 1, and recording isn't changed. If the input you picked isn't connected, the Tuner listens on the one you record from, and says so. If it can't listen, it says why: allow the microphone in the browser's site settings, connect an input, or open Bandmate on `localhost` or over HTTPS, as for [recording](/song#record).

Tap a peg to hear its string's note, on the recorded guitar, and tap it again to hear it again. Each note is at A = 440 Hz, in the octave that string is tuned to: in Drop D, the low string plays the D below the low E. It's always a guitar, even with the piano picked for Chords.

Tapping a peg also holds the Tuner to that string: its peg fills in, and under the headstock it says **Held to** that string. While it's held, the Tuner measures what it hears against that string's note, however far off, rather than against the nearest string's. That's for changing to a tuning far from the one you're in, where a string can start nearer its neighbour's note than its own: in Drop C, the low E is nearer the 5th string's G than its own C. Tap the string you're tuning, and the cents count down to its note from wherever it is. Tap another peg to hold that string instead, or press **Release** to go back to the nearest string. Picking another tuning releases it too.

## Beats

The **Beats** page, in the side bar, is your Beat Library: the music you write to, kept in one place and used in any song.

<img src="@screenshots/beat-library-labelled.png" alt="The Beat Library, numbered 1 to 6 to match the list below it">

1. **Add a beat**: upload a file, or [download one from a link](#beats-from-a-link).
2. **Search and filter**: by title or producer, key, tempo, or whether a song uses it.
3. **A beat**: press ▶ to hear it.
4. **Its producer**, kept with the beat as its credit.
5. **The songs that use it.**
6. **Edit it**: its title, credit and details.

### Beats from a link

Paste a link to a video or track on YouTube, SoundCloud, Bandcamp or [any other site yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), and Bandmate adds its audio to your library, with the credit filled in.

- One video or track at a time, not playlists or live streams, up to 500 MB [unless you change it](/self-hosting#configuration).
- If a site stops working, press **Update** beside yt-dlp in **Settings → About**. You don't need to wait for a new Bandmate.

## What's next

Ideas for Bandmate's future are on the [roadmap](https://github.com/xKirtle/bandmate/blob/main/docs/roadmap.md), a wishlist: nothing on it is promised, and it isn't in the order things will be built. What each version added is in the [release notes](https://github.com/xKirtle/bandmate/releases).
