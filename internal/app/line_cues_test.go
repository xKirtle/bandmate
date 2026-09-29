package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// lineCuePath is where a Line's Cue lives.
func lineCuePath(songID, lineID int64) string {
	return fmt.Sprintf("/api/songs/%d/lines/%d/cue", songID, lineID)
}

// setLineCue gives a Line a Cue, in seconds, and returns the Song.
func (ts *testServer) setLineCue(songID, lineID int64, seconds float64) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPut, lineCuePath(songID, lineID), map[string]any{"cue": seconds})
}

// clearLineCue removes a Line's Cue and returns the Song.
func (ts *testServer) clearLineCue(songID, lineID int64) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodDelete, lineCuePath(songID, lineID), nil)
}

// chorusLines returns the ids of the first chorus's Lines in
// duplicatedChorus: "Drive, drive", "all night", the blank Line and the Chord
// Line.
func chorusLines(s song) (drive, night, blank, chords int64) {
	lines := s.Sections[0].Alternates[0].Lines
	return lines[0].ID, lines[1].ID, lines[2].ID, lines[3].ID
}

// chorusLinesAt is chorusLines for the chorus at place i in the Arrangement
// of duplicatedChorus, e.g. one of its Duplicates.
func chorusLinesAt(s song, i int) (drive, night, blank, chords int64) {
	lines := sectionsByID(s)[s.Arrangement[i]].Alternates[0].Lines
	return lines[0].ID, lines[1].ID, lines[2].ID, lines[3].ID
}

func TestLinesStartWithoutCues(t *testing.T) {
	ts := newTestServer(t)

	s := ts.duplicatedChorus()

	if cues := songCues(s); len(cues) != 0 {
		t.Errorf("cues = %v, want none", cues)
	}
}

func TestALineCueCanBeSetToTheMillisecond(t *testing.T) {
	ts := newTestServer(t)
	before := ts.duplicatedChorus()
	_, night, _, _ := chorusLines(before)

	got := ts.setLineCue(before.ID, night, 12.3456)

	if want := map[int64]float64{night: 12.346}; !reflect.DeepEqual(songCues(got), want) {
		t.Errorf("cues = %v, want %v", songCues(got), want)
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
	s := ts.duplicatedChorus()
	_, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, night, 12)

	got := ts.setLineCue(s.ID, night, 13.5)

	if want := map[int64]float64{night: 13.5}; !reflect.DeepEqual(songCues(got), want) {
		t.Errorf("cues = %v, want %v", songCues(got), want)
	}
}

func TestALineCueCanBeCleared(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	_, night, _, chords := chorusLines(s)
	ts.setLineCue(s.ID, night, 12)
	before := ts.setLineCue(s.ID, chords, 16)

	got := ts.clearLineCue(s.ID, night)

	if want := map[int64]float64{chords: 16}; !reflect.DeepEqual(songCues(got), want) {
		t.Errorf("cues = %v, want %v", songCues(got), want)
	}
	if got.Version == before.Version {
		t.Errorf("version = %d, want it changed", got.Version)
	}
}

func TestAChordLineCanHaveACue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	_, _, _, chords := chorusLines(s)

	got := ts.setLineCue(s.ID, chords, 20)

	if want := map[int64]float64{chords: 20}; !reflect.DeepEqual(songCues(got), want) {
		t.Errorf("cues = %v, want %v", songCues(got), want)
	}
}

func TestADuplicatesLinesHaveTheirOwnCues(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	_, night, _, _ := chorusLines(s)
	_, lastNight, _, _ := chorusLinesAt(s, 3)

	ts.setLineCue(s.ID, night, 4)
	got := ts.setLineCue(s.ID, lastNight, 94)

	want := []map[int64]float64{{night: 4}, {}, {}, {lastNight: 94}}
	if !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
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
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			s := ts.duplicatedChorus()
			ts.setText(s.ID, s.Sections[1].Alternates[0].ID, "A verse Line")
			before := ts.getSong(s.ID)

			res := ts.Do(http.MethodPut, lineCuePath(s.ID, c.line(before)), c.body)

			expectError(t, res, http.StatusBadRequest, c.msg)
			if read := ts.getSong(s.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
}

func TestCueingALineOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.duplicatedChorus()
	s := ts.songWithSections("Verse")
	_, night, _, _ := chorusLines(other)

	for _, res := range []response{
		ts.Do(http.MethodPut, lineCuePath(s.ID, night), map[string]any{"cue": 1}),
		ts.Do(http.MethodDelete, lineCuePath(s.ID, night), nil),
		ts.Do(http.MethodPut, lineCuePath(s.ID, 999999), map[string]any{"cue": 1}),
	} {
		expectError(t, res, http.StatusNotFound, "not found")
	}
	if read := ts.getSong(other.ID); !reflect.DeepEqual(read, other) {
		t.Errorf("other song = %+v, want it unchanged: %+v", read, other)
	}
}

func TestCueingALineInTheScrapbookIsRefused(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	s = ts.addToScrapbook(s.ID, "Bridge")
	before := ts.setText(s.ID, s.Sections[1].Alternates[0].ID, "Somewhere")

	res := ts.Do(http.MethodPut, lineCuePath(s.ID, before.Sections[1].Alternates[0].Lines[0].ID), map[string]any{"cue": 3})

	expectError(t, res, http.StatusConflict, "a Line in the Scrapbook can't have a Cue")
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, before)
	}
}

func TestALineOfAnInactiveAlternateCanHaveACue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	s = ts.lyricSheetChange(http.MethodPost,
		fmt.Sprintf("/api/songs/%d/sections/%d/alternates", s.ID, s.Sections[0].ID), map[string]any{"name": "B"})
	dormant := s.Sections[0].Alternates[1].Lines[1].ID

	got := ts.setLineCue(s.ID, dormant, 9)

	if want := map[int64]float64{dormant: 9}; !reflect.DeepEqual(songCues(got), want) {
		t.Errorf("cues = %v, want %v", songCues(got), want)
	}
}

func TestClearingALineCueBasedOnAnOldVersionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	_, night, _, _ := chorusLines(s)
	old := ts.setLineCue(s.ID, night, 3)
	current := ts.setLabel(s.ID, s.Sections[0].ID, "Hook")

	expectStale(t, ts.DoAt(old.Version, http.MethodDelete, lineCuePath(s.ID, night), nil))

	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, current) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, current)
	}
}
