package timeline

import (
	"cmp"
	"slices"
)

// The searches for where a Clip fits look at the Timeline a change starts
// from, never the database. They find a place rather than refuse one, and
// test for overlaps as checkLayout does (overlapsAnother), which then
// checks where they put it (ADR 0023).

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

// fitsBeforeNext tells whether c, keeping its start on t, ends by the start
// of the next Clip there, if there is one, leaving out those in leaving.
func fitsBeforeNext(t Track, c Clip, leaving []int64) bool {
	later := Track{Clips: slices.DeleteFunc(slices.Clone(t.Clips), func(o Clip) bool {
		return o.Start <= c.Start+tolerance || slices.Contains(leaving, o.ID)
	})}
	return !overlapsAnother(later, c)
}

// tempoMove is a Clip slowed until it runs into the next on its Track,
// from, going onto a new Track right below it: the below-th, counting from
// 1, of those added below from, top to bottom.
type tempoMove struct {
	clipID int64
	from   int64
	below  int
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
			// Scaled as atTempo scales it.
			c.Length *= c.Tempo / t.Tempo
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
		moves = append(moves, tempoMove{clipID: m.clip.ID, from: m.from.ID, below: i + 1})
	}
	return moves
}
