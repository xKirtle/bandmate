package timeline

import (
	"cmp"
	"slices"

	"github.com/xKirtle/bandmate/internal/domain"
)

// Where a Clip is, what's next to it and where it fits are answered on the
// Timeline a change starts from, which the change path hands every
// operation, never the database (ADR 0023). The searches find a place
// rather than refuse one, and test for overlaps as checkLayout does
// (overlapsAnother), which then checks where they put it. Each question has
// one answer, here: an operation grows no copy of its own.

// track is the Track of tl with the id given, or a Track with no Clips if
// there's none.
func (tl Timeline) track(id int64) Track {
	if i := slices.IndexFunc(tl.Tracks, func(t Track) bool { return t.ID == id }); i >= 0 {
		return tl.Tracks[i]
	}
	return Track{ID: id}
}

// clip is the Clip of tl with the id given, and the Track it's on, if
// there's one.
func (tl Timeline) clip(id int64) (Track, Clip, bool) {
	for _, t := range tl.Tracks {
		if i := slices.IndexFunc(t.Clips, func(c Clip) bool { return c.ID == id }); i >= 0 {
			return t, t.Clips[i], true
		}
	}
	return Track{}, Clip{}, false
}

// placement is where one of tl's Clips is and what it plays, as stored: the
// value an operation changes and writes back, taken from the Timeline in
// hand rather than read back a Clip at a time.
func (tl Timeline) placement(clipID int64) (placement, error) {
	t, c, ok := tl.clip(clipID)
	if !ok {
		return placement{}, domain.ErrNotFound
	}
	return placementOf(t.ID, c), nil
}

// placementOf is where c, on the Track with the id given, is and what it
// plays, as stored.
func placementOf(trackID int64, c Clip) placement {
	p := placement{
		trackID:      trackID,
		source:       source{beatID: nullID(c.BeatID), soundID: nullID(c.SoundID), activeTakeID: nullID(c.ActiveTakeID)},
		name:         clipName(c.Name),
		ClipPlayback: c.ClipPlayback,
		start:        c.Start,
		offset:       c.Offset,
		length:       c.Length,
	}
	for _, take := range c.Takes {
		p.source.takeIDs = append(p.source.takeIDs, take.ID)
	}
	return p
}

// trackToPlaceOn refuses a Track a Clip is to go on that isn't one of tl's,
// as findTrackToPlaceOn does for a Clip placed from outside the Timeline.
func (tl Timeline) trackToPlaceOn(id int64) error {
	if !slices.ContainsFunc(tl.Tracks, func(t Track) bool { return t.ID == id }) {
		return domain.Invalid("there's no such Track on this Timeline")
	}
	return nil
}

// trackEnd is where t's last Clip ends, or 0:00 if it has none: where a
// Clip added to it goes.
func trackEnd(t Track) float64 {
	var end float64
	for _, c := range t.Clips {
		end = max(end, c.Start+c.Length)
	}
	return end
}

// duplicateStart is where a copy of c, on t, goes: right after it, or after
// t's last Clip if something is in the way.
func duplicateStart(t Track, c Clip) float64 {
	copied := Clip{Start: c.Start + c.Length, Length: c.Length}
	if overlapsAnother(t, copied) {
		return trackEnd(t)
	}
	return copied.Start
}

// nextStart is where the next Clip on t after c starts, if there's one: the
// earliest start at or after where c ends, c itself left out, a rounding
// hair of slack allowed.
func nextStart(t Track, c Clip) (float64, bool) {
	var next float64
	found := false
	for _, o := range t.Clips {
		if o.ID == c.ID || o.Start < c.Start+c.Length-tolerance {
			continue
		}
		if !found || o.Start < next {
			next, found = o.Start, true
		}
	}
	return next, found
}

// grownTo is how long c, on t, plays once it's grown to end at end: never
// past the start of the next Clip on t, and never shorter than it is. It's
// how far a Retake grows the Clip it goes into, the rest of the Take kept
// hidden behind it (Retake).
func grownTo(t Track, c Clip, end float64) float64 {
	if next, ok := nextStart(t, c); ok {
		end = min(end, next)
	}
	return max(c.Length, end-c.Start)
}

// fitsBeforeNext tells whether c, keeping its start on t, ends by the start
// of the next Clip there, if there is one, leaving out those in leaving.
func fitsBeforeNext(t Track, c Clip, leaving []int64) bool {
	later := Track{Clips: slices.DeleteFunc(slices.Clone(t.Clips), func(o Clip) bool {
		return o.Start <= c.Start+tolerance || slices.Contains(leaving, o.ID)
	})}
	return !overlapsAnother(later, c)
}

// tempoMove is a Clip slowed until it runs into the next Clip on its Track,
// from. It goes onto one of the new Tracks added right below from: the
// newTrack-th of them, top to bottom, counting from 0.
type tempoMove struct {
	clipID   int64
	from     int64
	newTrack int
}

// tempoMoves is where those of tl's Clips that tempos slows into the next
// Clip on their Tracks go, as SetClipTempos says, in the order to add their
// new Tracks in: each is added for the first Clip to go onto it. The rest
// stay on their Tracks. A Clip not on tl is left out.
func tempoMoves(tl Timeline, tempos []ClipTempo) []tempoMove {
	type retimed struct {
		from Track
		clip Clip
	}
	var changed []retimed
	for _, t := range tempos {
		if track, c, ok := tl.clip(t.ClipID); ok {
			c.Length *= tempoScale(c.Tempo, t.Tempo)
			changed = append(changed, retimed{track, c})
		}
	}
	// Latest first, so one that moves away leaves room for the one before
	// it.
	slices.SortStableFunc(changed, func(a, b retimed) int { return cmp.Compare(b.clip.Start, a.clip.Start) })
	var moving []retimed
	leaving := []int64{}
	for _, r := range changed {
		if !fitsBeforeNext(r.from, r.clip, leaving) {
			moving = append(moving, r)
			leaving = append(leaving, r.clip.ID)
		}
	}
	// In Timeline order, so each new Track takes the earliest that fit.
	slices.Reverse(moving)
	// The Clips on the new Tracks below each Track, top to bottom.
	below := map[int64][][]Clip{}
	moves := make([]tempoMove, 0, len(moving))
	for _, m := range moving {
		tracks := below[m.from.ID]
		i := slices.IndexFunc(tracks, func(clips []Clip) bool { return !overlapsAnother(Track{Clips: clips}, m.clip) })
		if i < 0 {
			i = len(tracks)
			tracks = append(tracks, nil)
		}
		tracks[i] = append(tracks[i], m.clip)
		below[m.from.ID] = tracks
		moves = append(moves, tempoMove{clipID: m.clip.ID, from: m.from.ID, newTrack: i})
	}
	return moves
}
