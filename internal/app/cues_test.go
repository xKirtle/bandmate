package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// cuePath is where an Occurrence's Cue lives.
func cuePath(songID, occurrenceID int64) string {
	return fmt.Sprintf("/api/songs/%d/occurrences/%d/cue", songID, occurrenceID)
}

// setCue gives an Occurrence a Cue, in seconds, and returns the Song.
func (ts *testServer) setCue(songID, occurrenceID int64, seconds float64) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPut, cuePath(songID, occurrenceID), map[string]any{"cue": seconds})
}

// cues lists the Arrangement's Occurrence Cues in order, with -1 for none.
func cues(s song) []float64 {
	out := []float64{}
	for _, o := range s.Arrangement {
		if o.Cue == nil {
			out = append(out, -1)
		} else {
			out = append(out, *o.Cue)
		}
	}
	return out
}

func TestAnOccurrenceStartsWithoutACue(t *testing.T) {
	ts := newTestServer(t)

	s := ts.songWithSections("Verse", "Chorus")

	if want := []float64{-1, -1}; !reflect.DeepEqual(cues(s), want) {
		t.Errorf("cues = %v, want %v", cues(s), want)
	}
}

func TestAnOccurrenceCueCanBeSetToTheMillisecond(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse", "Chorus")

	got := ts.setCue(before.ID, before.Arrangement[1].ID, 45.2519)

	if want := []float64{-1, 45.252}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
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

func TestSettingAnOccurrenceCueAgainReplacesIt(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	ts.setCue(s.ID, s.Arrangement[0].ID, 10)

	got := ts.setCue(s.ID, s.Arrangement[0].ID, 0)

	if want := []float64{0}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
}

func TestAnOccurrenceCueCanBeCleared(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse", "Chorus")
	ts.setCue(s.ID, s.Arrangement[0].ID, 3)
	before := ts.setCue(s.ID, s.Arrangement[1].ID, 20)

	got := ts.lyricSheetChange(http.MethodDelete, cuePath(s.ID, s.Arrangement[0].ID), nil)

	if want := []float64{-1, 20}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	if got.Version == before.Version {
		t.Errorf("version = %d, want it changed", got.Version)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
}

func TestClearingAnOccurrenceCueBasedOnAnOldVersionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	old := ts.setCue(s.ID, s.Arrangement[0].ID, 3)
	current := ts.setLabel(s.ID, s.Sections[0].ID, "Verse 1")

	expectStale(t, ts.DoAt(old.Version, http.MethodDelete, cuePath(s.ID, s.Arrangement[0].ID), nil))

	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, current) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, current)
	}
}

func TestEachOccurrenceOfASharedSectionHasItsOwnCue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	ids := occurrenceIDs(s)

	ts.setCue(s.ID, ids[0], 5)
	got := ts.setCue(s.ID, ids[3], 95)

	if want := []float64{5, -1, -1, 95}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
}

func TestAnOccurrenceCueMayLiePastTheEndOfTheTimeline(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")

	got := ts.setCue(s.ID, s.Arrangement[0].ID, 3600)

	if want := []float64{3600}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
}

func TestInvalidOccurrenceCuesAreRejected(t *testing.T) {
	cases := []struct {
		name string
		body any
		msg  string
	}{
		{"negative", map[string]any{"cue": -0.5}, "a Cue can't be before the start of the Timeline"},
		{"missing", map[string]any{}, "cue is required"},
		{"null", map[string]any{"cue": nil}, "cue is required"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			s := ts.songWithSections("Verse")
			ts.setCue(s.ID, s.Arrangement[0].ID, 7)
			before := ts.getSong(s.ID)

			res := ts.Do(http.MethodPut, cuePath(s.ID, s.Arrangement[0].ID), c.body)

			expectError(t, res, http.StatusBadRequest, c.msg)
			if read := ts.getSong(s.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
}

func TestCueingAnOccurrenceOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.songWithSections("Chorus")
	s := ts.songWithSections("Verse")

	for _, res := range []response{
		ts.Do(http.MethodPut, cuePath(s.ID, other.Arrangement[0].ID), map[string]any{"cue": 1}),
		ts.Do(http.MethodDelete, cuePath(s.ID, other.Arrangement[0].ID), nil),
	} {
		expectError(t, res, http.StatusNotFound, "not found")
	}
	if got := ts.getSong(other.ID); !reflect.DeepEqual(cues(got), []float64{-1}) {
		t.Errorf("other song's cues = %v, want none", cues(got))
	}
}

func TestReorderingAndDetachingKeepOccurrenceCues(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	ids := occurrenceIDs(s)
	ts.setCue(s.ID, ids[1], 20)
	ts.setCue(s.ID, ids[2], 40)

	got := ts.lyricSheetChange(http.MethodPut, reorderPath(s.ID),
		map[string]any{"occurrences": []int64{ids[2], ids[0], ids[1], ids[3]}})
	got = ts.lyricSheetChange(http.MethodPost, detachPath(s.ID, ids[2]), nil)

	if want := []float64{40, -1, 20, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
}
