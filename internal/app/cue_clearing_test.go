package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// Clearing an Occurrence's Cues or all of a Song's, and restoring a set of
// Cues, which is how undo puts back what a Cue edit changed.

// songCuesPath is where all of a Song's Cues live.
func songCuesPath(songID int64) string {
	return fmt.Sprintf("/api/songs/%d/cues", songID)
}

// occurrenceCuesPath is where all of an Occurrence's Cues live.
func occurrenceCuesPath(songID, occurrenceID int64) string {
	return fmt.Sprintf("/api/songs/%d/occurrences/%d/cues", songID, occurrenceID)
}

// restoreCues sets the given Cues to the given values and returns the Song.
func (ts *testServer) restoreCues(songID int64, cues ...map[string]any) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPatch, songCuesPath(songID), map[string]any{"cues": cues})
}

// lineCues lists the Arrangement's Line Cues in order.
func lineCues(s song) []map[int64]float64 {
	out := []map[int64]float64{}
	for _, o := range s.Arrangement {
		out = append(out, o.LineCues)
	}
	return out
}

// cuedChorus returns sharedChorus with a second, inactive Alternate copied
// from the first, and two of its Occurrences cued: the first at 2, with
// "Drive, drive" at 2 and "all night" at 6, and the last at 90, with "all
// night" at 95.
func (ts *testServer) cuedChorus() song {
	ts.t.Helper()
	s := ts.sharedChorus()
	drive, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 2)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 6)
	ts.addAlternate(s.ID, s.Sections[0].ID, map[string]any{"name": "B"})
	ts.setCue(s.ID, s.Arrangement[3].ID, 90)
	return ts.setLineCue(s.ID, s.Arrangement[3].ID, night, 95)
}

func TestClearingAnOccurrencesCuesClearsItsOwnAndAllItsLines(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorus()
	_, night, _, _ := chorusLines(before)
	dormant := before.Sections[0].Alternates[1].Lines[1].ID
	ts.setLineCue(before.ID, before.Arrangement[0].ID, dormant, 7)
	before = ts.setCue(before.ID, before.Arrangement[1].ID, 40)

	got := ts.lyricSheetChange(http.MethodDelete, occurrenceCuesPath(before.ID, before.Arrangement[0].ID), nil)

	if want := []float64{-1, 40, -1, 90}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	want := []map[int64]float64{{}, {}, {}, {night: 95}}
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

func TestClearingAllCuesClearsEveryOccurrenceAndLine(t *testing.T) {
	ts := newTestServer(t)
	other := ts.cuedChorus()
	before := ts.cuedChorus()

	got := ts.lyricSheetChange(http.MethodDelete, songCuesPath(before.ID), nil)

	if want := []float64{-1, -1, -1, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	if want := []map[int64]float64{{}, {}, {}, {}}; !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
	}
	if got.Version == before.Version {
		t.Errorf("version = %d, want it changed", got.Version)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(other.ID); !reflect.DeepEqual(read, other) {
		t.Errorf("other song = %+v, want it unchanged: %+v", read, other)
	}
}

func TestClearingASongWithoutCuesStillMarksItEdited(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse")

	got := ts.lyricSheetChange(http.MethodDelete, songCuesPath(before.ID), nil)

	if got.Version == before.Version {
		t.Errorf("version = %d, want it changed", got.Version)
	}
}

func TestClearingTheCuesOfAnOccurrenceOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.cuedChorus()
	s := ts.songWithSections("Verse")

	expectError(t, ts.Do(http.MethodDelete, occurrenceCuesPath(s.ID, other.Arrangement[0].ID), nil),
		http.StatusNotFound, "not found")

	if read := ts.getSong(other.ID); !reflect.DeepEqual(read, other) {
		t.Errorf("other song = %+v, want it unchanged: %+v", read, other)
	}
}

func TestRestoringCuesSetsAndClearsExactlyTheOnesGiven(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorus()
	drive, night, _, chords := chorusLines(before)
	ids := occurrenceIDs(before)

	got := ts.restoreCues(before.ID,
		map[string]any{"occurrenceId": ids[0], "cue": nil},
		map[string]any{"occurrenceId": ids[0], "lineId": night, "cue": nil},
		map[string]any{"occurrenceId": ids[1], "cue": 30.1234},
		map[string]any{"occurrenceId": ids[3], "lineId": chords, "cue": 99},
	)

	if want := []float64{-1, 30.123, -1, 90}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	want := []map[int64]float64{{drive: 2}, {}, {}, {night: 95, chords: 99}}
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

func TestRestoringCuesPutsBackWhatAClearTookAway(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorus()
	drive, night, _, _ := chorusLines(before)
	dormant := before.Sections[0].Alternates[1].Lines[1].ID
	before = ts.setLineCue(before.ID, before.Arrangement[0].ID, dormant, 7)
	ids := occurrenceIDs(before)
	ts.lyricSheetChange(http.MethodDelete, songCuesPath(before.ID), nil)

	got := ts.restoreCues(before.ID,
		map[string]any{"occurrenceId": ids[0], "cue": 2},
		map[string]any{"occurrenceId": ids[0], "lineId": drive, "cue": 2},
		map[string]any{"occurrenceId": ids[0], "lineId": night, "cue": 6},
		map[string]any{"occurrenceId": ids[0], "lineId": dormant, "cue": 7},
		map[string]any{"occurrenceId": ids[3], "cue": 90},
		map[string]any{"occurrenceId": ids[3], "lineId": night, "cue": 95},
	)

	if !reflect.DeepEqual(got.Arrangement, before.Arrangement) {
		t.Errorf("arrangement = %+v, want it as before the clear: %+v", got.Arrangement, before.Arrangement)
	}
}

func TestRestoringCuesKeepsTheOccurrenceAndItsFirstLineAsGiven(t *testing.T) {
	ts := newTestServer(t)
	s := ts.cuedChorus()
	drive, _, _, _ := chorusLines(s)

	got := ts.restoreCues(s.ID, map[string]any{"occurrenceId": s.Arrangement[0].ID, "lineId": drive, "cue": 3})

	if want := []float64{2, -1, -1, 90}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}

	got = ts.restoreCues(s.ID, map[string]any{"occurrenceId": s.Arrangement[0].ID, "cue": 4})

	if got.Arrangement[0].LineCues[drive] != 3 {
		t.Errorf("first Line's cue = %v, want 3 kept", got.Arrangement[0].LineCues[drive])
	}
}

func TestRestoringCuesLeavesOutOnesWhoseOccurrenceOrLineIsGone(t *testing.T) {
	ts := newTestServer(t)
	other := ts.cuedChorus()
	s := ts.cuedChorus()
	drive, night, _, _ := chorusLines(s)
	removed := s.Arrangement[3].ID
	ts.lyricSheetChange(http.MethodDelete, occurrencePath(s.ID, removed), nil)
	s = ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "Drive, [Am]drive\n\n[C] [G]")

	got := ts.restoreCues(s.ID,
		map[string]any{"occurrenceId": removed, "cue": 1},
		map[string]any{"occurrenceId": other.Arrangement[0].ID, "cue": 1},
		map[string]any{"occurrenceId": s.Arrangement[0].ID, "lineId": night, "cue": 1},
		map[string]any{"occurrenceId": s.Arrangement[0].ID, "lineId": s.Sections[0].Alternates[0].Lines[1].ID, "cue": 1},
		map[string]any{"occurrenceId": s.Arrangement[1].ID, "lineId": drive, "cue": 1},
		map[string]any{"occurrenceId": s.Arrangement[2].ID, "cue": 50},
		map[string]any{"occurrenceId": s.Arrangement[2].ID, "lineId": drive, "cue": 51},
	)

	if want := []float64{2, -1, 50}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	if want := []map[int64]float64{{drive: 2}, {}, {drive: 51}}; !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
	}
	if read := ts.getSong(other.ID); !reflect.DeepEqual(read, other) {
		t.Errorf("other song = %+v, want it unchanged: %+v", read, other)
	}
}

func TestInvalidCueRestoresAreRejected(t *testing.T) {
	cases := []struct {
		name string
		body any
		msg  string
	}{
		{"negative", map[string]any{"cues": []map[string]any{{"occurrenceId": 0, "cue": 5}, {"occurrenceId": 0, "cue": -1}}},
			"a Cue can't be before the start of the Timeline"},
		{"absurdly late", map[string]any{"cues": []map[string]any{{"occurrenceId": 0, "cue": 1e17}}},
			"a Cue can't be more than 24 hours into the Timeline"},
		{"no list", map[string]any{}, "cues is required"},
		{"no Occurrence", map[string]any{"cues": []map[string]any{{"cue": 5}}}, "each Cue needs an occurrenceId"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			before := ts.cuedChorus()
			// The Cues name the first Occurrence, whose id isn't known up front.
			if list, ok := c.body.(map[string]any)["cues"].([]map[string]any); ok {
				for _, cue := range list {
					if _, ok := cue["occurrenceId"]; ok {
						cue["occurrenceId"] = before.Arrangement[0].ID
					}
				}
			}

			res := ts.Do(http.MethodPatch, songCuesPath(before.ID), c.body)

			expectError(t, res, http.StatusBadRequest, c.msg)
			if read := ts.getSong(before.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
}

func TestClearingAndRestoringCuesBasedOnAnOldVersionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	old := ts.cuedChorus()
	current := ts.setLabel(old.ID, old.Sections[0].ID, "Hook")

	for _, res := range []response{
		ts.DoAt(old.Version, http.MethodDelete, songCuesPath(old.ID), nil),
		ts.DoAt(old.Version, http.MethodDelete, occurrenceCuesPath(old.ID, old.Arrangement[0].ID), nil),
		ts.DoAt(old.Version, http.MethodPatch, songCuesPath(old.ID),
			map[string]any{"cues": []map[string]any{{"occurrenceId": old.Arrangement[0].ID, "cue": nil}}}),
	} {
		expectStale(t, res)
	}
	if read := ts.getSong(old.ID); !reflect.DeepEqual(read, current) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, current)
	}
}
