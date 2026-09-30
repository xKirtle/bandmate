# Roadmap

A wishlist of what Bandmate might do next, not a schedule. Next is the one being designed or built now. The rest are rough ideas, listed with any decisions already made so the spec session for each one starts from them. Once a feature ships it leaves this page, and its release notes record it. Terms are defined in [CONTEXT.md](../CONTEXT.md).

Each feature gets a spec, as an issue, before it's built. Using a new feature for real turns up fixes, and those come before the next feature starts.

## Next

### Mixdowns

- A **Mixdown** is always of the Timeline, rendered in the browser, and sounds as playback would: every Track's volume, mute and solo as they are, and Clip effects once they exist. There's no Mixdown of one Track or one Clip; soloing a Track is how to hear it alone. It ignores Masters.
- **Range**: the whole Timeline, from 0:00 to where its last Clip ends (Cues don't extend it). When the Song has a Loop, the dialog also offers the Loop's stretch, e.g. "Loop (0:32–0:48)", pre-selected while the Loop is on, and offered while it's off. A Loop running past the last Clip gives silence there, as playback would.
- **Format**: one picker, remembered by the browser: WAV · 24-bit (the default), WAV · 16-bit, MP3 · 320, 192 or 128 kbps. Always stereo, at 48 kHz. The MP3 encoder is a dependency whose license fits AGPL-3.0.
- **Where**: a ⋯ menu in the transport row, at every width, holds Import audio…, Mix down… and Recording settings…. Play, the time, Loop, Record and the "Not calibrated" note stay in the row. On a phone, where the row is transport-only, the ⋯ holds just Mix down….
- Mix down… is disabled while the Timeline has no Clips ("Add a Beat, Sound or Take to mix down"), and while recording.
- **Rendering**: a modal dialog shows progress and Cancel, and asks not to leave or close the page; nothing else can be used meanwhile. Starting a render stops playback; Sync mode stays on. Leaving the Song page cancels it.
- **Result**: rendered faithfully, never normalised, and downloaded, never kept in Bandmate. It's named `{Song} - Mixdown.wav` (or `.mp3`), with the Loop's times added for the Loop's stretch. If it clips, or is silent (every Track muted, the Loop over an empty stretch), a note says so, and it downloads anyway.
- A Mixdown can be uploaded as a Master by hand; there's no "Save as Master".
- Not part of it: Clip gain and fades (below), and a Mixdown of each Track as stems.

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
