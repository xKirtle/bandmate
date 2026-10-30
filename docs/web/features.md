# Songs, Chords and Beats

A reference for the pages in Bandmate's side bar: look up the part you're stuck on. What you do with a song open is on [Inside a song](/song), and Settings, keyboard shortcuts and Backups on [a page of their own](/settings).

## Your songs

Every song is in one list. Search it by title, filter it by status, tag or whether a song has a finished recording, and sort it by title, status, key, tempo or when you last edited it.

<img src="@screenshots/song-list.png" alt="The Songs page: two folders, then the songs in neither, each with its status, key and tempo">

- **Folders** keep songs together, like an EP's. A song sits in one folder at most: drag it onto a folder, or move it from its menu. Deleting a folder asks whether to keep its songs or delete them too.
- **Tags** mark songs with whatever matters to you, like "Album 2023", and a song can have as many as you like. Pick several in the filter to see the songs that have all of them.

## Chords

The **Chords** page, in the side bar, helps with chords away from any song, on guitar, in standard tuning or any other, or on piano. Pick one under **Instrument**; that device remembers it, and Read mode shows chords on it too. Switch it here, in Read mode's reading options, or in Settings.

<img src="@screenshots/chords-look-up.png" alt="Look up showing Cmaj7: its notes, then its shapes as chord diagrams, best first">

- **Look up** a chord by name, like Cmaj7 or D/F#. Press the speaker to hear a Voicing strummed on a recorded nylon-string guitar, in the tuning you picked: each note is recorded on its own string, so the same chord played up the neck sounds as it would there. Prefer one, and that's the shape Read mode shows you.
- **Name it**: put your fingers on the fretboard, or press keys on the piano, and Bandmate tells you which chord you're playing, reading the lowest note as the bass. Press the speaker to hear it, even if it isn't a chord.
- **Suggest**: pick a key — a tonic and major or minor, or type it — and see the chords that belong in it, the ones borrowed from other keys, and what usually comes after a chord. Each one shows a way to play it: the one you prefer, or else the best. Press the speaker to hear it strummed. **More Voicings** opens it in Look up, with the other ways.
- The rising bars arpeggiate the shape: they play it one string at a time, low to high, so you can hear each note.
- On guitar, the copy button beside a shape copies it the way you [write it in a song](/song#how-you-play-a-chord), brackets and all, like `[Em:x-0-9-9-x-x]`: paste it straight into a line in Write mode. In Name it, each name your shape reads as has its own, so copy the one you want. The frets are for the tuning picked here, so paste it into a song in that tuning.
- If the guitar can't load, a message in the corner says it couldn't be heard; press the speaker again to try again.
- Left-handed? Turn it on in Settings, under **This device**, and every diagram flips, the fretboard too.

On piano, each way to play a chord is drawn as the keys from C3 to C5, the ones to press coloured and marked with a dot: root position and each inversion, for one hand, around middle C. A slash chord like C/G starts with the inversion that has its bass lowest, then plays the bass under the others with your left hand. Prefer one, and it comes first in Look up and is the one Suggest shows; it's kept apart from the shapes you prefer on guitar. The speaker plays the keys together, on a recorded grand piano. If the piano can't load, a message in the corner says it couldn't be heard; press the speaker again to try again. In Name it, tap a key to press it and again to let it go, or use the arrow keys and Space. The piano doesn't flip for left-handed playing.

## Beats

The **Beats** page, in the side bar, is your Beat Library: the music you write to, kept in one place and used in any song.

<img src="@screenshots/beat-library-labelled.png" alt="The Beat Library, numbered 1 to 6 to match the list below it">

1. **Add a beat**: upload a file, or [download one from a link](#beats-from-a-link).
2. **Search and filter**: by title or producer, key, tempo, or whether a song uses it.
3. **A beat**: press ▶ to hear it.
4. **Its producer**, kept with the beat as its credit.
5. **The songs that use it.**
6. **Edit it**: its title, credit and details.

You can also attach a song's finished recordings, made elsewhere, to listen back to.

### Beats from a link

Paste a link to a video or track on YouTube, SoundCloud, Bandcamp or [any other site yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), and Bandmate adds its audio to your library, with the credit filled in.

- One video or track at a time, not playlists or live streams, up to 500 MB [unless you change it](/self-hosting#configuration).
- If a site stops working, press **Update** beside yt-dlp in **Settings → About**. You don't need to wait for a new Bandmate.

## What's next

Ideas for Bandmate's future are on the [roadmap](https://github.com/xKirtle/bandmate/blob/main/docs/roadmap.md), a wishlist: nothing on it is promised, and it isn't in the order things will be built. What each version added is in the [release notes](https://github.com/xKirtle/bandmate/releases).
