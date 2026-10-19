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

func TestNextTakeNumber(t *testing.T) {
	tests := []struct {
		name  string
		takes []Take
		want  int
	}{
		{
			name: "the first Take of a Clip",
			want: 1,
		},
		{
			name:  "after the highest in it",
			takes: []Take{{ID: 1, Number: 1}, {ID: 2, Number: 2}},
			want:  3,
		},
		{
			name: "a gap left lower down, which stays",
			// Take 2 was deleted, so Take 4 comes next.
			takes: []Take{{ID: 1, Number: 1}, {ID: 3, Number: 3}},
			want:  4,
		},
		{
			name: "the latest Take deleted, which frees its number",
			// Take 3 was deleted, so the next one is Take 3 again.
			takes: []Take{{ID: 1, Number: 1}, {ID: 2, Number: 2}},
			want:  3,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := nextTakeNumber(Clip{Takes: tt.takes}); got != tt.want {
				t.Errorf("nextTakeNumber = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestRecording(t *testing.T) {
	// The Take recorded, 10 seconds long, as the change stores it before
	// the edit places it.
	take := Take{ID: 7, Number: 1, Duration: 10}
	tests := []struct {
		name string
		// at is where the Take starts on the Timeline, and start where its
		// Clip does.
		at, start    float64
		trackID      int64
		want         where
		wantPosition float64
		refusal      string
	}{
		{
			name:    "a Take recorded from where its Clip starts",
			at:      20,
			start:   20,
			trackID: 1,
			want:    where{clipID: 2, trackID: 1, start: 20, length: 10},
		},
		{
			name:    "a lead-in kept hidden behind the Clip's start",
			at:      18,
			start:   20,
			trackID: 1,
			want:    where{clipID: 2, trackID: 1, start: 20, offset: 2, length: 8},
		},
		{
			name:         "a Take that starts after its Clip, which plays from the Take's start",
			at:           23,
			start:        20,
			trackID:      1,
			want:         where{clipID: 2, trackID: 1, start: 20, length: 13},
			wantPosition: 3,
		},
		{
			name:    "a Take that ended before its Clip's start",
			at:      0,
			start:   20,
			trackID: 1,
			refusal: "the Take ended before its Clip's start",
		},
		{
			name:    "a Clip already where it was recorded",
			at:      5,
			start:   5,
			trackID: 1,
			refusal: "Clips can't overlap on a Track",
		},
		{
			name:    "a Track that isn't on the Timeline",
			at:      20,
			start:   20,
			trackID: 9,
			refusal: "there's no such Track on this Timeline",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf([]Clip{beatClip(1, 0, 10)})
			after, err := edited(tl, func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.recording(tt.trackID, take, tt.at, tt.start, ids.clip())
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("recording error = %v", err)
			}
			if got := clipIn(t, after, tt.want.clipID); got != tt.want {
				t.Errorf("the Take's Clip = %+v, want %+v", got, tt.want)
			}
			_, c, _ := after.clip(tt.want.clipID)
			if got := takePositions(c); !reflect.DeepEqual(got, []float64{tt.wantPosition}) {
				t.Errorf("its Takes start at %v in its span, want [%g]", got, tt.wantPosition)
			}
			if c.ActiveTakeID == nil || *c.ActiveTakeID != take.ID {
				t.Errorf("the Clip plays Take %v, want %d", c.ActiveTakeID, take.ID)
			}
		})
	}
}

func TestRetaking(t *testing.T) {
	// The Take retaken into the Clip, 20 seconds long, as the change stores
	// it before the edit places it.
	take := Take{ID: 8, Number: 2, Duration: 20}
	// The Clip retaken: 0:10 to 0:20, playing its one 10-second Take from
	// the start of its span.
	retaken := func() []Clip { return []Clip{takesClip(1, 10, 0, 10, Take{ID: 7, Number: 1})} }
	withPlayback := func(pb func(*Clip)) []Clip {
		clips := retaken()
		pb(&clips[0])
		return clips
	}
	tests := []struct {
		name  string
		clips []Clip
		// at is where the Take starts on the Timeline.
		at      float64
		clipID  int64
		want    where
		wantAt  []float64
		refusal string
	}{
		{
			name:   "a Retake with nothing after it, which grows the Clip to its end",
			clips:  retaken(),
			at:     10,
			clipID: 1,
			want:   where{clipID: 1, trackID: 1, start: 10, length: 20},
			wantAt: []float64{0, 0},
		},
		{
			name:   "a Retake capped by the next Clip, the rest kept hidden",
			clips:  append(retaken(), beatClip(2, 25, 10)),
			at:     10,
			clipID: 1,
			want:   where{clipID: 1, trackID: 1, start: 10, length: 15},
			wantAt: []float64{0, 0},
		},
		{
			name:   "a Retake that leads in before the Clip's span, which starts earlier",
			clips:  retaken(),
			at:     5,
			clipID: 1,
			want:   where{clipID: 1, trackID: 1, start: 10, offset: 5, length: 15},
			wantAt: []float64{5, 0},
		},
		{
			name:    "a Clip of a Beat",
			clips:   []Clip{beatClip(1, 10, 10)},
			at:      10,
			clipID:  1,
			refusal: "only a Clip of Takes can be retaken",
		},
		{
			name:    "a Clip that isn't at 100% Tempo",
			clips:   withPlayback(func(c *Clip) { c.Tempo = 0.5 }),
			at:      10,
			clipID:  1,
			refusal: "set the Clip's Tempo back to 100% to retake it",
		},
		{
			name:    "a Clip whose Pitch isn't 0",
			clips:   withPlayback(func(c *Clip) { c.Pitch = 2 }),
			at:      10,
			clipID:  1,
			refusal: "set the Clip's Pitch back to 0 to retake it",
		},
		{
			name:    "a Take that ended before the Clip's start",
			clips:   retaken(),
			at:      -20,
			clipID:  1,
			refusal: "the Take ended before its Clip's start",
		},
		{
			name:    "a Clip that isn't on the Timeline",
			clips:   retaken(),
			at:      10,
			clipID:  9,
			refusal: "not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf(tt.clips)
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.retaking(tt.clipID, take, tt.at)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("retaking error = %v", err)
			}
			if got := clipIn(t, after, tt.want.clipID); got != tt.want {
				t.Errorf("the Clip retaken = %+v, want %+v", got, tt.want)
			}
			_, c, _ := after.clip(tt.clipID)
			if got := takePositions(c); !reflect.DeepEqual(got, tt.wantAt) {
				t.Errorf("its Takes start at %v in its span, want %v", got, tt.wantAt)
			}
			if c.ActiveTakeID == nil || *c.ActiveTakeID != take.ID {
				t.Errorf("the Clip plays Take %v, want %d", c.ActiveTakeID, take.ID)
			}
		})
	}
}

// takePositions is where each of c's Takes starts in its source span.
func takePositions(c Clip) []float64 {
	at := make([]float64, len(c.Takes))
	for i, take := range c.Takes {
		at[i] = take.Position
	}
	return at
}

// takeIDsIn is the ids of c's Takes, in the order it holds them.
func takeIDsIn(c Clip) []int64 {
	ids := make([]int64, len(c.Takes))
	for i, take := range c.Takes {
		ids[i] = take.ID
	}
	return ids
}

func TestSettingTakes(t *testing.T) {
	// The Takes a Clip is set to, as the change reads them before the edit
	// places them: one in it already, one detached, each 10 seconds long but
	// the second, which is 20.
	takes := []Take{{ID: 7, Number: 1, Duration: 10}, {ID: 8, Number: 2, Duration: 20}}
	// The Clip the Takes go in: 0:10 to 0:20, playing Take 7 from the start
	// of its span.
	clips := func() []Clip { return []Clip{takesClip(1, 10, 0, 10, Take{ID: 7, Number: 1})} }
	tests := []struct {
		name      string
		clips     []Clip
		takes     []Take
		set       ClipTakes
		fades     *Fades
		want      where
		wantIDs   []int64
		wantAt    []float64
		wantFades Fades
		refusal   string
	}{
		{
			name:  "a Take attached to a Clip that has one, as a Retake leaves it",
			clips: clips(),
			takes: takes,
			set: ClipTakes{Takes: []TakeAt{{ID: 7, Position: 5}, {ID: 8}}, ActiveTakeID: idOf(8),
				Start: 10, Offset: 5, Length: 15},
			want:    where{clipID: 1, trackID: 1, start: 10, offset: 5, length: 15},
			wantIDs: []int64{7, 8},
			wantAt:  []float64{5, 0},
		},
		{
			name:  "a Take left out, which leaves the Clip",
			clips: clips(),
			takes: takes[:1],
			set: ClipTakes{Takes: []TakeAt{{ID: 7}}, ActiveTakeID: idOf(7),
				Start: 10, Offset: 0, Length: 10},
			want:    where{clipID: 1, trackID: 1, start: 10, length: 10},
			wantIDs: []int64{7},
			wantAt:  []float64{0},
		},
		{
			name:  "a Take given a position a rounding hair before the span's start",
			clips: clips(),
			takes: takes[:1],
			set: ClipTakes{Takes: []TakeAt{{ID: 7, Position: -tolerance / 2}}, ActiveTakeID: idOf(7),
				Start: 10, Offset: 0, Length: 10},
			want:    where{clipID: 1, trackID: 1, start: 10, length: 10},
			wantIDs: []int64{7},
			wantAt:  []float64{0},
		},
		{
			name:  "the Fades a change shortened, set back",
			clips: clips(),
			takes: takes[:1],
			set: ClipTakes{Takes: []TakeAt{{ID: 7}}, ActiveTakeID: idOf(7),
				Start: 10, Offset: 0, Length: 10},
			fades:     &Fades{In: 2, Out: 3},
			want:      where{clipID: 1, trackID: 1, start: 10, length: 10},
			wantIDs:   []int64{7},
			wantAt:    []float64{0},
			wantFades: Fades{In: 2, Out: 3},
		},
		{
			name:  "Fades longer than the Clip",
			clips: clips(),
			takes: takes[:1],
			set: ClipTakes{Takes: []TakeAt{{ID: 7}}, ActiveTakeID: idOf(7),
				Start: 10, Offset: 0, Length: 10},
			fades:   &Fades{In: 6, Out: 6},
			refusal: "a Clip's Fades can't together run longer than it",
		},
		{
			name:  "a Clip of a Beat",
			clips: []Clip{beatClip(1, 10, 10)},
			takes: takes[:1],
			set: ClipTakes{Takes: []TakeAt{{ID: 7}}, ActiveTakeID: idOf(7),
				Start: 10, Offset: 0, Length: 10},
			refusal: "only a Clip of Takes has Takes",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf(tt.clips)
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.settingTakes(1, tt.set, tt.takes, tt.fades)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("settingTakes error = %v", err)
			}
			if got := clipIn(t, after, tt.want.clipID); got != tt.want {
				t.Errorf("the Clip = %+v, want %+v", got, tt.want)
			}
			_, c, _ := after.clip(1)
			if got := takeIDsIn(c); !reflect.DeepEqual(got, tt.wantIDs) {
				t.Errorf("its Takes = %v, want %v", got, tt.wantIDs)
			}
			if got := takePositions(c); !reflect.DeepEqual(got, tt.wantAt) {
				t.Errorf("its Takes start at %v in its span, want %v", got, tt.wantAt)
			}
			if got := c.fades(); got != tt.wantFades {
				t.Errorf("its Fades = %+v, want %+v", got, tt.wantFades)
			}
			if c.ActiveTakeID == nil || *c.ActiveTakeID != *tt.set.ActiveTakeID {
				t.Errorf("the Clip plays Take %v, want %d", c.ActiveTakeID, *tt.set.ActiveTakeID)
			}
		})
	}
}

func TestKeepingTakes(t *testing.T) {
	// The Clip's three Takes, each 10 seconds long, one after another in its
	// span.
	three := []Take{{ID: 7, Number: 1}, {ID: 8, Number: 2, Position: 10}, {ID: 9, Number: 3, Position: 20}}
	tests := []struct {
		name string
		// clip is the Clip of Takes kept, playing Take 7.
		clip     Clip
		keep     []int64
		want     where
		wantIDs  []int64
		wantPlay int64
	}{
		{
			name:     "one Take of several kept, the Clip's window shrinking to it",
			clip:     takesClip(1, 10, 0, 30, three...),
			keep:     []int64{7},
			want:     where{clipID: 1, trackID: 1, start: 10, length: 10},
			wantIDs:  []int64{7},
			wantPlay: 7,
		},
		{
			name: "the Take it plays dropped, so the most recent one kept plays",
			clip: takesClip(1, 10, 0, 30, three...),
			keep: []int64{8, 9},
			// The Takes kept end 30 seconds into the span, as they did.
			want:     where{clipID: 1, trackID: 1, start: 10, length: 30},
			wantIDs:  []int64{8, 9},
			wantPlay: 9,
		},
		{
			name:     "a Take dropped from the end, the Clip shrinking to the rest",
			clip:     takesClip(1, 10, 0, 30, three...),
			keep:     []int64{7, 8},
			want:     where{clipID: 1, trackID: 1, start: 10, length: 20},
			wantIDs:  []int64{7, 8},
			wantPlay: 7,
		},
		{
			name: "the Takes left ending before the Clip's window, which moves back to them",
			// The Clip plays the third Take alone, at 0:30 to 0:40.
			clip:     takesClip(1, 30, 20, 10, three...),
			keep:     []int64{7},
			want:     where{clipID: 1, trackID: 1, start: 10, length: 10},
			wantIDs:  []int64{7},
			wantPlay: 7,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf([]Clip{tt.clip})
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.keepingTakes(1, tt.keep)
			})
			if err != nil {
				t.Fatalf("keepingTakes error = %v", err)
			}
			if got := clipIn(t, after, tt.want.clipID); got != tt.want {
				t.Errorf("the Clip = %+v, want %+v", got, tt.want)
			}
			_, c, _ := after.clip(1)
			if got := takeIDsIn(c); !reflect.DeepEqual(got, tt.wantIDs) {
				t.Errorf("its Takes = %v, want %v", got, tt.wantIDs)
			}
			if c.ActiveTakeID == nil || *c.ActiveTakeID != tt.wantPlay {
				t.Errorf("the Clip plays Take %v, want %d", c.ActiveTakeID, tt.wantPlay)
			}
		})
	}
}

func TestDeletingTake(t *testing.T) {
	tests := []struct {
		name    string
		clip    Clip
		takeID  int64
		wantIDs []int64
		// wantGone is whether the Clip goes with its last Take.
		wantGone bool
		refusal  string
	}{
		{
			name:    "one Take of two",
			clip:    takesClip(1, 10, 0, 20, Take{ID: 7, Number: 1}, Take{ID: 8, Number: 2, Position: 10}),
			takeID:  8,
			wantIDs: []int64{7},
		},
		{
			name:     "the Clip's last Take, which deletes the Clip",
			clip:     takesClip(1, 10, 0, 10, Take{ID: 7, Number: 1}),
			takeID:   7,
			wantGone: true,
		},
		{
			name:    "a Take that isn't in the Clip",
			clip:    takesClip(1, 10, 0, 10, Take{ID: 7, Number: 1}),
			takeID:  9,
			refusal: "not found",
		},
		{
			name:    "a Clip of a Beat",
			clip:    beatClip(1, 10, 10),
			takeID:  7,
			refusal: "only a Clip of Takes has Takes",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// A Song always has a Track, and this one has two Clips, so the
			// Clip can go without its Track going.
			tl := timelineOf([]Clip{tt.clip, beatClip(2, 100, 10)})
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.deletingTake(1, tt.takeID)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("deletingTake error = %v", err)
			}
			_, c, there := after.clip(1)
			if tt.wantGone {
				if there {
					t.Fatal("the Clip is still on the Timeline")
				}
				return
			}
			if !there {
				t.Fatal("the Clip isn't on the Timeline")
			}
			if got := takeIDsIn(c); !reflect.DeepEqual(got, tt.wantIDs) {
				t.Errorf("its Takes = %v, want %v", got, tt.wantIDs)
			}
		})
	}
}

func TestChoosingTake(t *testing.T) {
	tests := []struct {
		name    string
		clip    Clip
		takeID  int64
		refusal string
	}{
		{
			name:   "another of the Clip's Takes",
			clip:   takesClip(1, 10, 0, 20, Take{ID: 7, Number: 1}, Take{ID: 8, Number: 2, Position: 10}),
			takeID: 8,
		},
		{
			name:    "a Take that isn't in the Clip",
			clip:    takesClip(1, 10, 0, 10, Take{ID: 7, Number: 1}),
			takeID:  9,
			refusal: "a Clip of Takes plays one of them",
		},
		{
			name:    "a Clip of a Beat",
			clip:    beatClip(1, 10, 10),
			takeID:  7,
			refusal: "only a Clip of Takes has Takes",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf([]Clip{tt.clip})
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.choosingTake(1, tt.takeID)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("choosingTake error = %v", err)
			}
			_, c, _ := after.clip(1)
			if c.ActiveTakeID == nil || *c.ActiveTakeID != tt.takeID {
				t.Errorf("the Clip plays Take %v, want %d", c.ActiveTakeID, tt.takeID)
			}
		})
	}
}

func TestNudgingTake(t *testing.T) {
	tests := []struct {
		name    string
		clip    Clip
		takeID  int64
		nudge   float64
		want    where
		wantAt  []float64
		refusal string
	}{
		{
			name:   "a Take nudged later, the Clip staying where it is",
			clip:   takesClip(1, 10, 0, 10, Take{ID: 7, Number: 1}),
			takeID: 7,
			nudge:  2,
			want:   where{clipID: 1, trackID: 1, start: 10, length: 10},
			wantAt: []float64{2},
		},
		{
			name:   "a Take nudged before the Clip's span, which starts earlier",
			clip:   takesClip(1, 10, 0, 10, Take{ID: 7, Number: 1}),
			takeID: 7,
			nudge:  -3,
			want:   where{clipID: 1, trackID: 1, start: 10, offset: 3, length: 10},
			wantAt: []float64{0},
		},
		{
			name:   "the other Takes staying where they are on the Timeline",
			clip:   takesClip(1, 10, 0, 10, Take{ID: 7, Number: 1}, Take{ID: 8, Number: 2, Position: 10}),
			takeID: 7,
			nudge:  -5,
			want:   where{clipID: 1, trackID: 1, start: 10, offset: 5, length: 10},
			wantAt: []float64{0, 15},
		},
		{
			name: "a Clip trimmed out to a Take nudged later, nudged back",
			// NudgeTake refuses this one in its own words.
			clip:    takesClip(1, 10, 0, 15, Take{ID: 7, Number: 1, Position: 5, Nudge: 5}),
			takeID:  7,
			nudge:   0,
			refusal: "a Clip can't play past the end of its source",
		},
		{
			name:    "a Take that isn't in the Clip",
			clip:    takesClip(1, 10, 0, 10, Take{ID: 7, Number: 1}),
			takeID:  9,
			nudge:   1,
			refusal: "not found",
		},
		{
			name:    "a Clip of a Beat",
			clip:    beatClip(1, 10, 10),
			takeID:  7,
			nudge:   1,
			refusal: "only a Clip of Takes has Takes",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf([]Clip{tt.clip})
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.nudgingTake(1, tt.takeID, tt.nudge)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("nudgingTake error = %v", err)
			}
			if got := clipIn(t, after, tt.want.clipID); got != tt.want {
				t.Errorf("the Clip = %+v, want %+v", got, tt.want)
			}
			_, c, _ := after.clip(1)
			if got := takePositions(c); !reflect.DeepEqual(got, tt.wantAt) {
				t.Errorf("its Takes start at %v in its span, want %v", got, tt.wantAt)
			}
			if got := c.Takes[0].Nudge; tt.takeID == 7 && got != tt.nudge {
				t.Errorf("the Take is nudged by %g, want %g", got, tt.nudge)
			}
		})
	}
}
