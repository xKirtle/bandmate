package timeline

import (
	"cmp"
	"slices"

	"github.com/xKirtle/bandmate/internal/domain"
)

// Where every Clip placement edit puts the Clips: each is a pure change to
// the whole Timeline, which the edit path checks and writes (edit.go). None
// of them reads or writes the database, so each is table-tested on plain
// Timeline values.

// addingBeat is tl with the whole of a Beat placed on one of its Tracks,
// after its last Clip, or at 0:00 if it has none: what AddBeat leaves.
func (tl Timeline) addingBeat(trackID int64, beat Beat, clipID int64) (Timeline, error) {
	t, err := tl.findTrack(trackID)
	if err != nil {
		return Timeline{}, err
	}
	tl = tl.playing(clipSource{beat: &beat})
	return tl.placing(trackID, asPlaced(Clip{ID: clipID, BeatID: &beat.ID, ClipPlayback: asRecorded(),
		Takes: []Take{}, Start: trackEnd(t), Length: beat.Duration})), nil
}

// placingNew is tl with a new Clip playing src, as given, on one of its
// Tracks: what PlaceClip leaves.
func (tl Timeline) placingNew(trackID int64, c NewClip, src clipSource, clipID int64) (Timeline, error) {
	if err := tl.findTrackToPlaceOn(trackID); err != nil {
		return Timeline{}, err
	}
	if err := c.ClipPlayback.check(c.Length); err != nil {
		return Timeline{}, err
	}
	tl = tl.playing(src)
	return tl.placing(trackID, asPlaced(c.placed(clipID, src))), nil
}

// addingTracks is tl with an empty Track of each of the names given, which
// must be checked, at the bottom in order, at 0 dB and neither muted nor
// soloed, and the ids they were added with: the Tracks a paste or a Place
// adds for its Clips.
func (tl Timeline) addingTracks(names []string, ids *ids) (Timeline, []int64) {
	added := make([]int64, len(names))
	for i, name := range names {
		added[i] = ids.track()
		tl.Tracks = append(tl.Tracks, Track{ID: added[i], Name: name, Clips: []Clip{}})
	}
	return tl, added
}

// moving is tl with one of its Clips moved to start at a time on one of its
// Tracks, keeping its trim: what MoveClip leaves.
func (tl Timeline) moving(clipID, trackID int64, start float64) (Timeline, error) {
	was, c, err := tl.findClip(clipID)
	if err != nil {
		return Timeline{}, err
	}
	if err := tl.findTrackToPlaceOn(trackID); err != nil {
		return Timeline{}, err
	}
	c.Start = start
	return tl.replacing(was, trackID, asPlaced(c)), nil
}

// movingAll is tl with several Clips moved at once, each as moving moves
// it: what MoveClips leaves. The Clips are checked once the whole move is
// made, so Clips moved together may pass each other's old places.
func (tl Timeline) movingAll(moves []ClipMove) (Timeline, error) {
	var err error
	for _, m := range moves {
		if tl, err = tl.moving(m.ClipID, m.TrackID, m.Start); err != nil {
			return Timeline{}, err
		}
	}
	return tl, nil
}

// trimming is tl with one of its Clips playing length seconds of its source
// from offset, its audio staying where it is on the Timeline, so trimming
// the start moves where the Clip starts. Its Fades are set to fades, if
// given, and otherwise go with its edges: what TrimClip leaves.
func (tl Timeline) trimming(clipID int64, offset, length float64, fades *Fades) (Timeline, error) {
	t, c, err := tl.findClip(clipID)
	if err != nil {
		return Timeline{}, err
	}
	offset = roundedToZero(offset)
	c.Start, c.Offset, c.Length = placementOf(t.ID, c).timelineAt(offset), offset, length
	if fades != nil {
		if err := fades.check(length); err != nil {
			return Timeline{}, err
		}
		c.setFades(*fades)
	}
	return tl.replacing(t, t.ID, asPlaced(c)), nil
}

// duplicating is tl with a copy of one of its Clips, with the same trim,
// name and playback, right after it on its Track, or after the Track's last
// Clip if something is in the way: what DuplicateClip leaves. takes are the
// copies of a Clip of Takes' Takes, already stored, and active the one of
// them the copy plays.
func (tl Timeline) duplicating(clipID, clipCopyID int64, takes []Take, active *int64) (Timeline, error) {
	t, c, err := tl.findClip(clipID)
	if err != nil {
		return Timeline{}, err
	}
	copied := cloneClip(c)
	copied.ID, copied.Takes, copied.ActiveTakeID = clipCopyID, takes, active
	copied.Start = duplicateStart(t, c)
	return tl.placing(t.ID, asPlaced(copied)), nil
}

// deleting is tl without the Clips with the ids given, and then without the
// Tracks trackIDs and any Clips left on them: what DeleteClips leaves. A
// Song always has a Track, so its last one can't go. The Takes of a Clip
// that goes leave it, to be placed again.
func (tl Timeline) deleting(clipIDs, trackIDs []int64) (Timeline, error) {
	for _, id := range clipIDs {
		t, _, err := tl.findClip(id)
		if err != nil {
			return Timeline{}, err
		}
		tl = tl.replacingTrack(withoutClip(t, id))
	}
	for _, id := range trackIDs {
		if _, err := tl.findTrack(id); err != nil {
			return Timeline{}, err
		}
		tl.Tracks = slices.DeleteFunc(slices.Clone(tl.Tracks), func(t Track) bool { return t.ID == id })
	}
	if len(tl.Tracks) == 0 {
		return Timeline{}, errLastTrack
	}
	return tl, nil
}

// The Take edits are pure edits too, each handed the Take the operation
// stored with its audio first (takes.go), so the edit only works out where
// it goes.

// recording is tl with a Take just recorded placed in a new Clip starting
// at start on one of its Tracks, as its first and active Take: what
// RecordTake leaves. takeStart is where the Take itself starts on the
// Timeline. Whatever it holds before the Clip's start (the lead-in) is
// kept, hidden behind it, so the Clip plays from its start to the Take's
// end.
func (tl Timeline) recording(trackID int64, take Take, takeStart, start float64, clipID int64) (Timeline, error) {
	length := takeStart + take.Duration - start
	if length <= tolerance {
		return Timeline{}, errTakeTooEarly
	}
	if err := tl.findTrackToPlaceOn(trackID); err != nil {
		return Timeline{}, err
	}
	// The span's origin is the Take's start, or the Clip's if the Take
	// starts later, so the Clip never starts before its source.
	take.Position = max(0, takeStart-start)
	return tl.placing(trackID, asPlaced(Clip{ID: clipID, ClipPlayback: asRecorded(), Takes: []Take{take},
		ActiveTakeID: &take.ID, Start: start, Offset: max(0, start-takeStart), Length: length})), nil
}

// retaking is tl with a Take just recorded in one of its Clips of Takes, as
// its active Take: what Retake leaves. takeStart is where the Take starts
// on the Timeline. Where it starts before the Clip's source span, the span
// is taken back to where it starts, the Takes already there staying where
// they are on the Timeline. The Clip grows to where the Take ends, but
// never past the next Clip on its Track.
func (tl Timeline) retaking(clipID int64, take Take, takeStart float64) (Timeline, error) {
	t, c, err := tl.findClip(clipID)
	if err != nil {
		return Timeline{}, err
	}
	if c.ActiveTakeID == nil {
		return Timeline{}, domain.Invalid("only a Clip of Takes can be retaken")
	}
	// A Take is recorded as it's sung, so it only lines up in a Clip that
	// plays its audio as recorded, in time and in tune.
	if c.Tempo != 1 {
		return Timeline{}, domain.Invalid("set the Clip's Tempo back to 100% to retake it")
	}
	if c.Pitch != 0 {
		return Timeline{}, domain.Invalid("set the Clip's Pitch back to 0 to retake it")
	}
	end := takeStart + take.Duration
	if end <= c.Start+tolerance {
		return Timeline{}, errTakeTooEarly
	}
	take.Position = placementOf(t.ID, c).sourceAt(takeStart)
	c.Takes = slices.Clone(c.Takes)
	if take.Position < 0 {
		c.Takes = takesStartingLater(c.Takes, -take.Position)
		c.Offset, take.Position = c.Offset-take.Position, 0
	}
	c.Length = grownTo(t, c, end)
	c.Takes = append(c.Takes, take)
	c.ActiveTakeID = &take.ID
	return tl.replacing(t, t.ID, asPlaced(c)), nil
}

// takesStartingLater is the Takes each starting later in its Clip's source
// span by some seconds, as taking the span back to an earlier start leaves
// them: they stay where they are on the Timeline.
func takesStartingLater(takes []Take, later float64) []Take {
	moved := slices.Clone(takes)
	for i := range moved {
		moved[i].Position += later
	}
	return moved
}

// nextTakeNumber is the number a new Take in c gets: the one after the
// highest still in it, so deleting the latest Take frees its number, while
// a gap left lower down stays.
func nextTakeNumber(c Clip) int {
	highest := 0
	for _, take := range c.Takes {
		highest = max(highest, take.Number)
	}
	return highest + 1
}

// settingTakes is tl with one of its Clips of Takes holding the Takes
// given, each where set puts it in the Clip's source span and however far
// it's nudged, playing the one set names through the window it gives, with
// fades for its Fades if they're given: what SetTakes leaves. The Takes it
// held that aren't given leave it, to be placed again.
func (tl Timeline) settingTakes(clipID int64, set ClipTakes, takes []Take, fades *Fades) (Timeline, error) {
	t, c, err := tl.findClipOfTakes(clipID)
	if err != nil {
		return Timeline{}, err
	}
	// takes are the Takes set names, read in the order they're numbered, so
	// each is in at.
	at := map[int64]TakeAt{}
	for _, a := range set.Takes {
		at[a.ID] = a
	}
	c.Takes = slices.Clone(takes)
	for i, take := range c.Takes {
		c.Takes[i].Position, c.Takes[i].Nudge = max(at[take.ID].Position, 0), at[take.ID].Nudge
	}
	c.ActiveTakeID = copyID(set.ActiveTakeID)
	c.Start, c.Offset, c.Length = set.Start, set.Offset, set.Length
	if fades != nil {
		if err := fades.check(set.Length); err != nil {
			return Timeline{}, err
		}
		c.setFades(*fades)
	}
	return tl.replacing(t, t.ID, asPlaced(c)), nil
}

// keepingTakes is tl with one of its Clips of Takes holding only the Takes
// keep, ids of at least one of them in the order of their numbers: what
// dropping a Take leaves. The rest leave it, to be placed again, and if the
// one it plays goes, the most recent one kept plays. Its window shrinks to
// end where the Takes kept do, and if they all end before it starts, it
// moves back to end there, its audio staying where it is on the Timeline. A
// Clip left with no Takes is deleted instead (deletingTake).
func (tl Timeline) keepingTakes(clipID int64, keep []int64) (Timeline, error) {
	t, c, err := tl.findClipOfTakes(clipID)
	if err != nil {
		return Timeline{}, err
	}
	c.Takes = slices.DeleteFunc(slices.Clone(c.Takes), func(take Take) bool {
		return !slices.Contains(keep, take.ID)
	})
	if !slices.Contains(keep, *c.ActiveTakeID) {
		// The most recent Take kept is the one it plays.
		recent := c.Takes[len(c.Takes)-1].ID
		c.ActiveTakeID = &recent
	}
	p := placementOf(t.ID, c)
	end := takesEnd(c.Takes)
	if end <= p.offset+tolerance {
		// Its audio stays where it is on the Timeline.
		offset := max(0, end-p.sourceLength(p.length))
		c.Start, c.Offset = p.timelineAt(offset), offset
	}
	c.Length = min(p.length, p.timelineLength(end-c.Offset))
	return tl.replacing(t, t.ID, asPlaced(c)), nil
}

// keepingActiveTake is tl with one of its Clips of Takes holding only the
// Take it plays, the rest leaving it: what ClearInactiveTakes leaves.
func (tl Timeline) keepingActiveTake(clipID int64) (Timeline, error) {
	_, c, err := tl.findClipOfTakes(clipID)
	if err != nil {
		return Timeline{}, err
	}
	return tl.keepingTakes(clipID, []int64{*c.ActiveTakeID})
}

// deletingTake is tl without one of a Clip of Takes' Takes, which leaves
// it to be brought back by setting the Clip's Takes: what DeleteTake
// leaves. Deleting the last Take deletes the Clip.
func (tl Timeline) deletingTake(clipID, takeID int64) (Timeline, error) {
	_, c, err := tl.findClipOfTakes(clipID)
	if err != nil {
		return Timeline{}, err
	}
	if !hasTake(c, takeID) {
		return Timeline{}, domain.ErrNotFound
	}
	if len(c.Takes) == 1 {
		return tl.deleting([]int64{clipID}, nil)
	}
	keep := make([]int64, 0, len(c.Takes)-1)
	for _, take := range c.Takes {
		if take.ID != takeID {
			keep = append(keep, take.ID)
		}
	}
	return tl.keepingTakes(clipID, keep)
}

// choosingTake is tl with one of a Clip of Takes' Takes the one it plays,
// through the same window: what ChooseTake leaves.
func (tl Timeline) choosingTake(clipID, takeID int64) (Timeline, error) {
	t, c, err := tl.findClipOfTakes(clipID)
	if err != nil {
		return Timeline{}, err
	}
	if !hasTake(c, takeID) {
		return Timeline{}, domain.Invalid("a Clip of Takes plays one of them")
	}
	c.ActiveTakeID = &takeID
	return tl.replacing(t, t.ID, asPlaced(c)), nil
}

// nudgingTake is tl with one of a Clip of Takes' Takes nudge seconds from
// where it was recorded, later if positive: what NudgeTake leaves. Only the
// Take moves: the Clip's window stays where it is, and where the Take goes
// before the Clip's source span, the span is taken back to where it starts,
// as for a Retake.
func (tl Timeline) nudgingTake(clipID, takeID int64, nudge float64) (Timeline, error) {
	t, c, err := tl.findClipOfTakes(clipID)
	if err != nil {
		return Timeline{}, err
	}
	i := slices.IndexFunc(c.Takes, func(take Take) bool { return take.ID == takeID })
	if i < 0 {
		return Timeline{}, domain.ErrNotFound
	}
	position := c.Takes[i].Position + nudge - c.Takes[i].Nudge
	earlier := max(0, -position)
	c.Takes = takesStartingLater(c.Takes, earlier)
	c.Offset += earlier
	c.Takes[i].Position, c.Takes[i].Nudge = position+earlier, nudge
	return tl.replacing(t, t.ID, asPlaced(c)), nil
}

// findClipOfTakes is one of tl's Clips of Takes, and the Track it's on,
// refusing a Clip that has no Takes.
func (tl Timeline) findClipOfTakes(clipID int64) (Track, Clip, error) {
	t, c, err := tl.findClip(clipID)
	if err != nil {
		return Track{}, Clip{}, err
	}
	if c.ActiveTakeID == nil {
		return Track{}, Clip{}, domain.Invalid("only a Clip of Takes has Takes")
	}
	return t, c, nil
}

// hasTake tells whether a Take is one of c's.
func hasTake(c Clip, takeID int64) bool {
	return slices.ContainsFunc(c.Takes, func(take Take) bool { return take.ID == takeID })
}

// asPlaced is c as the Timeline holds it once it's placed: a start or
// offset rounded a hair before 0:00 taken as 0:00, and its Fades shortened
// to fit it, as the database holds them.
func asPlaced(c Clip) Clip {
	c.Start, c.Offset = roundedToZero(c.Start), roundedToZero(c.Offset)
	c.setFades(c.fades().fitted(c.Length))
	return c
}

// placing is tl with c on the Track with the id given, which must be one of
// tl's, among its Clips in the order they start.
func (tl Timeline) placing(trackID int64, c Clip) Timeline {
	t := tl.track(trackID)
	t.Clips = append(slices.Clone(t.Clips), c)
	sortClips(t.Clips)
	return tl.replacingTrack(t)
}

// replacing is tl with c in place of the Clip with its id, which is on the
// Track was, put on the Track with the id given, which may be another of
// tl's.
func (tl Timeline) replacing(was Track, trackID int64, c Clip) Timeline {
	tl = tl.replacingTrack(withoutClip(was, c.ID))
	return tl.placing(trackID, c)
}

// replacingTrack is tl with t in place of the Track with its id, keeping
// its place from the top.
func (tl Timeline) replacingTrack(t Track) Timeline {
	tl.Tracks = slices.Clone(tl.Tracks)
	if i := slices.IndexFunc(tl.Tracks, func(o Track) bool { return o.ID == t.ID }); i >= 0 {
		tl.Tracks[i] = t
	}
	return tl
}

// withoutClip is t without the Clip with the id given.
func withoutClip(t Track, clipID int64) Track {
	t.Clips = slices.DeleteFunc(slices.Clone(t.Clips), func(c Clip) bool { return c.ID == clipID })
	return t
}

// findTrack is one of tl's Tracks, refusing a Track that isn't on tl as
// not found, as a request names one of the Song's.
func (tl Timeline) findTrack(id int64) (Track, error) {
	i := slices.IndexFunc(tl.Tracks, func(t Track) bool { return t.ID == id })
	if i < 0 {
		return Track{}, domain.ErrNotFound
	}
	return tl.Tracks[i], nil
}

// sortClips puts a Track's Clips in the order they start, as the Timeline
// holds them.
func sortClips(clips []Clip) {
	slices.SortStableFunc(clips, func(a, b Clip) int {
		return cmp.Or(cmp.Compare(a.Start, b.Start), cmp.Compare(a.ID, b.ID))
	})
}
