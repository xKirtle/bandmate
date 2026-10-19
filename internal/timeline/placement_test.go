package timeline

import (
	"reflect"
	"testing"
)

// where is where a Clip ends up: the Clip, the Track it's on, where it
// starts, what of its source it plays and for how long.
type where struct {
	clipID, trackID       int64
	start, offset, length float64
}

// clipsIn is where each of tl's Clips is, Track by Track from the top.
func clipsIn(tl Timeline) []where {
	var clips []where
	for _, t := range tl.Tracks {
		for _, c := range t.Clips {
			clips = append(clips, where{clipID: c.ID, trackID: t.ID,
				start: c.Start, offset: c.Offset, length: c.Length})
		}
	}
	return clips
}

// clipIn is where one of tl's Clips is.
func clipIn(t *testing.T, tl Timeline, clipID int64) where {
	t.Helper()
	for _, w := range clipsIn(tl) {
		if w.clipID == clipID {
			return w
		}
	}
	t.Fatalf("clip %d isn't on the Timeline", clipID)
	return where{}
}

// edited is the Timeline change leaves tl, checked against the placement
// rules as the edit path checks it (edit.go), with ids for new rows
// counting up from the highest tl holds.
func edited(tl Timeline, change edit) (Timeline, error) {
	after, err := change(cloneTimeline(tl), newIDs(tl))
	if err != nil {
		return Timeline{}, err
	}
	if v := checkLayout(tl, after); v != nil {
		return Timeline{}, v.err()
	}
	return after, nil
}

// newIDs hands out ids past the highest tl holds, as storedIDs does from
// the tables.
func newIDs(tl Timeline) *ids {
	last := map[string]int64{"tracks": 0, "clips": 0}
	for _, t := range tl.Tracks {
		last["tracks"] = max(last["tracks"], t.ID)
		for _, c := range t.Clips {
			last["clips"] = max(last["clips"], c.ID)
		}
	}
	return &ids{last: last}
}

// refused checks that an edit was refused in the words given.
func refused(t *testing.T, err error, refusal string) {
	t.Helper()
	if err == nil || err.Error() != refusal {
		t.Fatalf("error = %v, want %q", err, refusal)
	}
}

func TestAddingBeat(t *testing.T) {
	// The Beat the Clips play, 60 seconds long.
	beat := Beat{ID: 1, Title: "Night Drive", Duration: 60}
	tests := []struct {
		name    string
		tracks  [][]Clip
		trackID int64
		want    where
		refusal string
	}{
		{
			name:    "the whole Beat at 0:00 on an empty Track",
			tracks:  [][]Clip{{}},
			trackID: 1,
			want:    where{clipID: 1, trackID: 1, length: 60},
		},
		{
			name:    "after the Track's last Clip",
			tracks:  [][]Clip{{beatClip(1, 0, 10), beatClip(5, 20, 5)}},
			trackID: 1,
			want:    where{clipID: 6, trackID: 1, start: 25, length: 60},
		},
		{
			name:    "a Track that isn't on the Timeline",
			tracks:  [][]Clip{{}},
			trackID: 9,
			refusal: "not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf(tt.tracks...)
			after, err := edited(tl, func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.addingBeat(tt.trackID, beat, ids.clip())
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("addingBeat error = %v", err)
			}
			if got := clipIn(t, after, tt.want.clipID); got != tt.want {
				t.Errorf("the Beat's Clip = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestPlacingNew(t *testing.T) {
	beat := int64(1)
	// The Clips already on the Timeline: one Track, 0:00 to 0:10.
	tracks := [][]Clip{{beatClip(1, 0, 10)}}
	tests := []struct {
		name    string
		trackID int64
		clip    NewClip
		want    where
		refusal string
	}{
		{
			name: "a Clip placed in the room after the one there",
			// As undo places a deleted Clip back.
			trackID: 1,
			clip:    NewClip{BeatID: &beat, ClipPlayback: asRecorded(), Start: 20, Offset: 5, Length: 10},
			want:    where{clipID: 2, trackID: 1, start: 20, offset: 5, length: 10},
		},
		{
			name:    "a Clip placed where another already is",
			trackID: 1,
			clip:    NewClip{BeatID: &beat, ClipPlayback: asRecorded(), Start: 5, Length: 10},
			refusal: "Clips can't overlap on a Track",
		},
		{
			name:    "a Clip placed reaching past the end of its Beat",
			trackID: 1,
			clip:    NewClip{BeatID: &beat, ClipPlayback: asRecorded(), Start: 20, Offset: 55, Length: 10},
			refusal: "a Clip can't play past the end of its source",
		},
		{
			name:    "a Clip placed on a Track that isn't on the Timeline",
			trackID: 9,
			clip:    NewClip{BeatID: &beat, ClipPlayback: asRecorded(), Start: 20, Length: 10},
			refusal: "there's no such Track on this Timeline",
		},
		{
			name:    "a Clip placed with Fades longer than it",
			trackID: 1,
			clip: NewClip{BeatID: &beat, ClipPlayback: ClipPlayback{Tempo: 1, FadeIn: 6, FadeOut: 6},
				Start: 20, Length: 10},
			refusal: "a Clip's Fades can't together run longer than it",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf(tracks...)
			src := clipSource{beat: &Beat{ID: 1, Duration: 60}}
			after, err := edited(tl, func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.placingNew(tt.trackID, tt.clip, src, ids.clip())
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("placingNew error = %v", err)
			}
			if got := clipIn(t, after, tt.want.clipID); got != tt.want {
				t.Errorf("the Clip placed = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestMoving(t *testing.T) {
	tracks := [][]Clip{
		{beatClip(1, 0, 10), beatClip(2, 30, 10)},
		{beatClip(3, 0, 10)},
	}
	tests := []struct {
		name    string
		clipID  int64
		trackID int64
		start   float64
		want    where
		refusal string
	}{
		{
			name: "a Clip moved against the next Clip on its Track",
			// It ends exactly where Clip 2 starts.
			clipID: 1, trackID: 1, start: 20,
			want: where{clipID: 1, trackID: 1, start: 20, length: 10},
		},
		{
			name:   "a Clip moved onto another Track, keeping its trim",
			clipID: 2, trackID: 2, start: 15,
			want: where{clipID: 2, trackID: 2, start: 15, length: 10},
		},
		{
			name:   "a Clip moved onto the Clip after it",
			clipID: 1, trackID: 1, start: 25,
			refusal: "Clips can't overlap on a Track",
		},
		{
			name:   "a Clip moved before 0:00",
			clipID: 2, trackID: 1, start: -5,
			refusal: "a Clip can't start before 0:00",
		},
		{
			name:   "a Clip that isn't on the Timeline",
			clipID: 9, trackID: 1, start: 0,
			refusal: "not found",
		},
		{
			name:   "a Track that isn't on the Timeline",
			clipID: 1, trackID: 9, start: 0,
			refusal: "there's no such Track on this Timeline",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf(tracks...)
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.moving(tt.clipID, tt.trackID, tt.start)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("moving error = %v", err)
			}
			if got := clipIn(t, after, tt.clipID); got != tt.want {
				t.Errorf("moving = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestMovingAll(t *testing.T) {
	tl := timelineOf(
		[]Clip{beatClip(1, 0, 10), beatClip(2, 20, 10)},
		[]Clip{beatClip(3, 0, 10)},
	)
	t.Run("Clips swapped, each passing the other's old place", func(t *testing.T) {
		after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
			return tl.movingAll([]ClipMove{{ClipID: 1, TrackID: 1, Start: 20}, {ClipID: 2, TrackID: 1, Start: 0}})
		})
		if err != nil {
			t.Fatalf("movingAll error = %v", err)
		}
		want := []where{
			{clipID: 2, trackID: 1, start: 0, length: 10},
			{clipID: 1, trackID: 1, start: 20, length: 10},
			{clipID: 3, trackID: 2, start: 0, length: 10},
		}
		if got := clipsIn(after); !reflect.DeepEqual(got, want) {
			t.Errorf("the Clips = %+v, want %+v", got, want)
		}
	})
	t.Run("one of the Clips moved onto a Clip left where it was", func(t *testing.T) {
		_, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
			return tl.movingAll([]ClipMove{{ClipID: 1, TrackID: 2, Start: 5}, {ClipID: 2, TrackID: 1, Start: 0}})
		})
		refused(t, err, "Clips can't overlap on a Track")
	})
}

func TestTrimming(t *testing.T) {
	slowed := beatClip(2, 100, 20)
	slowed.Tempo = 0.5
	faded := beatClip(3, 200, 20)
	faded.FadeIn, faded.FadeOut = 6, 6
	tracks := [][]Clip{{beatClip(1, 10, 20), slowed, faded}}
	tests := []struct {
		name           string
		clipID         int64
		offset, length float64
		fades          *Fades
		want           where
		wantFades      Fades
		refusal        string
	}{
		{
			name: "trimmed at its start, which moves where it starts",
			// It plays its source from 0:05, so it starts 5 seconds later.
			clipID: 1, offset: 5, length: 15,
			want: where{clipID: 1, trackID: 1, start: 15, offset: 5, length: 15},
		},
		{
			name:   "trimmed at its end, which leaves its start alone",
			clipID: 1, offset: 0, length: 12,
			want: where{clipID: 1, trackID: 1, start: 10, offset: 0, length: 12},
		},
		{
			name:   "trimmed back to a hair before its source's start",
			clipID: 1, offset: -tolerance / 2, length: 20,
			want: where{clipID: 1, trackID: 1, start: 10, offset: 0, length: 20},
		},
		{
			name: "a slowed Clip trimmed at its start",
			// At half speed, 5 seconds of its source take 10 of the
			// Timeline.
			clipID: 2, offset: 5, length: 10,
			want: where{clipID: 2, trackID: 1, start: 110, offset: 5, length: 10},
		},
		{
			name:   "a Clip trimmed shorter than its Fades, which shorten to fit",
			clipID: 3, offset: 0, length: 8,
			want:      where{clipID: 3, trackID: 1, start: 200, offset: 0, length: 8},
			wantFades: Fades{In: 4, Out: 4},
		},
		{
			name:   "a Clip trimmed with the Fades it had before, as undo gives them",
			clipID: 3, offset: 0, length: 20, fades: &Fades{In: 6, Out: 6},
			want:      where{clipID: 3, trackID: 1, start: 200, offset: 0, length: 20},
			wantFades: Fades{In: 6, Out: 6},
		},
		{
			name:   "a Clip trimmed out past the end of its Beat",
			clipID: 1, offset: 0, length: 70,
			refusal: "a Clip can't play past the end of its source",
		},
		{
			name:   "a Clip trimmed to no length at all",
			clipID: 1, offset: 5, length: 0,
			refusal: "a Clip must play for some time",
		},
		{
			name:   "a Clip that isn't on the Timeline",
			clipID: 9, offset: 0, length: 1,
			refusal: "not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf(tracks...)
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.trimming(tt.clipID, tt.offset, tt.length, tt.fades)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("trimming error = %v", err)
			}
			if got := clipIn(t, after, tt.clipID); got != tt.want {
				t.Errorf("trimming = %+v, want %+v", got, tt.want)
			}
			_, c, _ := after.clip(tt.clipID)
			if got := c.fades(); got != tt.wantFades {
				t.Errorf("its Fades = %+v, want %+v", got, tt.wantFades)
			}
		})
	}
}

func TestDuplicating(t *testing.T) {
	tests := []struct {
		name    string
		clips   []Clip
		clipID  int64
		want    where
		refusal string
	}{
		{
			name:   "a copy right after the Clip",
			clips:  []Clip{beatClip(1, 0, 10)},
			clipID: 1,
			want:   where{clipID: 2, trackID: 1, start: 10, length: 10},
		},
		{
			name: "a copy that lands after the Track's last Clip to avoid an overlap",
			// The room right after Clip 1 is taken by Clip 2, so the copy
			// goes after Clip 3, the last on the Track.
			clips:  []Clip{beatClip(1, 0, 10), beatClip(2, 12, 5), beatClip(3, 30, 5)},
			clipID: 1,
			want:   where{clipID: 4, trackID: 1, start: 35, length: 10},
		},
		{
			name:    "a Clip that isn't on the Timeline",
			clips:   []Clip{beatClip(1, 0, 10)},
			clipID:  9,
			refusal: "not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf(tt.clips)
			after, err := edited(tl, func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.duplicating(tt.clipID, ids.clip(), []Take{}, nil)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("duplicating error = %v", err)
			}
			if got := clipIn(t, after, tt.want.clipID); got != tt.want {
				t.Errorf("the copy = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestDuplicatingAClipOfTakes(t *testing.T) {
	clip := Clip{ID: 1, Tempo: 1, Start: 0, Length: 10,
		Takes: []Take{{ID: 7, Number: 1, Duration: 10}}, ActiveTakeID: idOf(7)}
	tl := Timeline{Tracks: []Track{{ID: 1, Clips: []Clip{clip}}}}
	// The copies of its Takes, as the change stores them before the edit
	// places them.
	copies := []Take{{ID: 8, Number: 1, Duration: 10}}
	after, err := edited(tl, func(tl Timeline, ids *ids) (Timeline, error) {
		return tl.duplicating(1, ids.clip(), copies, idOf(8))
	})
	if err != nil {
		t.Fatalf("duplicating error = %v", err)
	}
	_, copied, ok := after.clip(2)
	if !ok {
		t.Fatal("the copy isn't on the Timeline")
	}
	if !reflect.DeepEqual(copied.Takes, copies) {
		t.Errorf("the copy's Takes = %+v, want %+v", copied.Takes, copies)
	}
	if copied.ActiveTakeID == nil || *copied.ActiveTakeID != 8 {
		t.Errorf("the copy plays Take %v, want 8", copied.ActiveTakeID)
	}
	if copied.Start != 10 {
		t.Errorf("the copy starts at %g, want 10", copied.Start)
	}
}

// idOf is a pointer to an id, as a Clip holds the Take it plays.
func idOf(id int64) *int64 { return &id }

func TestDeleting(t *testing.T) {
	tests := []struct {
		name       string
		tracks     [][]Clip
		clipIDs    []int64
		trackIDs   []int64
		want       []where
		wantTracks []int64
		refusal    string
	}{
		{
			name:    "a Clip deleted from between two others, which stay where they are",
			tracks:  [][]Clip{{beatClip(1, 0, 10), beatClip(2, 20, 10), beatClip(3, 40, 10)}},
			clipIDs: []int64{2},
			want: []where{
				{clipID: 1, trackID: 1, start: 0, length: 10},
				{clipID: 3, trackID: 1, start: 40, length: 10},
			},
			wantTracks: []int64{1},
		},
		{
			name:     "Clips and a Track deleted together, as undo of a paste does",
			tracks:   [][]Clip{{beatClip(1, 0, 10)}, {beatClip(2, 0, 10), beatClip(3, 20, 10)}},
			clipIDs:  []int64{2},
			trackIDs: []int64{2},
			want:     []where{{clipID: 1, trackID: 1, start: 0, length: 10}},
			// Track 2 goes with the Clip left on it.
			wantTracks: []int64{1},
		},
		{
			name:     "the Song's last Track",
			tracks:   [][]Clip{{beatClip(1, 0, 10)}},
			clipIDs:  []int64{1},
			trackIDs: []int64{1},
			refusal:  "a Song always has a Track, so its last one can't be deleted",
		},
		{
			name:    "a Clip that isn't on the Timeline",
			tracks:  [][]Clip{{beatClip(1, 0, 10)}},
			clipIDs: []int64{9},
			refusal: "not found",
		},
		{
			name:     "a Track that isn't on the Timeline",
			tracks:   [][]Clip{{beatClip(1, 0, 10)}},
			clipIDs:  []int64{1},
			trackIDs: []int64{9},
			refusal:  "not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf(tt.tracks...)
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.deleting(tt.clipIDs, tt.trackIDs)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("deleting error = %v", err)
			}
			if got := clipsIn(after); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("the Clips left = %+v, want %+v", got, tt.want)
			}
			var tracks []int64
			for _, t := range after.Tracks {
				tracks = append(tracks, t.ID)
			}
			if !reflect.DeepEqual(tracks, tt.wantTracks) {
				t.Errorf("the Tracks left = %v, want %v", tracks, tt.wantTracks)
			}
		})
	}
}

func TestAddingTracks(t *testing.T) {
	tl := timelineOf([]Clip{beatClip(1, 0, 10)})
	after, added := tl.addingTracks([]string{"Harmony", "Bass"}, newIDs(tl))
	if want := []int64{2, 3}; !reflect.DeepEqual(added, want) {
		t.Errorf("the Tracks added = %v, want %v", added, want)
	}
	var names []string
	for _, t := range after.Tracks {
		names = append(names, t.Name)
	}
	if want := []string{"", "Harmony", "Bass"}; !reflect.DeepEqual(names, want) {
		t.Errorf("the Tracks = %v, want %v", names, want)
	}
}

func TestMergedSpan(t *testing.T) {
	tl := timelineOf(
		[]Clip{beatClip(1, 10, 5), beatClip(2, 30, 5)},
		[]Clip{beatClip(3, 0, 4), beatClip(4, 50, 30)},
	)
	tests := []struct {
		name       string
		clipIDs    []int64
		start, end float64
		refusal    string
	}{
		{
			name:    "two Clips on one Track",
			clipIDs: []int64{1, 2},
			start:   10, end: 35,
		},
		{
			name:    "two Clips on different Tracks",
			clipIDs: []int64{2, 3},
			start:   0, end: 35,
		},
		{
			name:    "three Clips, the latest given first",
			clipIDs: []int64{4, 1, 3},
			start:   0, end: 80,
		},
		{
			name:    "a Clip that isn't on the Timeline",
			clipIDs: []int64{1, 9},
			refusal: "not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start, end, err := tl.mergedSpan(tt.clipIDs)
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("mergedSpan error = %v", err)
			}
			if start != tt.start || end != tt.end {
				t.Errorf("mergedSpan = %g to %g, want %g to %g", start, end, tt.start, tt.end)
			}
		})
	}
}
