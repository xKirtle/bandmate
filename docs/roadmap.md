# Roadmap

Each step is usable on its own. Terms are defined in [CONTEXT.md](../CONTEXT.md).

1. **Write**: Songs and Status, Lyric Sheet (Sections, Labels, Occurrences, Detach, Alternates, Chords, Chord Lines), Scrapbook, paste-import (plain text or ChordPro; blank lines split Sections, identical Sections merge into one shared Section), phone-friendly layout for writing lyrics. Deployed at `bandmate.kirtle.net`.
2. **Listen**: Masters, Beat Library, Timeline with Tracks and Clips, playback, per-Track volume and mute.
3. **Record**: lossless WAV Takes stacked in Clips, Latency Offset calibration and per-Take nudge.
4. **Sync**: Cues via tap-to-sync and dragging, current Line highlighted during playback.
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
- On desktop the Timeline is a collapsible panel docked at the bottom of the Song page, under the Lyric Sheet. On phone it's playback only.
- Timeline edits and new Masters count as editing the Song (they move it up the Song list). Deleting a Song deletes its Masters and Timeline but never Beats.
- Stale tabs are guarded against: a tab refetches the Song when it becomes visible again, and every Song carries a version so a write based on an old version is rejected instead of silently overwriting newer work.

### 3. Record

- The browser mic requires HTTPS, which `bandmate.kirtle.net` already has. The user records through an audio interface, with headphones.
- Takes are lossless WAV (ADR 0003) and keep a frozen copy of their lyrics (ADR 0004).
- Recording starts at the playhead while the Timeline plays. If a Clip on the Track covers the playhead, the new Take stacks into it and becomes the active Take, and the Clip grows to fit the longest Take. Otherwise a new Clip is created there. For a separate idea at the same spot, use another Track.
- There's no comping: switching the active Take is the only way to choose between Takes. Inactive Takes are kept until deleted by hand, with a "clear inactive Takes" action per Clip. Nothing is deleted automatically.
- **Latency Offset**: a one-time calibration (play a click, record it, measure the delay) sets a global offset applied to every new Take. Each Take can then be nudged by hand.

### 4. Sync

- Cues point to Occurrences and Lines (ADR 0005). They're created by tapping along during playback (each key press cues the next Line in the Arrangement) or by clicking/dragging. An Occurrence gets its Cue from the Cue of its first Line.
- During playback the current Line is highlighted. Chords never carry a time: they're visible on the highlighted Line, nothing more.
- Songs without audio have no playback clock. Their Chords are purely positional.
- Reconsider undo/redo for Lyric Sheet structure (delete Section, Detach, reorder, switch Alternate, move to or from the Scrapbook). Step 2 only has undo for the Timeline, and in-field text relies on the browser's native undo. Undoing an Alternate switch would have to restore the line-level Cues it drops (ADR 0005), so this needs deciding alongside Cues, and weighed against Snapshots in step 5.

### 5. Keep

- **Snapshots** cover the whole Lyric Sheet. They're taken automatically (e.g. after a pause in editing, thinned out over time) and can be named by hand. Restoring one first snapshots the current Lyric Sheet, so a restore can always be undone.
- The **Mixdown** is rendered in the browser and exported as MP3. It ignores Masters and Scrapbook Sections.
- ChordPro export covers the Arrangement's active Alternates. Scrapbook Sections are excluded.
- Backups of the data folder are handled outside Bandmate by the homelab.

## Later

- Clip fx: fade in/out, gain, silence.
- Cues on Masters (lyrics highlighting along with a studio recording).
- Detecting a Beat's BPM and key from the audio itself.
- Real-time sync between open tabs or devices.
