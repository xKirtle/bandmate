# Bandmate

A personal songwriting companion: write and structure lyrics with chords, then record vocal takes over uploaded beats and line them up on a timeline to iterate on a song.

## Language

### Songs

**Song**:
The unit of work: one piece of music being written, with its Lyric Sheet, Timeline and metadata (key, BPM, capo, tuning, notes).
_Avoid_: Project, track (a Track is something else)

**Status**:
Where a Song stands in its lifecycle: idea, drafting, or finished.
_Avoid_: Stage, state

### Lyric Sheet

**Lyric Sheet**:
The written side of a Song: its Sections laid out in order by the Arrangement.
_Avoid_: Lyrics document, text

**Section**:
A block of Lines with an optional free-text Label; the same Section may appear multiple times in a Song.
_Avoid_: Block, part, stanza

**Label**:
The free-text name of a Section (e.g. "Chorus", "Verse 2", "Hook"); common labels are suggested but never enforced.
_Avoid_: Tag, section type

**Arrangement**:
The ordered list of Occurrences that makes up a Song's Lyric Sheet.
_Avoid_: Structure, layout

**Occurrence**:
One appearance of a Section in the Arrangement; several Occurrences can share one Section, so editing it changes all of them.
_Avoid_: Instance, copy

**Detach**:
Turning an Occurrence of a shared Section into its own independent Section, so it can diverge.
_Avoid_: Unlink, fork

**Scrapbook**:
A Song's collection of Sections that aren't in the Arrangement: leftovers and loose ideas kept for later.
_Avoid_: Trash, drafts, unused

**Alternate**:
One of several competing versions of a Section's Lines; exactly one Alternate is active at a time.
_Avoid_: Variant, option, draft

**Line**:
A single line of lyrics within an Alternate.
_Avoid_: Row, verse (a verse is a Label)

**Chord**:
A chord name anchored at a character position within a Line, possibly mid-word.
_Avoid_: Chord marker

**Chord Line**:
A Line that holds only Chords and no lyrics, used for intros, outros, solos and other instrumental passages.
_Avoid_: Chord bar, instrumental line

**Snapshot**:
A saved copy of the whole Lyric Sheet at a point in time, taken automatically or named by the user.
_Avoid_: Version, revision, backup

### Timeline

**Timeline**:
A Song's audio space, measured in seconds, where Tracks play together.
_Avoid_: Session, project, mix

**Track**:
A named lane on the Timeline (e.g. "Beat", "Lead vox", "Adlibs") holding Clips, with its own volume, mute and solo.
_Avoid_: Channel, layer

**Beat**:
An audio file in the user's Beat Library, carrying its own credit (producer, source link); a Song uses a Beat by placing it in a Clip.
_Avoid_: Instrumental, backing track, sample

**Beat Library**:
The user's collection of uploaded Beats, shared across all Songs.
_Avoid_: Beat store, uploads

**Take**:
One recording made in the app, keeping a frozen copy of the lyrics that were active when it was recorded.
_Avoid_: Recording, attempt

**Clip**:
A stretch of a Beat, or a set of Takes, placed at a position on a Track; the same Beat can be used by several Clips, and trimming a Clip never changes the audio file; a Clip with several Takes plays exactly one active Take.
_Avoid_: Region, segment

**Loop**:
A stretch of the Timeline that playback repeats, e.g. the hook of a Beat while writing over it; each Song keeps one, which can be switched on or off.
_Avoid_: Cycle, repeat, region

**Cue**:
A link from an Occurrence, or from one Line within an Occurrence, to a time on the Timeline. A Line's Cue lies dormant while its Alternate is inactive.
_Avoid_: Timestamp, sync point, marker

**Latency Offset**:
The delay between what the user heard and what the mic captured, measured once by calibration and adjustable per Take.
_Avoid_: Delay, lag

**Master**:
A finished recording of a Song made elsewhere (e.g. in a studio), attached to the Song as a result rather than placed on the Timeline. When a Song has several, each has a free-text name (e.g. "Radio edit", "Acoustic") and one is the **main Master**.
_Avoid_: Final, release, finished track, alternate master (an Alternate is something else)

**Mixdown**:
The Timeline rendered into a single audio file.
_Avoid_: Bounce, export, render
