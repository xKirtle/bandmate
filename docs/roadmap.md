# Roadmap

A wishlist of what Bandmate might do next, not a schedule. Next is the one being designed or built now. The rest are rough ideas, listed with any decisions already made so the spec session for each one starts from them. Once a feature ships it leaves this page, and its release notes record it. Terms are defined in [CONTEXT.md](../CONTEXT.md).

Each feature gets a spec, as an issue, before it's built. Using a new feature for real turns up fixes, and those come before the next feature starts.

## Next

### Mixdowns

- The **Mixdown** is rendered in the browser, as WAV or MP3, of the whole Timeline, one Track, one Clip (from its menu) or the Loop's stretch. It ignores Masters, and a Clip's Mixdown is what it plays: trimmed, nudged, the active Take. Download Take already gives a Take's original file.
- Still open for its spec:
  - Does a Mixdown honour Track volume, mute and solo (and does a Clip's honour its Track's volume)?
  - Can the Loop's stretch be mixed down while the Loop is off?
  - Should Clip gain and fades (below) come first, or with it? A Mixdown is where a Clip's hard edges are heard, and adding fades later changes what a Mixdown renders.

## Wishlist

### Snapshots

- **Snapshots** cover the whole Lyric Sheet. They're taken automatically (e.g. after a pause in editing, thinned out over time) and can be named by hand. Restoring one first snapshots the current Lyric Sheet, so a restore can always be undone.
- They're the way back from unwanted edits, since saving is automatic and Read mode only decides when editing is offered.
- The Lyric Sheet's structure (deleting a Section, reordering, switching an Alternate, moving to or from the Scrapbook) has no undo. With dormant Cues (ADR 0007) an Alternate switch is undone by switching back; whether Snapshots cover the rest, or it gets an undo of its own, is for this spec to decide.

### ChordPro export

- It covers the Arrangement's active Alternates. Scrapbook Sections are left out.

### Clip gain, fades and silence

- Per-Clip gain, fade in and out, and silencing a stretch of a Clip.

### A count-in or click

- From the Song's BPM, for recording without a Beat, so a Beat added later can line up.

### Cues on Masters

- The Line highlight following a studio recording, as it follows the Timeline.

### Detecting a Beat's BPM and key

- From the audio itself, to pre-fill the Beat's details at upload.

### A backup before migrating

- Copy the database before a release's migrations run, so rolling back never depends on remembering to take a backup first.

### Real-time sync between tabs and devices

- Today a tab refetches the Song when it becomes visible again, and a write based on an old version is rejected.

### Playback in step with what's heard

- Show the playhead, the Line highlight and Sync mode's "Now" where the audio is heard, by the output latency the browser reports. It's unnoticeable through an interface, but 150–250 ms late over Bluetooth. A tap test to correct it, only if the reported figure proves off.
