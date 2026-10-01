# Roadmap

A wishlist of what Bandmate might do next, not a schedule or an order. Each idea is listed with any decisions already made, so the spec session for it starts from them. What's being built now is in the open issues, and once a feature ships it leaves this page, and its release notes record it. Terms are defined in [CONTEXT.md](../CONTEXT.md).

Each feature gets a spec, as an issue, before it's built. Using a new feature for real turns up fixes, and those come before the next feature starts.

## Rebinding Shortcuts

- Every Shortcut can be rebound, including the ones that follow a convention (the ruler's arrows, Shift+F10, Ctrl+wheel) and the mouse ones (the Alt in Alt+drag). Rebinding happens in the Song page's shortcuts dialog, and is kept per device, like the Latency Offset and the Input.
- Shortcuts are unique across the Song page, wherever each one works. A key already taken is refused, naming the Shortcut that has it ("Already used by Record"); nothing is swapped or unbound behind the user's back. "Reset to defaults" puts every Shortcut back.
- Some keys can't be chosen, and the dialog says so: Tab and Shift+Tab, Esc, a bare Enter or Space, and the browser's own shortcuts a page can't take (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab…). A Shortcut whose default is one of them can still be set back to it. Arrows can be taken, even from the controls that use them.
- A key is its exact modifiers: Shift+R isn't R. Ctrl on Windows and Linux and ⌘ on a Mac are one modifier, and either works everywhere. A Shift variant is a Shortcut of its own (seeking back 5 s and 15 s), so each is rebound on its own. Pinching always zooms, whatever Ctrl+wheel is rebound to.

## Snapshots

- **Snapshots** cover the whole Lyric Sheet. They're taken automatically (e.g. after a pause in editing, thinned out over time) and can be named by hand. Restoring one first snapshots the current Lyric Sheet, so a restore can always be undone.
- They're the way back from unwanted edits, since saving is automatic and Read mode only decides when editing is offered.
- The Lyric Sheet's structure (deleting a Section, reordering, switching an Alternate, moving to or from the Scrapbook) has no undo. With dormant Cues (ADR 0007) an Alternate switch is undone by switching back; whether Snapshots cover the rest, or it gets an undo of its own, is for this spec to decide.

## ChordPro export

- It covers the Arrangement's active Alternates. Scrapbook Sections are left out.

## Clip gain, fades and silence

- Per-Clip gain, fade in and out, and silencing a stretch of a Clip.

## A count-in or click

- From the Song's BPM, for recording without a Beat, so a Beat added later can line up.

## Cues on Masters

- The Line highlight following a studio recording, as it follows the Timeline.

## Detecting a Beat's BPM and key

- From the audio itself, to pre-fill the Beat's details at upload.

## A backup before migrating

- Copy the database before a release's migrations run, so rolling back never depends on remembering to take a backup first.

## Real-time sync between tabs and devices

- Today a tab refetches the Song when it becomes visible again, and a write based on an old version is rejected.

## Playback in step with what's heard

- Show the playhead, the Line highlight and Sync mode's "Now" where the audio is heard, by the output latency the browser reports. It's unnoticeable through an interface, but 150–250 ms late over Bluetooth. A tap test to correct it, only if the reported figure proves off.

## A tutorial

- A first-time walkthrough of Bandmate. It can be dismissed, and taken again whenever the user wants.
- It comes with a demo Song and Beat to work through, created when the user asks for them, from audio built into the binary. A migration would add them to every existing install on upgrade, and a Beat's audio is a file in the data directory, not a row, so SQL alone can't ship it. Created on request, a deleted demo can be added again. The Beat's audio needs a licence that allows shipping it.

## A keyboard icon on the shortcuts button

- The Song page's button that opens the shortcuts dialog shows a keyboard instead of "?", which says more plainly what it opens.

## Start and end buttons on the Timeline

- Buttons beside play/pause that move the playhead to the start or end of the Timeline, giving the mouse what Home and End do on the ruler. Their titles name those keys.

## A chords toggle on the Lyric Sheet's heading

- In Read mode, "Show chords" becomes a toggle button styled like the Timeline's Loop and Record, on the same row as the "Lyric Sheet" heading, instead of a checkbox below it.
- It's labelled "Chords". "ChordPro" would name the format that import reads and export will write, not what the button shows.

## How to play a Chord

- Show how to play the Lyric Sheet's Chords on a guitar, as Ultimate Guitar does: a fretboard diagram for each Chord the Song uses.
- Guitar only for now. Instruments are kept as data (strings, tuning, frets), so a ukulele or a bass can be added later without reworking the diagrams.
- Diagrams follow the Song's tuning and capo. A Chord name that can't be read gets no diagram rather than a guess. Which voicings are shown, how a diagram is reached (hovering a Chord, a strip above the sheet), and whether it works in Write mode too, are for the spec.

## A Chord Library

- A rough idea, built on the diagrams above. Pick a root and a quality (C major, D7sus2) and see how to play it, or place fingers on a fretboard and get the Chord's name.
- It might also suggest Chords that go well with the one picked, or with the Song's key, to help write a progression.
- What it covers, and where it lives (its own page, or beside the Lyric Sheet), are for the spec.
