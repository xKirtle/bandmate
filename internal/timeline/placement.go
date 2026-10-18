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
	return tl.placing(trackID, asPlaced(src.clip(clipID, c))), nil
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
	_, c, err := tl.findClip(clipID)
	if err != nil {
		return Timeline{}, err
	}
	if err := tl.findTrackToPlaceOn(trackID); err != nil {
		return Timeline{}, err
	}
	c.Start = start
	return tl.replacing(trackID, asPlaced(c)), nil
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
	return tl.replacing(t.ID, asPlaced(c)), nil
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

// replacing is tl with c in place of the Clip with its id, on the Track
// with the id given, which may be another of tl's.
func (tl Timeline) replacing(trackID int64, c Clip) Timeline {
	was, _, _ := tl.clip(c.ID)
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
