# Roadmap

Each step is usable on its own. Terms are defined in [CONTEXT.md](../CONTEXT.md).

1. **Write**: Songs and Status, Lyric Sheet (Sections, Labels, Duplicate, Alternates, Chords, Chord Lines), Scrapbook, paste-import (plain text or ChordPro; Sections start only at a heading or a ChordPro directive, a heading on its own duplicates the last Section with that Label, timestamps become Cues, ChordPro directives fill in the Details), phone-friendly layout for writing lyrics.
2. **Listen**: Masters, Beat Library, Timeline with Tracks and Clips, playback, per-Track volume and mute.
3. **Sync**: Cues via Sync mode and the Cue gutter, current Line highlighted during playback.
   - **Desktop layout** (between Sync and Record): a full-width shell, a two-column Song page, and sortable, filterable Song and Beat lists. Spec: issue #97.
4. **Record**: lossless WAV Takes stacked in Clips, Latency Offset calibration and per-Take nudge.
5. **Mix**: Mixdowns of the whole Timeline, a Track, a Clip or the Loop's stretch, as WAV or MP3.
6. **Keep**: Snapshots and restore, ChordPro export.

## Decided so far

Decisions made while designing, recorded so later spec sessions start from them. Step 1's full spec is issue #1.

### 2. Listen

- A **Master** is a finished recording made elsewhere, attached to the Song, never placed on the Timeline or included in the Mixdown. A Song can have several Masters. The page is designed for one: a free-text name and a "main" marker only appear once there's a second (they're all Masters, never "alternate masters"). A Master has its own waveform, a simple player, optional notes and a download of the original file. The Song list gets a "has a Master" filter, separate from Status. Adding a Master may suggest setting Status to finished but never forces it.
- Beats are uploaded audio files (no fetching from YouTube or elsewhere). The **Beat Library** is shared across Songs. Credit (producer, source link) sits on the Beat, not the Song. A Beat can't be deleted while a Song uses it.
- There are no song "modes" (beatless vs. with a beat). Every Song can have Chords and a Timeline, and the UI adapts: an empty Timeline (no Clips and no Cues) collapses to a slim "add a beat / record" bar. The Timeline runs to its last Clip or last Cue, whichever is later, so a Song with Cues but no audio still plays.
- The Timeline is measured in seconds. No BPM grid or snapping in v1. Clips on one Track never overlap.
- Audio is served with HTTP Range support so seeking works.
- Audio files live on disk in the data folder, named by id, with metadata in SQLite. Uploads keep their original format, are accepted if the browser can decode them, and have a size cap (500 MB by default, configurable).
- Waveform peaks and duration are computed in the browser at upload and stored alongside the file, so the Timeline draws before audio finishes decoding.
- A Beat carries a title, producer, source link, BPM, key and notes (only the title is required). At upload they're pre-filled from the file's tags, falling back to its filename, for the user to confirm. Adding a Beat to a Song with no BPM offers to copy the Beat's. A Beat's file can only be replaced while no Song uses it.
- The Timeline plays decoded buffers on one Web Audio clock (ADR 0006). Masters and Beat previews use plain `<audio>`. Only one thing plays at a time, and leaving the Song page stops playback.
- Clips can be trimmed at both edges without touching the file, and one Beat can appear in several Clips. Dragging or trimming a Clip into a neighbour stops at its edge. For layering, use another Track.
- A Song starts with no Tracks. A new Beat is appended after the last Clip on the topmost Track that already holds a Beat, or on a new "Beat" Track. Tracks carry no kind.
- Each Track has a volume from silence to +6 dB, mute and solo. Each Song keeps one **Loop**, saved with the Song.
- Timeline edits have session-scoped undo/redo (buttons and Ctrl+Z / Ctrl+Shift+Z), so deleting a Clip or Track needs no confirmation. Keyboard shortcuts (space, undo) only apply outside text fields.
- On desktop the Timeline is a collapsible panel docked at the bottom of the Song page, under the Lyric Sheet. On phone it's playback only: just the transport row (Play/Pause, the time, and the Loop toggle once there's a Loop), with no ruler, Tracks or Track controls. Playback still uses each Track's saved volume, mute and solo, and a saved Loop.
- Timeline edits and new Masters count as editing the Song (they move it up the Song list). Deleting a Song deletes its Masters and Timeline but never Beats.
- Stale tabs are guarded against: a tab refetches the Song when it becomes visible again, and every Song carries a version so a write based on an old version is rejected instead of silently overwriting newer work.

### 3. Sync

Cues:

- Cues point to a Line (ADRs 0005, 0009 and 0010). They're created in Sync mode or typed into the Cue gutter. They never go into the Line text.
- Any non-blank Line can take a Cue, Chord Lines included.
- Only Lines are cued: a Section has no Cue of its own, and starts where its first Line is cued (ADR 0009). A placeholder Line such as `[Intro]` places a Section with no words.
- Switching a Section's Alternate leaves the inactive Alternate's line-level Cues dormant, not cleared (ADR 0007). Switching back brings them back.
- Cues go wherever their Lines go (ADR 0010): moving a Section to the Scrapbook keeps them and bringing it back revives them, and a Section or Alternate added to another Section brings its Cues along, dormant. Deleting a Line or Section drops its Cues. A Duplicate starts with none.
- Cues are Timeline times and don't follow Clips on their own. After a Clip is moved with Cues inside its span, a prompt offers to move those Cues with it; ignoring it leaves them in place. Before Takes, Cues usually belong with the Beat; after, with the vocal, so no automatic rule would be right.
- Cue edits (Sync mode, typing in the gutter, moving with a Clip, clearing) join the Timeline's undo history. "Clear this Section's Cues" sits in the Section's actions, "Clear all Cues" beside the Sync mode toggle; neither asks for confirmation.
- **Shift Cues**: − and + beside "Clear all Cues" move every Cue in the Song earlier or later by a step of 1 s, 0.5 s or 0.1 s (the browser remembers the step). Dormant Cues move too. Each click is saved at once and is one step of undo. It changes the Cues' times rather than storing an offset, so a time is never ambiguous; − is disabled when it would take a Cue before 0:00. Import's `{offset:}` goes the same way: positive is later.

Editing:

- **Cue gutter**: a narrow column beside each Section's Lines, in Write mode only, shows each Line's Cue. Click a time to type one; the ✕ after it (on hover of the Line or focus in its gutter) clears it, as does emptying the field; Alt+↑/↓ nudges it by 0.1 s. Enter saves and moves to the next Line, Esc cancels. A ▶ beside each Cue starts playback a second before it (never before 0:00), to lead into it, or jumps there if it's playing already; it never pauses, so Space stays the only play/pause toggle. Seeking on the ruler and scrubbing stay exact and don't start playback. There's no Cue lane on the Timeline.
- The gutter appears once the Timeline has a Clip or the Song has any Cue; phone never shows it. Read mode has no gutter: it's for following a sync (the highlight, click-to-play), Write mode for making one.
- Cue times read `m:ss.s` and are stored to the millisecond. Typing accepts `45`, `0:45`, `0:45.25` or `1:02`; negative times are rejected, times past the last Clip are fine.
- A Cue out of order (earlier than the nearest cued Line above it, or later than the nearest below, down the whole Arrangement; equal times are fine) is allowed but marked in the gutter: a ⚠ in a warning colour, with the reason on hover and for screen readers, e.g. "Later than Line 6 of Chorus (0:55.0)". Both Cues of the pair are marked; fixing either clears both. Dormant Cues are ignored. There's no fix action: retake the Line, edit its time or clear it.
- **Sync mode** ("Sync lyrics"): a toggle in the Lyric Sheet's header, in Write mode on wider screens once the Timeline has a Clip, with "Clear all Cues" beside it. Nothing to do with syncing lives on the Timeline. While it's on, the Line up next is marked only by its gutter slot becoming a **Now** button, and the Line playing has the same highlight as in Read mode; Now or Enter cues it at the playhead, playing or paused, and the Line after it comes up, cued or not, so a run of Lines can be retaken. Clicking a Line or its Cue's time makes it the next one, while its ▶ only plays and leaves the next Line where it is; with none clicked or just cued (as Sync mode comes on, or after the last Line), it's the first Line without a Cue, or the first Line of the Arrangement once every Line is cued. The next Line never depends on where playback is, so playback can start anywhere, and its old Cue is ignored when following playback until it's cued again. Text boxes are read-only while it's on, so clicks and Enter aren't typing. It always skips Chord Lines (they can still be typed in the gutter). Re-cueing a Line replaces its Cue and leaves later Cues alone.
- Sync mode and the Loop are exclusive: switching one on switches the other off.

Playback:

- During playback the current Line is highlighted. Chords never carry a time: they're visible on the highlighted Line, nothing more.
- The current Line is the one whose active Cue is the latest at or before the playhead. The highlight follows time, not the Arrangement, so reordering after syncing can make it jump. A Line stays highlighted until the next Cue; instrumental breaks are written as Lines of their own (e.g. "♪ ♪ ♪") and cued like any other. Nothing is highlighted before the first Cue.
- The highlight shows in both Read and Write mode, per Line (in Write mode, behind the text box). The Lyric Sheet scrolls to follow it, except while the cursor is in a text box. This is the least certain decision here and may change during implementation.
- Clicking a cued Line in Read mode plays from it, leading in like the gutter's ▶; in Write mode a click only places the cursor, and the gutter's ▶ plays instead. On phone there's the highlight and click-to-play, but no Cue editing.
- Songs without audio have no playback clock. Their Chords are purely positional.
- Undo for Lyric Sheet structure (delete Section, reorder, switch Alternate, move to or from the Scrapbook) is not part of Sync. With dormant Cues (ADR 0007) an Alternate switch is undone by switching back; whether Snapshots cover the rest is decided in step 6.

### Desktop layout

- Desktop is a window at least 80rem (1280px) wide. Width alone decides layout and sizing: touch-sized below, compact above. Phones and tablets keep today's layout.
- On desktop the app fills the window, with a nav rail for Songs and Beats, instead of a centered column.
- The Song page has two columns: the Lyric Sheet at a readable width, and a side column that grows into the spare width (up to about a Section's width, never below 22rem). In Write mode the side column holds the Scrapbook, with Masters collapsed beneath it; in Read mode, Masters. The Timeline dock spans both. The three panes first planned were dropped after prototyping, as a left pane squeezed the Lyric Sheet at real window sizes (#100).
- The Song's Details (Key, BPM, Capo, Tuning, with Notes behind a toggle) sit in a strip in the title block at every width. Delete Song is at the top right, beside the title. Below 80rem the page is one column: the title block, the Lyric Sheet, the Scrapbook, Masters, then Delete Song.
- The Song list and Beat Library are sortable tables on desktop. Beats can be filtered by producer, BPM range, key and used/unused, in the Library and the Beat picker. List filters and sorting live in the URL.
- The exact look is settled by prototyping before implementation (issue #97).
- **Read mode** covers the whole Song page, with one Read/Write toggle for it, not just the Lyric Sheet. In Read mode nothing can be edited: the title and Status only show, the Details strip shows as one line of text (e.g. "C#m · 92 BPM · Capo 2 · Standard") with the Notes behind their toggle, and Masters only play. The Scrapbook and Delete aren't shown. The Timeline is unchanged. Saving stays automatic; Read mode is about when editing is offered, and Snapshots are the way back from unwanted edits.
- Finished Songs open in Read mode, Idea and Drafting Songs in Write mode. Switching lasts for the visit only and is never saved. Marking a Song Finished doesn't switch the page to Read; it opens in Read from the next visit. To reopen a Finished Song, switch to Write, then change its Status.

### 4. Record

- The browser mic requires HTTPS, which the reverse proxy already provides (ADR 0002). The user records through an audio interface, with headphones.
- Takes are lossless WAV (ADR 0003). They hold no lyrics (ADR 0011): a Take is audio on the Timeline, and Cues are the only link to the Lyric Sheet.
- **Record appends**, as in Audacity: the new Take starts a new Clip where the chosen Track's last Clip ends (Beat Clips included), or at 0:00 on an empty Track, so it never runs into another Clip. The playhead doesn't decide where a Take goes. Recording with the Beat's Track chosen puts the Take after the Beat, over silence; that's left as is, since it teaches adding a Track of your own.
- **Retake**, on a Clip of Takes, records a new Take into it from the Clip's start. It becomes the active Take, and the Clip grows to fit its longest Take, up to the next Clip's start (audio past that is kept, hidden). Retake is the only way Takes stack. There's no punch-in mid-Clip: to fix one Line, retake the Clip or record it on another Track.
- Both lead in: playback starts 2 s before the Take (never before 0:00), and what's sung then is kept, hidden behind the Clip's start.
- Recording and playback are exclusive: Record and Retake are only offered while the Timeline is stopped. A recording always plays whatever the Timeline holds, even nothing, and runs on past its end until Record is pressed again or Space; plain playback still stops at the end.
- A Take goes to the **chosen Track**. As in Audacity, while the Timeline has Tracks exactly one is chosen: clicking a Track's header or any Clip on it chooses it. The browser remembers the choice per Song; the first time, it's the bottom Track. A Track added with "Add a track" becomes the chosen one; the "Beat" Track a first Beat creates doesn't, unless it's the only Track. Deleting the chosen Track chooses the bottom one. With no Tracks at all, Record first adds one the same way "Add a track" does. A Take never moves to another Track on its own.
- Clips still never overlap, recording included. Tracks are heard summed, honouring volume, mute and solo, as in step 2. To hear two recordings at once, put them on separate Tracks.
- There's no comping: switching the active Take is the only way to choose between Takes. Inactive Takes are kept until deleted by hand, with a "clear inactive Takes" action per Clip. Nothing is deleted automatically.
- **Latency Offset**: the full round trip (the Beat reaching the ears, then the voice reaching the file). A calibration sets it per device: the user taps or claps on the mic along with a click some 8–16 times, and the hits are found in the recording, stray ones dropped and the rest averaged. Tapping a key wouldn't do, as it skips the mic's half. The offset is kept in the browser, since it belongs to the hardware chain. It's applied to every new Take recorded there, and each Take keeps the offset it got, so recalibrating never moves old Takes. Each Take can then be nudged by hand: typed in milliseconds in the Take's menu (Alt+←/→ steps 1 ms, with Shift 10 ms), or by Alt+dragging the Clip, which slides its active Take while the Clip stays put.
- Calibration is offered before a device's first recording and can be skipped, saying where to run it again later. Until it's done, the offset is whatever latency the browser reports, and a "not calibrated" note shows beside Record.
- **Takes in a Clip** are numbered ("Take 3") in recording order, never reusing a number. The Clip's menu lists them, the active one marked, and choosing one makes it active. Deleting the active Take makes the most recent remaining one active; deleting the last Take deletes the Clip. Retake starts at the Clip's start as trimmed.
- **Input**: a device and input channel picker (e.g. "Scarlett 2i2 · Input 1") with a live level meter, remembered per device. The browser's echo cancellation, noise suppression and auto gain are always off.
- **What's heard**: the app never plays the mic back (the interface monitors directly; a browser would add delay). During a Retake, the Clip being retaken is silent.
- The Loop is for playback: a recording ignores it, and it stays on. Sync mode and recording are exclusive.
- A Take is kept in the browser's storage while recording and until the server confirms its upload, so a crashed tab or failed upload is offered back on the next visit.
- Recording, Retake, deleting a Take, "clear inactive Takes" and nudging all join the Timeline's undo history, so none asks for confirmation. A removed Take's file is swept from disk later, once no undo could bring it back.
- The highlighted Line from Sync prompts the user while recording. Cues can be synced roughly against the Beat first and refined once a real vocal exists.
- The highlight always follows the current Lyric Sheet and Cues, so a Take recorded before the lyrics changed simply goes out of date.
- Recording never needs a Beat: a reference vocal can be recorded on an empty Timeline. Step 2's empty Timeline only offers "add a beat". This step adds "record" next to it, as the Step 2 decisions above already describe.
- Record and Retake show wherever the full Timeline does, at any width above the transport-only one (so a phone held sideways can record too). There's nothing phone-specific: the browser APIs are the same, and a Take that comes out of sync is what the Latency Offset and nudge are for.
- A Clip's actions are in its menu, opened by right-click, the Menu key or Shift+F10, the ⋯ in its header (which replaces today's ⧉ and ×), or on touch a long press (a finger held still; one that moves drags as before). A Clip of Takes adds Retake, its Takes to choose from, Nudge, Clear inactive Takes and Download Take, which gives the active Take's original WAV, untouched.
- The empty Timeline stays the slim bar, with "Record" beside "Add a beat". Record there opens the Timeline, adds a Track and starts recording at once, after any first-time setup.

### 5. Mix

- The **Mixdown** is rendered in the browser, as WAV or MP3, of the whole Timeline, one Track, one Clip (from its menu) or the Loop's stretch. It ignores Masters, and a Clip's Mixdown is what it plays: trimmed, nudged, the active Take. Downloading a Take's original file is step 4's.
- Still open for this step's spec: whether a Mixdown honours Track volume, mute and solo (and a Clip's, its Track's volume), and whether the Loop's stretch can be mixed down while the Loop is off.

### 6. Keep

- **Snapshots** cover the whole Lyric Sheet. They're taken automatically (e.g. after a pause in editing, thinned out over time) and can be named by hand. Restoring one first snapshots the current Lyric Sheet, so a restore can always be undone.
- ChordPro export covers the Arrangement's active Alternates. Scrapbook Sections are excluded.
- Backups of the data folder are handled outside Bandmate by the homelab.

## Later

- Clip fx: fade in/out, gain, silence.
- Cues on Masters (lyrics highlighting along with a studio recording).
- Detecting a Beat's BPM and key from the audio itself.
- A count-in or click from the Song's BPM, for recording without a Beat so a Beat added later can line up.
- Real-time sync between open tabs or devices.
- Show the playhead, the Line highlight and Sync mode's "Now" where the audio is heard, by the output latency the browser reports. Unnoticeable through an interface, but 150–250 ms late over Bluetooth. A tap test to correct it only if the reported figure proves off.
