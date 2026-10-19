package timeline

import (
	"cmp"
	"fmt"
	"slices"

	"github.com/xKirtle/bandmate/internal/domain"
)

// Where every edit puts the Timeline's Tracks and Clips: each is a pure
// change to the whole Timeline, which the edit path checks and writes
// (edit.go). None of them reads or writes the database, so each is
// table-tested on plain Timeline values.

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
		tl = tl.insertingTrack(Track{ID: added[i], Name: name, Clips: []Clip{}}, len(tl.Tracks))
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

// The Track edits, a Clip's playback, and the edits that build a Timeline
// out of several of these, are pure edits too. A Track's place is where the
// Timeline holds it from the top, so none of them says anything about the
// order its rows are written in.

// updatingTrack is tl with one of its Tracks renamed, or its volume, mute
// or solo set, as changes says: what UpdateTrack leaves. A name it gives is
// already trimmed and checked, as is a volume.
func (tl Timeline) updatingTrack(trackID int64, changes TrackChanges) (Timeline, error) {
	t, err := tl.findTrack(trackID)
	if err != nil {
		return Timeline{}, err
	}
	if c := changes.Name; c.Set {
		t.Name = c.Value
	}
	if c := changes.Volume; c.Set {
		t.Volume = c.Value
	}
	if c := changes.Muted; c.Set {
		t.Muted = c.Value
	}
	if c := changes.Soloed; c.Set {
		t.Soloed = c.Value
	}
	return tl.replacingTrack(t), nil
}

// addingTrack is tl with a Track added as t says, holding its Clips: what
// AddTrack leaves. srcs are what those Clips play, one for each, in the
// order t gives them. Its name and volume are already checked, and its
// Clips follow the same rules as placing a Clip.
func (tl Timeline) addingTrack(t NewTrack, srcs []clipSource, ids *ids) (Timeline, error) {
	place, err := tl.trackPosition(t.Position)
	if err != nil {
		return Timeline{}, err
	}
	added := Track{ID: ids.track(), Name: t.Name, Volume: t.Volume, Muted: t.Muted, Soloed: t.Soloed,
		Clips: []Clip{}}
	tl = tl.insertingTrack(added, place)
	for i, c := range t.Clips {
		if tl, err = tl.placingNew(added.ID, c, srcs[i], ids.clip()); err != nil {
			return Timeline{}, err
		}
	}
	return tl, nil
}

// insertingTrack is tl with t among its Tracks at place, from 0 (the top)
// to the number of Tracks (the bottom), pushing those from there down.
func (tl Timeline) insertingTrack(t Track, place int) Timeline {
	tl.Tracks = slices.Insert(slices.Clone(tl.Tracks), place, t)
	return tl
}

// addingTracksAt is tl with an empty Track of each of those given, in
// order, each placed among the Tracks there once those before it are added,
// and the ids they were added with: e.g. the Track a Merge adds for its
// Clip.
func (tl Timeline) addingTracksAt(tracks []TrackAt, ids *ids) (Timeline, []int64, error) {
	added := make([]int64, len(tracks))
	for i, t := range tracks {
		name, err := trackName(t.Name)
		if err != nil {
			return Timeline{}, nil, err
		}
		place, err := tl.trackPosition(&t.Position)
		if err != nil {
			return Timeline{}, nil, err
		}
		added[i] = ids.track()
		tl = tl.insertingTrack(Track{ID: added[i], Name: name, Clips: []Clip{}}, place)
	}
	return tl, added, nil
}

// addingTrackBelow is tl with an empty Track right below one of its own,
// named as a Merge names the Track it adds, "Track" and the number of
// Tracks with it, and the id it was added with.
func (tl Timeline) addingTrackBelow(trackID int64, ids *ids) (Timeline, int64, error) {
	above, ok := tl.trackPlace(trackID)
	if !ok {
		return Timeline{}, 0, domain.ErrNotFound
	}
	id := ids.track()
	return tl.insertingTrack(Track{ID: id, Name: fmt.Sprintf("Track %d", len(tl.Tracks)+1),
		Clips: []Clip{}}, above+1), id, nil
}

// reordering is tl with its Tracks in the order given, top to bottom, which
// must list every one of them exactly once, their Clips going with them:
// what ReorderTracks leaves.
func (tl Timeline) reordering(order []int64) (Timeline, error) {
	errOrder := domain.Invalid("the new order must list every Track exactly once")
	if len(order) != len(tl.Tracks) {
		return Timeline{}, errOrder
	}
	tracks := make([]Track, 0, len(order))
	for _, id := range order {
		t, err := tl.findTrack(id)
		if err != nil || slices.ContainsFunc(tracks, func(o Track) bool { return o.ID == id }) {
			return Timeline{}, errOrder
		}
		tracks = append(tracks, t)
	}
	tl.Tracks = tracks
	return tl, nil
}

// changingClip is tl with one of its Clips as how leaves it, where it is on
// its Track: how a Clip's playback is set, which never moves it.
func (tl Timeline) changingClip(clipID int64, how func(Clip) (Clip, error)) (Timeline, error) {
	t, c, err := tl.findClip(clipID)
	if err != nil {
		return Timeline{}, err
	}
	if c, err = how(c); err != nil {
		return Timeline{}, err
	}
	return tl.replacing(t, t.ID, c), nil
}

// settingGain is tl with one of its Clips playing gain decibels louder or
// quieter: what SetClipGain leaves. The Gain it gives is already checked.
func (tl Timeline) settingGain(clipID int64, gain float64) (Timeline, error) {
	return tl.changingClip(clipID, func(c Clip) (Clip, error) {
		c.Gain = gain
		return c, nil
	})
}

// settingPitches is tl with each of several Clips' audio moved up or down
// by the semitones given, nothing else about them changing: what
// SetClipPitches leaves. The Pitches it gives are already checked.
func (tl Timeline) settingPitches(pitches []ClipPitch) (Timeline, error) {
	var err error
	for _, p := range pitches {
		if tl, err = tl.changingClip(p.ClipID, func(c Clip) (Clip, error) {
			c.Pitch = *p.Pitch
			return c, nil
		}); err != nil {
			return Timeline{}, err
		}
	}
	return tl, nil
}

// settingFades is tl with one of its Clips rising from silence at its start
// and falling to silence at its end as fades says: what SetClipFades
// leaves. They must fit the Clip as it is.
func (tl Timeline) settingFades(clipID int64, fades Fades) (Timeline, error) {
	return tl.changingClip(clipID, func(c Clip) (Clip, error) {
		if err := fades.check(c.Length); err != nil {
			return Clip{}, err
		}
		c.setFades(fades)
		return c, nil
	})
}

// settingTempos is tl with each of several of its Clips playing its audio
// at the Tempo given, in one step: what SetClipTempos leaves. Each keeps
// its start and the stretch of its source it plays, so its length scales,
// and its Fades with it. One slowed until it runs into the next Clip on its
// Track moves onto a Track added right below its own, as tempoMoves works
// out. The Tempos it gives are already checked.
func (tl Timeline) settingTempos(tempos []ClipTempo, ids *ids) (Timeline, error) {
	// Every Clip is found first: where the slowed ones go is worked out on
	// the Timeline as it stands, before any of them is retimed.
	for _, t := range tempos {
		if _, _, err := tl.findClip(t.ClipID); err != nil {
			return Timeline{}, err
		}
	}
	moves := tempoMoves(tl, tempos)
	// The Tracks added below each Track, top to bottom.
	onto := map[int64][]int64{}
	var added int64
	var err error
	for _, m := range moves {
		if m.newTrack < len(onto[m.from]) {
			continue
		}
		if tl, added, err = tl.addingTrackBelow(lastOr(onto[m.from], m.from), ids); err != nil {
			return Timeline{}, err
		}
		onto[m.from] = append(onto[m.from], added)
	}
	for _, t := range tempos {
		was, c, err := tl.findClip(t.ClipID)
		if err != nil {
			return Timeline{}, err
		}
		trackID := was.ID
		if i := slices.IndexFunc(moves, func(m tempoMove) bool { return m.clipID == t.ClipID }); i >= 0 {
			trackID = onto[moves[i].from][moves[i].newTrack]
		}
		tl = tl.replacing(was, trackID, asPlaced(atTempo(c, t.Tempo)))
	}
	return tl, nil
}

// lastOr is the last of ids, or else id.
func lastOr(ids []int64, id int64) int64 {
	if len(ids) == 0 {
		return id
	}
	return ids[len(ids)-1]
}

// importingSound is tl with the whole of an imported Sound placed on one of
// its Tracks, after its last Clip, or at 0:00 if it has none: what
// ImportSound leaves.
func (tl Timeline) importingSound(trackID int64, snd Sound, clipID int64) (Timeline, error) {
	if err := tl.findTrackToPlaceOn(trackID); err != nil {
		return Timeline{}, err
	}
	tl = tl.playing(clipSource{sound: &snd})
	return tl.placing(trackID, asPlaced(Clip{ID: clipID, SoundID: &snd.ID, ClipPlayback: asRecorded(),
		Takes: []Take{}, Start: trackEnd(tl.track(trackID)), Length: snd.Duration})), nil
}

// splitting is tl with one of its Clips cut in two at a time on the
// Timeline, which must cross it, not touch its edge: what SplitClips leaves
// of each. The Clip becomes the left half, ending at the cut, and a new
// Clip, with the id given, the right half, from the cut on, so playing
// across the cut is as before. Both keep the Clip's source, name and
// playback; the left keeps the fade in and the right the fade out, each
// shortened to end at the cut, which gets no Fade. The right half of a Clip
// of Takes plays copies of its Takes (copied).
func (tl Timeline) splitting(clipID int64, at float64, rightID int64, copied splitTakes) (Timeline, error) {
	t, c, err := tl.findClip(clipID)
	if err != nil {
		return Timeline{}, err
	}
	cut := at - c.Start
	if cut <= tolerance || cut >= c.Length-tolerance {
		return Timeline{}, domain.Invalid("a Clip is only split where the playhead crosses it")
	}
	right := cloneClip(c)
	right.ID, right.Takes, right.ActiveTakeID = rightID, copied.takes, copied.active
	right.Start, right.Offset, right.Length = at, placementOf(t.ID, c).sourceAt(at), c.Length-cut
	right.setFades(Fades{In: 0, Out: min(c.FadeOut, right.Length)})
	left := c
	left.Length = cut
	left.setFades(Fades{In: min(c.FadeIn, cut), Out: 0})
	tl = tl.replacing(t, t.ID, asPlaced(left))
	return tl.placing(t.ID, asPlaced(right)), nil
}

// merging is tl with the Clips a Merge merges replaced by one Clip of the
// new Sound snd, covering their span: what MergeClips leaves. It goes on
// the Track m names, or on the new Track m names, added there. The Sound's
// audio, rendered to whole samples at sampleRate, may fall short of the
// span by part of one, and the Clip then plays all there is; falling short
// by more is refused.
func (tl Timeline) merging(m ClipMerge, snd Sound, sampleRate float64, ids *ids) (Timeline, error) {
	start, end, err := tl.mergedSpan(m.ClipIDs)
	if err != nil {
		return Timeline{}, err
	}
	if snd.Duration < end-start-1/sampleRate {
		return Timeline{}, domain.Invalid("the merged audio must last as long as the Clips merged")
	}
	if tl, err = tl.deleting(m.ClipIDs, nil); err != nil {
		return Timeline{}, err
	}
	var trackID int64
	if tl, trackID, err = m.landing(tl, ids); err != nil {
		return Timeline{}, err
	}
	tl = tl.playing(clipSource{sound: &snd})
	return tl.placing(trackID, asPlaced(Clip{ID: ids.clip(), SoundID: &snd.ID, ClipPlayback: asRecorded(),
		Takes: []Take{}, Start: start, Length: min(end-start, snd.Duration)})), nil
}

// landing is tl with the Track a merged Clip goes on, and that Track's id:
// the Track m names, of the Timeline the Merge starts from, or the new one,
// which it adds where m says.
func (m ClipMerge) landing(tl Timeline, ids *ids) (Timeline, int64, error) {
	if m.NewTrack == nil {
		return tl, *m.TrackID, tl.findTrackToPlaceOn(*m.TrackID)
	}
	tl, added, err := tl.addingTracksAt([]TrackAt{*m.NewTrack}, ids)
	if err != nil {
		return Timeline{}, 0, err
	}
	return tl, added[0], nil
}

// replacingClips is tl without the Clips with the ids given, then without
// the Tracks trackIDs, with an empty Track of each of newTracks added where
// it says, and with clips placed on its Tracks: what ReplaceClips leaves,
// e.g. undoing a Merge. srcs are what those Clips play, one for each, in
// the order clips gives them.
func (tl Timeline) replacingClips(clipIDs, trackIDs []int64, newTracks []TrackAt, clips []PlacedClip,
	srcs []clipSource, ids *ids) (Timeline, error) {
	tl, err := tl.deleting(clipIDs, trackIDs)
	if err != nil {
		return Timeline{}, err
	}
	tl, added, err := tl.addingTracksAt(newTracks, ids)
	if err != nil {
		return Timeline{}, err
	}
	for i, c := range clips {
		trackID, err := c.trackOf(added)
		if err != nil {
			return Timeline{}, err
		}
		if tl, err = tl.placingNew(trackID, c.NewClip, srcs[i], ids.clip()); err != nil {
			return Timeline{}, err
		}
	}
	return tl, nil
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
