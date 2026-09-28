package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// cueShiftPath is where a Song's Cues in a span are shifted.
func cueShiftPath(songID int64) string {
	return fmt.Sprintf("/api/songs/%d/cues/shift", songID)
}

// shiftCues shifts the Song's Cues in [start, end) by the given seconds
// and returns the Song.
func (ts *testServer) shiftCues(songID int64, start, end, by float64) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPost, cueShiftPath(songID),
		map[string]any{"start": start, "end": end, "by": by})
}

func TestShiftingCuesMovesThoseInTheSpanDormantOnesIncluded(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorus()
	drive, night, _, _ := chorusLines(before)
	dormant := before.Sections[0].Alternates[1].Lines[1].ID

	// The Cues are 1 (the first Occurrence and its first Line), 3, then 20
	// (the third Occurrence), 22 and 23 (dormant).
	got := ts.shiftCues(before.ID, 3, 23, 1.5)

	if want := []float64{1, -1, 21.5, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	want := []map[int64]float64{{drive: 1, night: 4.5}, {}, {night: 23.5, dormant: 23}, {}}
	if !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
	}
	if got.Version == before.Version {
		t.Errorf("version = %d, want it changed", got.Version)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(before.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestShiftingCuesTakesTheSpansStartButNotItsEnd(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorus()
	drive, night, _, _ := chorusLines(before)
	dormant := before.Sections[0].Alternates[1].Lines[1].ID

	got := ts.shiftCues(before.ID, 20, 22, 10)

	if want := []float64{1, -1, 30, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	want := []map[int64]float64{{drive: 1, night: 3}, {}, {night: 22, dormant: 23}, {}}
	if !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
	}
}

func TestShiftingCuesEarlierMayTakeThemToZero(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorus()
	drive, night, _, _ := chorusLines(before)
	dormant := before.Sections[0].Alternates[1].Lines[1].ID

	got := ts.shiftCues(before.ID, 0, 10, -1)

	if want := []float64{0, -1, 20, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	want := []map[int64]float64{{drive: 0, night: 2}, {}, {night: 22, dormant: 23}, {}}
	if !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
	}
}

// everyCueEnd ends the span the Lyric Sheet's Shift Cues controls shift: from
// 0:00 to past the latest a Cue can be, 24 hours in.
const everyCueEnd = 24*60*60 + 1

// Shifting a span from 0:00 to past the latest Cue shifts the whole Song's
// Cues.
func TestShiftingEveryCueMovesThemAllDormantOnesIncluded(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorus()
	drive, night, _, _ := chorusLines(before)
	dormant := before.Sections[0].Alternates[1].Lines[1].ID

	later := ts.shiftCues(before.ID, 0, everyCueEnd, 0.5)

	if want := []float64{1.5, -1, 20.5, -1}; !reflect.DeepEqual(cues(later), want) {
		t.Errorf("cues = %v, want %v", cues(later), want)
	}
	want := []map[int64]float64{{drive: 1.5, night: 3.5}, {}, {night: 22.5, dormant: 23.5}, {}}
	if !reflect.DeepEqual(lineCues(later), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(later), want)
	}

	// Earlier, as far as the earliest Cue reaching 0:00.
	got := ts.shiftCues(before.ID, 0, everyCueEnd, -1.5)

	if want := []float64{0, -1, 19, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	want = []map[int64]float64{{drive: 0, night: 2}, {}, {night: 21, dormant: 22}, {}}
	if !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
	}
}

func TestShiftingCuesLeavesOtherSongsAlone(t *testing.T) {
	ts := newTestServer(t)
	other := ts.cuedChorus()
	s := ts.cuedChorus()

	ts.shiftCues(s.ID, 0, 100, 5)

	if read := ts.getSong(other.ID); !reflect.DeepEqual(read, other) {
		t.Errorf("other song = %+v, want it unchanged: %+v", read, other)
	}
}

func TestInvalidCueShiftsAreRejected(t *testing.T) {
	cases := []struct {
		name string
		body any
		msg  string
	}{
		{"below zero", map[string]any{"start": 0, "end": 10, "by": -1.5},
			"a Cue can't be before the start of the Timeline"},
		{"every Cue, one of them below zero", map[string]any{"start": 0, "end": everyCueEnd, "by": -1.1},
			"a Cue can't be before the start of the Timeline"},
		{"a dormant one below zero", map[string]any{"start": 21, "end": 24, "by": -22.5},
			"a Cue can't be before the start of the Timeline"},
		{"absurdly late", map[string]any{"start": 0, "end": 10, "by": 1e17},
			"a Cue can't be more than 24 hours into the Timeline"},
		{"span ending before it starts", map[string]any{"start": 10, "end": 5, "by": 1},
			"the span must end after it starts"},
		{"missing start", map[string]any{"end": 10, "by": 1}, "start, end and by are required"},
		{"missing end", map[string]any{"start": 0, "by": 1}, "start, end and by are required"},
		{"missing by", map[string]any{"start": 0, "end": 10}, "start, end and by are required"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			before := ts.cuedChorus()

			res := ts.Do(http.MethodPost, cueShiftPath(before.ID), c.body)

			expectError(t, res, http.StatusBadRequest, c.msg)
			if read := ts.getSong(before.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
}

func TestShiftingCuesBasedOnAnOldVersionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	old := ts.cuedChorus()
	current := ts.setLabel(old.ID, old.Sections[0].ID, "Hook")

	expectStale(t, ts.DoAt(old.Version, http.MethodPost, cueShiftPath(old.ID),
		map[string]any{"start": 0, "end": 10, "by": 1}))

	if read := ts.getSong(old.ID); !reflect.DeepEqual(read, current) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, current)
	}
}
