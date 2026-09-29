# Bandmate

A personal songwriting companion: write and structure lyrics with chords, then record vocal takes over uploaded beats and line them up on a timeline to iterate on a song.

## Language

### Songs

**Song**:
The unit of work: one piece of music being written, with its Lyric Sheet, Timeline, Cover and metadata (key, BPM, capo, tuning, notes).
_Avoid_: Project, track (a Track is something else)

**Cover**:
A Song's picture, like a release's cover art: at most one per Song, shown wherever the Song is as a square the user chooses from the picture. It belongs to the Song, not to any Master.
_Avoid_: Artwork, image, album art, thumbnail

**Status**:
Where a Song stands in its lifecycle: idea, drafting, or finished.
_Avoid_: Stage, state

**Write mode**:
The Song page for working on the Song: its title, Status, Details, Lyric Sheet, Masters and Scrapbook can be edited. Idea and Drafting Songs open in it.

**Read mode**:
The Song page for playing from: the Song shows and its Masters play, but its content can't be edited, only the Timeline and how the Lyric Sheet shows. Finished Songs open in it.
_Avoid_: View mode, locked, preview

### Lyric Sheet

**Lyric Sheet**:
The written side of a Song: its Sections laid out in order by the Arrangement.
_Avoid_: Lyrics document, text

**Section**:
A block of Lines with an optional free-text Label; each Section appears at most once in a Song, so a chorus sung three times is three Sections.
_Avoid_: Block, part, stanza, Occurrence

**Label**:
The free-text name of a Section (e.g. "Chorus", "Verse 2", "Hook"); common labels are suggested but never enforced.
_Avoid_: Tag, section type

**Arrangement**:
The ordered list of Sections that makes up a Song's Lyric Sheet.
_Avoid_: Structure, layout

**Duplicate**:
Making an independent copy of a Section, with all its Alternates and the same one active, but none of its Cues, since the copy is sung at another time. Editing one never changes the other.
_Avoid_: Repeat, share, Detach

**Scrapbook**:
A Song's collection of Sections that aren't in the Arrangement: leftovers and loose ideas kept for later, in the order they came into it. A Section taken out of the Arrangement goes to its end, unless it has nothing written in any Alternate (no Lines, or only blank ones), in which case it's deleted instead, as there's nothing to keep; a Section made in the Scrapbook stays there even while it's still empty. An inactive Alternate can also be moved out of its Section, becoming a Section of its own, into the Scrapbook or straight into the Arrangement; a Scrapbook Section, or a Section in the Arrangement, can in turn be added to another Section in the Arrangement, its Alternates joining that Section's, inactive. Cues go wherever their Lines go: into the Scrapbook, back out of it, and into another Section.
_Avoid_: Trash, drafts, unused

**Alternate**:
One of several competing versions of a Section's Lines; exactly one Alternate is active at a time.
_Avoid_: Variant, option, draft

**Alternates mode**:
A way of choosing a Section's active Alternate, in Write mode: the Section shows every Alternate in full, read-only, to make one active, rename it, make a new one (an active copy of the active one), or move an inactive one out, to the Scrapbook or the Lyric Sheet, as a Section of its own, or delete it. It's where new Alternates are made, so it opens even when a Section has only one. Outside it, a Section shows only its active Alternate, and another can only be changed once it's made active.
_Avoid_: Compare view, picker

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
A Song's audio space, measured in seconds, where Tracks play together. It runs to its last Clip or last Cue, whichever is later, so a Timeline with Cues but no Clips still plays.
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

**Beat preview**:
Listening to a Beat from the Beat Library, outside any Song's Timeline.

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
A link from one Line to a time on the Timeline; a Line has at most one. A Section has no Cue of its own: it starts where its first Line is cued. A Line's Cue lies dormant while its Alternate is inactive, and stays with the Line wherever it goes: into the Scrapbook and back, or into another Section as an Alternate, where it's dormant until that Alternate is made active (and may then be out of order). A new Alternate starts with a copy of the Cues of the Alternate it was copied from; from then on, each keeps its own. A Duplicate starts with none. Playing from a Cue starts a second before it, to lead into it. Cues are expected to run in order down the Arrangement (equal times are fine); a Cue earlier than a Line above it or later than one below it is **out of order**, which is allowed but marked.
_Avoid_: Timestamp, sync point, marker

**Sync mode**:
A way of syncing a Song's Lines while the Timeline plays: as each Line starts, marking it "Now" cues it at the playhead, and the Line after it comes up next, cued or not, so a run of Lines can be retaken. Clicking a Line makes it the next one; with none clicked or just cued, the next one is the first Line without a Cue, or the first Line once every Line is cued. There's always a next Line. The Line playing is followed as usual, except that the next Line's own Cue is ignored until it's cued again, so the Line being retaken only becomes the one playing when it's marked "Now". Which Line is next never depends on where playback is, so playback can start anywhere, and playing from a Cue leaves the next Line where it is. Sync mode needs a Clip on the Timeline, and Sync mode and the Loop are never on together.
_Avoid_: Tap mode, record mode

**Latency Offset**:
The delay between what the user heard and what the mic captured, measured once by calibration and adjustable per Take.
_Avoid_: Delay, lag

**Master**:
A finished recording of a Song made elsewhere (e.g. in a studio), attached to the Song as a result rather than placed on the Timeline. When a Song has several, each has a free-text name (e.g. "Radio edit", "Acoustic") and one is the **main Master**.
_Avoid_: Final, release, finished track, alternate master (an Alternate is something else)

**Mixdown**:
The Timeline rendered into a single audio file.
_Avoid_: Bounce, export, render
