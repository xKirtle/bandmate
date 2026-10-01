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
A named lane on the Timeline (e.g. "Beat", "Lead vox", "Adlibs") holding Clips, with its own volume, mute and solo. Turning its volume all the way down makes it quiet, never silent: silencing a Track is what muting it is for. A Timeline always has at least one Track: a Song starts with one, and the last Track can't be deleted.
_Avoid_: Channel, layer

**Chosen Track**:
The Track a recording, or a Beat or Sound being added, goes to. Exactly one Track is always chosen.
_Avoid_: Selected track (selecting is for Clips), armed track

**Beat**:
An audio file in the user's Beat Library, carrying its own credit (producer, source link); a Song uses a Beat by placing it in a Clip.
_Avoid_: Instrumental, backing track, sample

**Beat Library**:
The user's collection of uploaded Beats, shared across all Songs.
_Avoid_: Beat store, uploads

**Beat Picker**:
Where a Beat is chosen from the Beat Library, or uploaded into it, to place on the Chosen Track.
_Avoid_: Beat dialog, Beat modal

**Beat preview**:
Listening to a Beat from the Beat Library, outside any Song's Timeline.

**Sound**:
An audio file imported into one Song, placed on the Timeline in Clips like a Beat, but without a credit or a library: it belongs to that Song alone, and several of its Clips can use it. It takes its name from the file when imported, and keeps it; only its Clips are renamed. Once no Clip has used it for a day (long enough for undo to bring a Clip back), it's gone, and deleting its Song deletes it at once.
_Avoid_: Sample, stem, audio file, import

**Take**:
One recording made in the app, placed in a Clip on the Timeline. Like a Beat, it's tied to the lyrics only through Cues, so what it sings is whatever Lines are cued over its span. A Clip's Takes are numbered in the order they're recorded: a new one takes the number after the highest still in the Clip, so deleting the latest Take frees its number, while a gap left lower down stays. A new Take goes in a new Clip on the Chosen Track, at the playhead, or where that Track's last Clip ends if the playhead is before that, so it never lands on another Clip.
_Avoid_: Recording, attempt

**Retake**:
Recording another Take into a Clip that already holds Takes, rather than into a new Clip: it records from the Clip's start as trimmed, with the Clip kept silent meanwhile, and the new Take becomes the one it plays. The Clip grows to fit it, but never into the next Clip on its Track; whatever's past that is kept, hidden, to trim into view later.
_Avoid_: Re-record, overdub

**Clip**:
A stretch of a Beat or a Sound, or a set of Takes, placed at a position on a Track; the same Beat or Sound can be used by several Clips, and trimming a Clip never changes the audio file; a Clip with several Takes plays exactly one active Take. A Clip can be given a name of its own, so two Clips of the same audio can be told apart; until then, it goes by its source's name (the Beat's title, the Sound's name, or its active Take's number), and a named Take Clip still shows which Take is active.
_Avoid_: Region, segment

**Loop**:
A stretch of the Timeline that playback repeats, e.g. the hook of a Beat while writing over it: playback that reaches the Loop's end goes back to its start. Playback started or moved anywhere else plays on as usual until it reaches the Loop's end, so after the Loop it runs to the Timeline's end. Each Song keeps one, which can be switched on or off; only the user switches it, and it never moves the playhead.
_Avoid_: Cycle, repeat, region

**Cue**:
A link from one Line to a time on the Timeline; a Line has at most one. A Section has no Cue of its own: it starts where its first Line is cued. A Line's Cue lies dormant while its Alternate is inactive, and stays with the Line wherever it goes: into the Scrapbook and back, or into another Section as an Alternate, where it's dormant until that Alternate is made active (and may then be out of order). A new Alternate starts with a copy of the Cues of the Alternate it was copied from; from then on, each keeps its own. A Duplicate starts with none. Playing from a Cue starts a second before it, to lead into it. Cues are expected to run in order down the Arrangement (equal times are fine); a Cue earlier than a Line above it or later than one below it is **out of order**, which is allowed but marked.
_Avoid_: Timestamp, sync point, marker

**Sync mode**:
A way of syncing a Song's Lines while the Timeline plays: as each Line starts, marking it "Now" cues it at the playhead, and the Line after it comes up next, cued or not, so a run of Lines can be retaken. Clicking a Line makes it the next one; with none clicked or just cued, the next one is the first Line without a Cue, or the first Line once every Line is cued. There's always a next Line. The Line playing is followed as usual, except that the next Line's own Cue is ignored until it's cued again, so the Line being retaken only becomes the one playing when it's marked "Now". Which Line is next never depends on where playback is, so playback can start anywhere, and playing from a Cue leaves the next Line where it is. Sync mode needs a Clip on the Timeline, and Sync mode and the Loop are never on together. Sync mode is only for cueing, so changing the lyrics ends it, playback carrying on: changing the Arrangement or a Section in it, moving a Section between the Scrapbook and the Arrangement, opening or adding a Section in the Scrapbook, or opening a Section's Alternates. Working with Cues never does, whether one Line's, a Section's or every one.
_Avoid_: Tap mode, record mode

**Latency Offset**:
The delay between what the user heard and what the mic captured, the full round trip, measured by calibration once per device, since it belongs to the hardware chain: a click plays, the user taps or claps on the mic along with it, and the delays are averaged. Calibration is offered before a device's first recording, and can be skipped and run later from the recording settings; until then, the latency the browser reports stands in. Each Take is placed earlier by the offset it was recorded with and keeps it, so recalibrating never moves it, and it can be nudged by hand.
_Avoid_: Delay, lag

**Nudge**:
How far a Take has been moved by hand from where it was recorded, on top of its Latency Offset: typed in milliseconds in its Clip's menu, stepped with Alt+←/→, or set by Alt+dragging the Clip. Only the Take moves; its Clip stays where it is on the Timeline. A Take nudged earlier still reaches where it ended before, so its Clip can be trimmed out as far as before. A Cue can be nudged too, 0.1 s earlier or later with Alt+↓/↑ in Sync mode, so the verb covers both; but a Nudge, the amount, is only ever a Take's.
_Avoid_: Shift, slip, offset (the Latency Offset is something else)

**Input**:
What a Take is recorded from: an audio device and one of its channels (e.g. "Scarlett 2i2 · Input 1"), since Takes are mono. Chosen once per device, like the Latency Offset; where the device chosen isn't connected, the default input is used, and said so. A device's channels are its inputs, never Tracks.
_Avoid_: Mic (unless it is one), source

**Master**:
A finished recording of a Song made elsewhere (e.g. in a studio), attached to the Song as a result rather than placed on the Timeline. When a Song has several, each has a free-text name (e.g. "Radio edit", "Acoustic") and one is the **main Master**.
_Avoid_: Final, release, finished track, alternate master (an Alternate is something else)

**Mixdown**:
The Timeline, or the Loop's stretch of it, rendered into a single audio file that sounds as playback would, with every Track's volume, mute and solo as they are. There's no Mixdown of one Track or one Clip: soloing a Track is how to hear it alone. It covers the audio, never the Cues: the whole Timeline's Mixdown runs from 0:00 to where its last Clip ends. It's downloaded, never kept in Bandmate.
_Avoid_: Bounce, export, render

### Around the app

**Shortcut**:
A key, or a key held with the mouse, that does something on a Song page without reaching for a button, like Space to play or R to record. Shortcuts are for a keyboard and mouse, so phones never show them. A control's usual keys, like arrows in a menu or Esc in a text field, work as they do everywhere and aren't Bandmate's Shortcuts.
_Avoid_: Keybind, hotkey, key binding
