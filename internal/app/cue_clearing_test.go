package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// occurrenceCuesPath is where all of an Occurrence's Cues live.
func occurrenceCuesPath(songID, occurrenceID int64) string {
	return fmt.Sprintf("/api/songs/%d/occurrences/%d/cues", songID, occurrenceID)
}

// songCuesPath is where all of a Song's Cues live.
func songCuesPath(songID int64) string {
	return fmt.Sprintf("/api/songs/%d/cues", songID)
}

// cueValue is one Cue to restore: a Line's within an Occurrence; a nil Cue
// means none.
type cueValue struct {
	OccurrenceID int64    `json:"occurrenceId"`
	LineID       *int64   `json:"lineId,omitempty"`
	Cue          *float64 `json:"cue"`
}

// restoreCues sets each Cue given to its value and returns the Song.
func (ts *testServer) restoreCues(songID int64, values ...cueValue) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPatch, songCuesPath(songID), map[string]any{"cues": values})
}

// lineCues lists the Arrangement's Line Cues, dormant ones included, in order.
func lineCues(s song) []map[int64]float64 {
	out := []map[int64]float64{}
	for _, o := range s.Arrangement {
		out = append(out, o.LineCues)
	}
	return out
}

// cuedChorus returns a Song like duplicatedChorus whose chorus got a second
// Alternate before it was Duplicated, with Cues on the first and third
// Occurrences: the third Occurrence's include one on its second Alternate.
func (ts *testServer) cuedChorus() song {
	ts.t.Helper()
	s := ts.songWithSections("Chorus", "Verse")
	chorus := s.Sections[0]
	ts.setText(s.ID, chorus.Alternates[0].ID, "Drive, [Am]drive\nall [F]night\n\n[C] [G]")
	ts.addAlternate(s.ID, chorus.ID, map[string]any{"name": "B"})
	ts.duplicate(s.ID, chorus.ID, nil)
	s = ts.duplicate(s.ID, chorus.ID, nil)
	drive, night, _, _ := chorusLines(s)
	thirdDrive, thirdNight, thirdB := thirdChorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 1)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 3)
	ts.setLineCue(s.ID, s.Arrangement[2].ID, thirdDrive, 20)
	ts.setLineCue(s.ID, s.Arrangement[2].ID, thirdNight, 22)
	return ts.setLineCue(s.ID, s.Arrangement[2].ID, thirdB, 23)
}

// thirdChorusLines returns the ids of the Lines cuedChorus cues in its third
// Occurrence: "Drive, drive" and "all night" in its first Alternate, and
// "all night" in its second.
func thirdChorusLines(s song) (drive, night, b int64) {
	sec := sectionsByID(s)[s.Arrangement[2].SectionID]
	return sec.Alternates[0].Lines[0].ID, sec.Alternates[0].Lines[1].ID, sec.Alternates[1].Lines[1].ID
}

func ptr[T any](v T) *T { return &v }

func TestClearingAnOccurrencesCuesClearsAllItsLines(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorus()
	drive, night, _, _ := chorusLines(before)

	got := ts.lyricSheetChange(http.MethodDelete, occurrenceCuesPath(before.ID, before.Arrangement[2].ID), nil)

	want := []map[int64]float64{{drive: 1, night: 3}, {}, {}, {}}
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

func TestClearingAllCuesLeavesOtherSongsAlone(t *testing.T) {
	ts := newTestServer(t)
	other := ts.cuedChorus()
	before := ts.cuedChorus()

	got := ts.lyricSheetChange(http.MethodDelete, songCuesPath(before.ID), nil)

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

func TestRestoringCuesSetsAndClearsExactlyThoseGiven(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorus()
	drive, night, _, chords := chorusLines(before)
	thirdDrive, _, _, _ := chorusLinesAt(before, 2)
	lastDrive, _, _, _ := chorusLinesAt(before, 3)
	first, third := before.Arrangement[0].ID, before.Arrangement[2].ID

	got := ts.restoreCues(before.ID,
		cueValue{OccurrenceID: first, LineID: &drive, Cue: ptr(2.5)},
		cueValue{OccurrenceID: first, LineID: &night, Cue: nil},
		cueValue{OccurrenceID: first, LineID: &chords, Cue: ptr(4.25)},
		cueValue{OccurrenceID: third, LineID: &thirdDrive, Cue: nil},
		cueValue{OccurrenceID: before.Arrangement[3].ID, LineID: &lastDrive, Cue: ptr(40.0)},
	)

	want := lineCues(before)
	want[0] = map[int64]float64{drive: 2.5, chords: 4.25}
	delete(want[2], thirdDrive)
	want[3] = map[int64]float64{lastDrive: 40}
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

func TestRestoringCuesPutsBackWhatAClearTook(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorus()
	cleared := ts.lyricSheetChange(http.MethodDelete, songCuesPath(before.ID), nil)

	var values []cueValue
	for _, o := range before.Arrangement {
		for line, cue := range o.LineCues {
			values = append(values, cueValue{OccurrenceID: o.ID, LineID: ptr(line), Cue: ptr(cue)})
		}
	}
	got := ts.restoreCues(cleared.ID, values...)

	if !reflect.DeepEqual(lineCues(got), lineCues(before)) {
		t.Errorf("lineCues = %v, want them back as %v", lineCues(got), lineCues(before))
	}
}

func TestInvalidCueRestoresAreRejected(t *testing.T) {
	cases := []struct {
		name   string
		values func(s song) any
		status int
		msg    string
	}{
		{"no cues", func(s song) any { return map[string]any{} }, http.StatusBadRequest, "cues is required"},
		{"no Line", func(s song) any {
			return []cueValue{{OccurrenceID: s.Arrangement[1].ID, Cue: ptr(3.0)}}
		}, http.StatusBadRequest, "each Cue needs a lineId"},
		{"negative", func(s song) any {
			drive, _, _, _ := chorusLinesAt(s, 2)
			return []cueValue{{OccurrenceID: s.Arrangement[2].ID, LineID: &drive, Cue: ptr(-1.0)}}
		}, http.StatusBadRequest, "a Cue can't be before the start of the Timeline"},
		{"blank Line", func(s song) any {
			_, _, blank, _ := chorusLines(s)
			return []cueValue{{OccurrenceID: s.Arrangement[0].ID, LineID: &blank, Cue: ptr(3.0)}}
		}, http.StatusBadRequest, "a blank Line can't have a Cue"},
		{"Line of another Section", func(s song) any {
			return []cueValue{{OccurrenceID: s.Arrangement[0].ID, LineID: &s.Sections[1].Alternates[0].Lines[0].ID, Cue: ptr(3.0)}}
		}, http.StatusBadRequest, "that Line isn't in this Occurrence's Section"},
		{"Occurrence of another Song", func(s song) any {
			drive, _, _, _ := chorusLines(s)
			return []cueValue{{OccurrenceID: 999999, LineID: &drive, Cue: ptr(3.0)}}
		}, http.StatusNotFound, "not found"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			ts.cuedChorus()
			s := ts.cuedChorus()
			ts.setText(s.ID, s.Sections[1].Alternates[0].ID, "A verse Line")
			before := ts.getSong(s.ID)
			body := c.values(before)
			if values, ok := body.([]cueValue); ok {
				// A valid Cue before the invalid one isn't kept either.
				drive, _, _, _ := chorusLinesAt(before, 2)
				valid := cueValue{OccurrenceID: s.Arrangement[2].ID, LineID: &drive, Cue: ptr(9.0)}
				body = map[string]any{"cues": append([]cueValue{valid}, values...)}
			}

			res := ts.Do(http.MethodPatch, songCuesPath(s.ID), body)

			expectError(t, res, c.status, c.msg)
			if read := ts.getSong(s.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
}

func TestCueClearsAndRestoresBasedOnAnOldVersionAreRejected(t *testing.T) {
	ts := newTestServer(t)
	old := ts.cuedChorus()
	current := ts.setLabel(old.ID, old.Sections[0].ID, "Hook")

	for _, res := range []response{
		ts.DoAt(old.Version, http.MethodDelete, occurrenceCuesPath(old.ID, old.Arrangement[0].ID), nil),
		ts.DoAt(old.Version, http.MethodDelete, songCuesPath(old.ID), nil),
		ts.DoAt(old.Version, http.MethodPatch, songCuesPath(old.ID),
			map[string]any{"cues": []cueValue{{OccurrenceID: old.Arrangement[0].ID, LineID: &old.Sections[0].Alternates[0].Lines[0].ID, Cue: nil}}}),
	} {
		expectStale(t, res)
	}
	if read := ts.getSong(old.ID); !reflect.DeepEqual(read, current) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, current)
	}
}
