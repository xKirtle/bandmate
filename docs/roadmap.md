# Roadmap

Each step is usable on its own. Terms are defined in [CONTEXT.md](../CONTEXT.md).

1. **Write**: Songs and Status, Lyric Sheet (Sections, Labels, Occurrences, Detach, Alternates, Chords, Chord Lines), Scrapbook, paste-import (plain text or ChordPro; blank lines split Sections, identical Sections merge into one shared Section), phone-friendly layout for writing lyrics.
2. **Listen**: Masters, Beat Library, Timeline with Tracks and Clips, playback, per-Track volume and mute.
3. **Sync**: Cues via Sync mode and the Cue gutter, current Line highlighted during playback.
   - **Desktop layout** (between Sync and Record): a full-width shell, a three-pane Song page, and sortable, filterable Song and Beat lists. Spec: issue #97.
4. **Record**: lossless WAV Takes stacked in Clips, Latency Offset calibration and per-Take nudge.
5. **Keep**: Snapshots and restore, Mixdown to MP3, ChordPro export.

## Decided so far

Decisions made while designing, recorded so later spec sessions start from them. Step 1's full spec is issue #1.

### 2. Listen

- A **Master** is a finished recording made elsewhere, attached to the Song, never placed on the Timeline or included in the Mixdown. A Song can have several Masters. The page is designed for one: a free-text name and a "main" marker only appear once there's a second (they're all Masters, never "alternate masters"). A Master has its own waveform, a simple player, optional notes and a download of the original file. The Song list gets a "has a Master" filter, separate from Status. Adding a Master may suggest setting Status to finished but never forces it.
- Beats are uploaded audio files (no fetching from YouTube or elsewhere). The **Beat Library** is shared across Songs. Credit (producer, source link) sits on the Beat, not the Song. A Beat can't be deleted while a Song uses it.
- There are no song "modes" (beatless vs. with a beat). Every Song can have Chords and a Timeline, and the UI adapts: an empty Timeline collapses to a slim "add a beat / record" bar.
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
- On desktop the Timeline is a collapsible panel docked at the bottom of the Song page, under the Lyric Sheet. On phone it's playback only: just the transport row (Play/Pause, the time, the collapse toggle, and the Loop toggle once there's a Loop), with no ruler, Tracks or Track controls. Playback still uses each Track's saved volume, mute and solo, and a saved Loop.
- Timeline edits and new Masters count as editing the Song (they move it up the Song list). Deleting a Song deletes its Masters and Timeline but never Beats.
- Stale tabs are guarded against: a tab refetches the Song when it becomes visible again, and every Song carries a version so a write based on an old version is rejected instead of silently overwriting newer work.

### 3. Sync

Cues:

- Cues point to Occurrences and Lines (ADR 0005). They're created in Sync mode or typed into the Cue gutter. They never go into the Line text: that text is shared by every Occurrence of a Section, and each Occurrence is sung at its own time.
- Any non-blank Line can take a Cue, Chord Lines included.
- An Occurrence's Cue is stored in its own right. Cueing its first Line sets it, and while both exist they show and change together. It stays when that Line's Cue goes away, and can be set on its own to give a Section a rough start without syncing its Lines.
- Switching a Section's Alternate leaves the inactive Alternate's line-level Cues dormant, not cleared (ADR 0007). Switching back brings them back.
- Removing an Occurrence (deleting it or moving its Section to the Scrapbook) drops its Cues. Bringing the Section back makes a new Occurrence with none.
- Cues are Timeline times and don't follow Clips on their own. After a Clip is moved with Cues inside its span, a prompt offers to move those Cues with it; ignoring it leaves them in place. Before Takes, Cues usually belong with the Beat; after, with the vocal, so no automatic rule would be right.
- Cue edits (Sync mode, typing in the gutter, moving with a Clip, clearing) join the Timeline's undo history. "Clear this Occurrence's Cues" sits in the Occurrence's actions, "Clear all Cues" beside the Sync mode toggle; neither asks for confirmation.

Editing:

- **Cue gutter**: a narrow column beside each Occurrence's Lines, in Write mode only, shows each Line's Cue; the Occurrence's own Cue sits on its Section's header row. Click a time to type one, clear it to remove it, Alt+↑/↓ nudges it by 0.1 s. Enter saves and moves to the next Line, Esc cancels. A ▶ beside each Cue moves the playhead there, playing on if it was playing. There's no Cue lane on the Timeline.
- The gutter appears once the Timeline has a Clip or the Song has any Cue; phone never shows it. Read mode has no gutter: it's for following a sync (the highlight, click-to-seek), Write mode for making one.
- Cue times read `m:ss.s` and are stored to the millisecond. Typing accepts `45`, `0:45`, `0:45.25` or `1:02`; negative times are rejected, times past the last Clip are fine.
- **Sync mode** ("Sync lyrics"): a toggle in the Lyric Sheet's header, in Write mode on wider screens once the Timeline has a Clip, with "Clear all Cues" beside it. Nothing to do with syncing lives on the Timeline. While it's on, the Line up next is outlined and its gutter slot becomes a **Now** button; Now or Enter cues it at the playhead, playing or paused, and the next Line comes up. The next Line is the one after the current highlight, in on-screen order, or the first Line of the Arrangement; clicking a Line makes it the next one. Text boxes are read-only while it's on, so clicks and Enter aren't typing. It always skips Chord Lines (they can still be typed in the gutter). Re-cueing a Line replaces its Cue and leaves later Cues alone. Each Occurrence of a shared Section is synced separately. After the last Line, Sync mode stays on with nothing up next, so an earlier Line can still be clicked and redone.
- Sync mode and the Loop are exclusive: switching one on switches the other off.

Playback:

- During playback the current Line is highlighted. Chords never carry a time: they're visible on the highlighted Line, nothing more.
- The current Line is the one whose active Cue is the latest at or before the playhead. If that Cue is an Occurrence's and its Lines have none, the whole Section is highlighted. The highlight follows time, not the Arrangement, so reordering after syncing can make it jump. A Line stays highlighted until the next Cue; instrumental breaks are written as Lines of their own (e.g. "♪ ♪ ♪") and cued like any other. Nothing is highlighted before the first Cue.
- The highlight shows in both Read and Write mode, per Line (in Write mode, behind the text box). The Lyric Sheet scrolls to follow it, except while the cursor is in a text box. This is the least certain decision here and may change during implementation.
- Clicking a cued Line in Read mode seeks the playhead to it; in Write mode a click only places the cursor, and the gutter's ▶ seeks instead. On phone there's the highlight and click-to-seek, but no Cue editing.
- Songs without audio have no playback clock. Their Chords are purely positional.
- Undo for Lyric Sheet structure (delete Section, Detach, reorder, switch Alternate, move to or from the Scrapbook) is not part of Sync. With dormant Cues (ADR 0007) an Alternate switch is undone by switching back; whether Snapshots cover the rest is decided in step 5.

### Desktop layout

- Desktop is a window at least 80rem (1280px) wide. Width alone decides layout and sizing: touch-sized below, compact above. Phones and tablets keep today's layout.
- On desktop the app fills the window, with a nav rail for Songs and Beats, instead of a centered column.
- The Song page has three panes: the Song's details, Notes and Masters on the left, the Lyric Sheet at a readable width in the centre, the Scrapbook on the right. The Timeline dock spans all three.
- The Song list and Beat Library are sortable tables on desktop. Beats can be filtered by producer, BPM range, key and used/unused, in the Library and the Beat picker. List filters and sorting live in the URL.
- The exact look is settled by prototyping before implementation (issue #97).

### 4. Record

- The browser mic requires HTTPS, which the reverse proxy already provides (ADR 0002). The user records through an audio interface, with headphones.
- Takes are lossless WAV (ADR 0003) and keep a frozen copy of their lyrics (ADR 0004).
- Recording starts at the playhead while the Timeline plays. If a Clip on the Track covers the playhead, the new Take stacks into it and becomes the active Take, and the Clip grows to fit the longest Take. Otherwise a new Clip is created there. For a separate idea at the same spot, use another Track.
- There's no comping: switching the active Take is the only way to choose between Takes. Inactive Takes are kept until deleted by hand, with a "clear inactive Takes" action per Clip. Nothing is deleted automatically.
- **Latency Offset**: a one-time calibration (play a click, record it, measure the delay) sets a global offset applied to every new Take. Each Take can then be nudged by hand.
- The highlighted Line from Sync prompts the user while recording. Cues can be synced roughly against the Beat first and refined once a real vocal exists.
- A Take freezes its lyrics but not Cues. The highlight always follows the current Lyric Sheet and Cues, so a Take recorded before the lyrics changed simply goes out of date.
- Recording never needs a Beat: a reference vocal can be recorded on an empty Timeline. Step 2's empty Timeline only offers "add a beat". This step adds "record" next to it, as the Step 2 decisions above already describe.
- Still open for this step's spec: what an empty Timeline shows (the slim bar whose Record button opens the Timeline, or the full Timeline always), how far the playhead runs when there's no audio or it's recording past the last Clip (today playback stops at the Timeline's end), and which Track a first recording lands on when the Song has none.

### 5. Keep

- **Snapshots** cover the whole Lyric Sheet. They're taken automatically (e.g. after a pause in editing, thinned out over time) and can be named by hand. Restoring one first snapshots the current Lyric Sheet, so a restore can always be undone.
- The **Mixdown** is rendered in the browser and exported as MP3. It ignores Masters and Scrapbook Sections.
- ChordPro export covers the Arrangement's active Alternates. Scrapbook Sections are excluded.
- Backups of the data folder are handled outside Bandmate by the homelab.

## Later

- Clip fx: fade in/out, gain, silence.
- Cues on Masters (lyrics highlighting along with a studio recording).
- Detecting a Beat's BPM and key from the audio itself.
- A count-in or click from the Song's BPM, for recording without a Beat so a Beat added later can line up.
- Real-time sync between open tabs or devices.
