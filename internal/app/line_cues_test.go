package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// lineCuePath is where a Line's Cue within an Occurrence lives.
func lineCuePath(songID, occurrenceID, lineID int64) string {
	return fmt.Sprintf("/api/songs/%d/occurrences/%d/lines/%d/cue", songID, occurrenceID, lineID)
}

// setLineCue gives a Line a Cue within an Occurrence, in seconds, and
// returns the Song.
func (ts *testServer) setLineCue(songID, occurrenceID, lineID int64, seconds float64) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPut, lineCuePath(songID, occurrenceID, lineID), map[string]any{"cue": seconds})
}

// clearLineCue removes a Line's Cue within an Occurrence and returns the Song.
func (ts *testServer) clearLineCue(songID, occurrenceID, lineID int64) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodDelete, lineCuePath(songID, occurrenceID, lineID), nil)
}

// chorusLines returns the ids of sharedChorus's Lines: "Drive, drive",
// "all night", the blank Line and the Chord Line.
func chorusLines(s song) (drive, night, blank, chords int64) {
	lines := s.Sections[0].Alternates[0].Lines
	return lines[0].ID, lines[1].ID, lines[2].ID, lines[3].ID
}

func TestAnOccurrenceStartsWithoutLineCues(t *testing.T) {
	ts := newTestServer(t)

	s := ts.sharedChorus()

	for _, o := range s.Arrangement {
		if o.LineCues == nil || len(o.LineCues) != 0 {
			t.Errorf("occurrence %d lineCues = %v, want an empty map", o.ID, o.LineCues)
		}
	}
}

func TestALineCueCanBeSetToTheMillisecond(t *testing.T) {
	ts := newTestServer(t)
	before := ts.sharedChorus()
	_, night, _, _ := chorusLines(before)

	got := ts.setLineCue(before.ID, before.Arrangement[0].ID, night, 12.3456)

	if want := map[int64]float64{night: 12.346}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
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

func TestSettingALineCueAgainReplacesIt(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	_, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 12)

	got := ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 13.5)

	if want := map[int64]float64{night: 13.5}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
	}
}

func TestALineCueCanBeCleared(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	_, night, _, chords := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 12)
	before := ts.setLineCue(s.ID, s.Arrangement[0].ID, chords, 16)

	got := ts.clearLineCue(s.ID, s.Arrangement[0].ID, night)

	if want := map[int64]float64{chords: 16}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
	}
	if got.Version == before.Version {
		t.Errorf("version = %d, want it changed", got.Version)
	}
}

func TestAChordLineCanHaveACue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	_, _, _, chords := chorusLines(s)

	got := ts.setLineCue(s.ID, s.Arrangement[0].ID, chords, 20)

	if want := map[int64]float64{chords: 20}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
	}
}

func TestALineOfASharedSectionHasItsOwnCueInEachOccurrence(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	_, night, _, _ := chorusLines(s)
	ids := occurrenceIDs(s)

	ts.setLineCue(s.ID, ids[0], night, 4)
	got := ts.setLineCue(s.ID, ids[3], night, 94)

	want := []map[int64]float64{{night: 4}, {}, {}, {night: 94}}
	for i, o := range got.Arrangement {
		if !reflect.DeepEqual(o.LineCues, want[i]) {
			t.Errorf("occurrence %d lineCues = %v, want %v", i, o.LineCues, want[i])
		}
	}
}

func TestCueingTheFirstLineAlsoCuesTheOccurrence(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	drive, _, _, _ := chorusLines(s)
	ts.setCue(s.ID, s.Arrangement[2].ID, 30)

	got := ts.setLineCue(s.ID, s.Arrangement[2].ID, drive, 31.5)

	if want := []float64{-1, -1, 31.5, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	if want := map[int64]float64{drive: 31.5}; !reflect.DeepEqual(got.Arrangement[2].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[2].LineCues, want)
	}
}

func TestCueingALaterLineLeavesTheOccurrenceCueAlone(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	_, night, _, _ := chorusLines(s)

	got := ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 8)

	if want := []float64{-1, -1, -1, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
}

func TestCueingTheOccurrenceMovesItsFirstLinesCue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	drive, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 2)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 6)

	got := ts.setCue(s.ID, s.Arrangement[0].ID, 2.5)

	if want := map[int64]float64{drive: 2.5, night: 6}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
	}
}

func TestCueingTheOccurrenceGivesNoCueToAFirstLineWithout(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()

	got := ts.setCue(s.ID, s.Arrangement[0].ID, 2.5)

	if len(got.Arrangement[0].LineCues) != 0 {
		t.Errorf("lineCues = %v, want none", got.Arrangement[0].LineCues)
	}
}

func TestClearingTheFirstLinesCueLeavesTheOccurrenceCue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	drive, _, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 2)

	got := ts.clearLineCue(s.ID, s.Arrangement[0].ID, drive)

	if want := []float64{2, -1, -1, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	if len(got.Arrangement[0].LineCues) != 0 {
		t.Errorf("lineCues = %v, want none", got.Arrangement[0].LineCues)
	}
}

func TestTheFirstLineIsTheFirstThatCanTakeACue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	s = ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "\nFirst words\nSecond words")
	first := s.Sections[0].Alternates[0].Lines[1].ID

	got := ts.setLineCue(s.ID, s.Arrangement[0].ID, first, 7)

	if want := []float64{7}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
}

func TestInvalidLineCuesAreRejected(t *testing.T) {
	cases := []struct {
		name string
		line func(s song) int64
		body any
		msg  string
	}{
		{"negative", func(s song) int64 { _, n, _, _ := chorusLines(s); return n }, map[string]any{"cue": -1},
			"a Cue can't be before the start of the Timeline"},
		{"missing", func(s song) int64 { _, n, _, _ := chorusLines(s); return n }, map[string]any{},
			"cue is required"},
		{"blank Line", func(s song) int64 { _, _, b, _ := chorusLines(s); return b }, map[string]any{"cue": 3},
			"a blank Line can't have a Cue"},
		{"Line of another Section", func(s song) int64 { return s.Sections[1].Alternates[0].Lines[0].ID },
			map[string]any{"cue": 3}, "that Line isn't in this Occurrence's Section"},
		{"no such Line", func(s song) int64 { return 999999 }, map[string]any{"cue": 3},
			"that Line isn't in this Occurrence's Section"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			s := ts.sharedChorus()
			ts.setText(s.ID, s.Sections[1].Alternates[0].ID, "A verse Line")
			before := ts.getSong(s.ID)

			res := ts.Do(http.MethodPut, lineCuePath(s.ID, s.Arrangement[0].ID, c.line(before)), c.body)

			expectError(t, res, http.StatusBadRequest, c.msg)
			if read := ts.getSong(s.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
}

func TestCueingALineInAnOccurrenceOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.sharedChorus()
	s := ts.songWithSections("Verse")
	_, night, _, _ := chorusLines(other)

	for _, res := range []response{
		ts.Do(http.MethodPut, lineCuePath(s.ID, other.Arrangement[0].ID, night), map[string]any{"cue": 1}),
		ts.Do(http.MethodDelete, lineCuePath(s.ID, other.Arrangement[0].ID, night), nil),
	} {
		expectError(t, res, http.StatusNotFound, "not found")
	}
}

func TestALineOfAnInactiveAlternateCanHaveACue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	s = ts.lyricSheetChange(http.MethodPost,
		fmt.Sprintf("/api/songs/%d/sections/%d/alternates", s.ID, s.Sections[0].ID), map[string]any{"name": "B"})
	dormant := s.Sections[0].Alternates[1].Lines[1].ID

	got := ts.setLineCue(s.ID, s.Arrangement[0].ID, dormant, 9)

	if want := map[int64]float64{dormant: 9}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
	}
}

func TestClearingALineCueBasedOnAnOldVersionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	_, night, _, _ := chorusLines(s)
	old := ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 3)
	current := ts.setLabel(s.ID, s.Sections[0].ID, "Hook")

	expectStale(t, ts.DoAt(old.Version, http.MethodDelete, lineCuePath(s.ID, s.Arrangement[0].ID, night), nil))

	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, current) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, current)
	}
}
