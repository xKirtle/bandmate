package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// A Section appears at most once in the Arrangement (ADR 0010): a chorus
// sung twice is a Section and its Duplicate, an independent copy.

// addOccurrence puts a Section into the Arrangement and returns the Song.
// body may set "position".
func (ts *testServer) addOccurrence(songID, sectionID int64, body map[string]any) song {
	ts.t.Helper()
	if body == nil {
		body = map[string]any{}
	}
	body["sectionId"] = sectionID
	return ts.lyricSheetChange(http.MethodPost, fmt.Sprintf("/api/songs/%d/occurrences", songID), body)
}

// duplicatePath is where a Section is Duplicated.
func duplicatePath(songID, sectionID int64) string {
	return fmt.Sprintf("/api/songs/%d/sections/%d/duplicate", songID, sectionID)
}

// duplicate puts a Duplicate of a Section into the Arrangement and returns
// the Song. body may set "position".
func (ts *testServer) duplicate(songID, sectionID int64, body map[string]any) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPost, duplicatePath(songID, sectionID), body)
}

// sectionOf returns the Section an Occurrence shows.
func sectionOf(t *testing.T, s song, o occurrence) section {
	t.Helper()
	for _, sec := range s.Sections {
		if sec.ID == o.SectionID {
			return sec
		}
	}
	t.Fatalf("occurrence %d points at unknown section %d", o.ID, o.SectionID)
	return section{}
}

// activeLines lists the Line texts of a Section's active Alternate.
func activeLines(sec section) []string {
	for _, a := range sec.Alternates {
		if a.Active {
			return lineTexts(a)
		}
	}
	return nil
}

// withoutIDs is a Section's content: its Label, and its Alternates' names,
// active flags and Lines, with every id left out.
func withoutIDs(sec section) section {
	out := section{Label: sec.Label, Alternates: []alternate{}}
	for _, a := range sec.Alternates {
		lines := []line{}
		for _, l := range a.Lines {
			l.ID = 0
			lines = append(lines, l)
		}
		out.Alternates = append(out.Alternates, alternate{Name: a.Name, Active: a.Active, Lines: lines})
	}
	return out
}

// sharesIDs reports whether two Sections have the same id, or an Alternate
// or a Line in common.
func sharesIDs(a, b section) bool {
	alternates, lines := map[int64]bool{}, map[int64]bool{}
	for _, alt := range a.Alternates {
		alternates[alt.ID] = true
		for _, l := range alt.Lines {
			lines[l.ID] = true
		}
	}
	for _, alt := range b.Alternates {
		if alternates[alt.ID] {
			return true
		}
		for _, l := range alt.Lines {
			if lines[l.ID] {
				return true
			}
		}
	}
	return a.ID == b.ID
}

// duplicatedChorus returns a Song whose Arrangement is Chorus, Verse, Chorus,
// Chorus: one chorus with Lines and Chords, and two Duplicates of it.
func (ts *testServer) duplicatedChorus() song {
	ts.t.Helper()
	s := ts.songWithSections("Chorus", "Verse")
	chorus := s.Sections[0]
	ts.setText(s.ID, chorus.Alternates[0].ID, "Drive, [Am]drive\nall [F]night\n\n[C] [G]")
	ts.duplicate(s.ID, chorus.ID, nil)
	return ts.duplicate(s.ID, chorus.ID, nil)
}

// cuedChorusWithTwoAlternates returns a Song whose Arrangement is Chorus,
// Verse, with a second, named and active Alternate on the chorus, and Cues
// on Lines of both its Alternates.
func (ts *testServer) cuedChorusWithTwoAlternates() song {
	ts.t.Helper()
	s := ts.songWithSections("Chorus", "Verse")
	chorus := s.Sections[0]
	ts.setText(s.ID, chorus.Alternates[0].ID, "Drive, [Am]drive\nall [F]night")
	s = ts.addAlternate(s.ID, chorus.ID, map[string]any{"name": "Darker"})
	darker := s.Sections[0].Alternates[1]
	s = ts.setText(s.ID, darker.ID, "Drive, [Dm]drive\nall [Bb]night\nlonger")
	first := s.Sections[0].Alternates[0]
	ts.setLineCue(s.ID, s.Arrangement[0].ID, first.Lines[0].ID, 4)
	return ts.setLineCue(s.ID, s.Arrangement[0].ID, s.Sections[0].Alternates[1].Lines[2].ID, 12)
}

func TestDuplicatingASectionAddsAnIndependentCopyBelowIt(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorusWithTwoAlternates()
	chorus := before.Sections[0]

	got := ts.duplicate(before.ID, chorus.ID, map[string]any{"position": 1})

	if want := []string{"Chorus", "Chorus", "Verse"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Fatalf("arrangement = %q, want %q", arrangementLabels(got), want)
	}
	copied := sectionOf(t, got, got.Arrangement[1])
	if !reflect.DeepEqual(withoutIDs(copied), withoutIDs(chorus)) {
		t.Errorf("duplicate = %+v, want the same content as %+v", withoutIDs(copied), withoutIDs(chorus))
	}
	if sharesIDs(copied, chorus) {
		t.Errorf("duplicate %+v shares a Section, Alternate or Line with the original %+v", copied, chorus)
	}
	if len(got.Arrangement[1].LineCues) != 0 {
		t.Errorf("duplicate lineCues = %v, want none", got.Arrangement[1].LineCues)
	}
	if !reflect.DeepEqual(got.Arrangement[0], before.Arrangement[0]) {
		t.Errorf("original occurrence = %+v, want it unchanged, Cues and all: %+v", got.Arrangement[0], before.Arrangement[0])
	}
	if !reflect.DeepEqual(sectionOf(t, got, got.Arrangement[0]), chorus) {
		t.Errorf("original = %+v, want it unchanged %+v", sectionOf(t, got, got.Arrangement[0]), chorus)
	}
	if len(got.Scrapbook) != 0 {
		t.Errorf("scrapbook = %v, want it empty", got.Scrapbook)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(before.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestDuplicatingASectionWithoutAPositionAddsItAtTheEnd(t *testing.T) {
	ts := newTestServer(t)
	before := ts.cuedChorusWithTwoAlternates()
	chorus := before.Sections[0]

	got := ts.duplicate(before.ID, chorus.ID, nil)

	if want := []string{"Chorus", "Verse", "Chorus"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Fatalf("arrangement = %q, want %q", arrangementLabels(got), want)
	}
	last := got.Arrangement[2]
	if last.SectionID == chorus.ID {
		t.Fatalf("last occurrence shows the original section %d, want a Duplicate", chorus.ID)
	}
	if copied := sectionOf(t, got, last); !reflect.DeepEqual(withoutIDs(copied), withoutIDs(chorus)) {
		t.Errorf("duplicate = %+v, want the same content as %+v", withoutIDs(copied), withoutIDs(chorus))
	}
	if len(last.LineCues) != 0 {
		t.Errorf("duplicate lineCues = %v, want none", last.LineCues)
	}
}

func TestADuplicateOfAScrapbookSectionGoesIntoTheArrangement(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	s = ts.addToScrapbook(s.ID, "Bridge")
	bridge := s.Sections[1]
	s = ts.setText(s.ID, bridge.Alternates[0].ID, "Somewhere")

	got := ts.duplicate(s.ID, bridge.ID, nil)

	if want := []string{"Verse", "Bridge"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Errorf("arrangement = %q, want %q", arrangementLabels(got), want)
	}
	if !reflect.DeepEqual(got.Scrapbook, []int64{bridge.ID}) {
		t.Errorf("scrapbook = %v, want the original still in it", got.Scrapbook)
	}
}

func TestEditsDoNotLeakBetweenADuplicateAndItsOriginal(t *testing.T) {
	ts := newTestServer(t)
	s := ts.cuedChorusWithTwoAlternates()
	s = ts.duplicate(s.ID, s.Sections[0].ID, nil)
	original, copied := sectionOf(t, s, s.Arrangement[0]), sectionOf(t, s, s.Arrangement[2])

	ts.setText(s.ID, copied.Alternates[1].ID, "One last time")
	ts.setLabel(s.ID, copied.ID, "Last Chorus")
	ts.renameAlternate(s.ID, copied.Alternates[0].ID, "Brighter")
	ts.activate(s.ID, copied.Alternates[0].ID)
	ts.addAlternate(s.ID, copied.ID, map[string]any{"name": "Third"})
	got := ts.getSong(s.ID)

	if sec := sectionOf(t, got, got.Arrangement[0]); !reflect.DeepEqual(sec, original) {
		t.Errorf("original after editing the Duplicate = %+v, want it unchanged %+v", sec, original)
	}
	copiedNow := sectionOf(t, got, got.Arrangement[2])

	ts.setText(s.ID, original.Alternates[0].ID, "Drive, drive")
	ts.setLabel(s.ID, original.ID, "Hook")
	ts.renameAlternate(s.ID, original.Alternates[1].ID, "Moodier")
	ts.addAlternate(s.ID, original.ID, map[string]any{"name": "Fourth"})
	got = ts.getSong(s.ID)

	if sec := sectionOf(t, got, got.Arrangement[2]); !reflect.DeepEqual(sec, copiedNow) {
		t.Errorf("Duplicate after editing the original = %+v, want it unchanged %+v", sec, copiedNow)
	}
}

func TestDuplicatingOutsideTheArrangementIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse", "Chorus")

	res := ts.Do(http.MethodPost, duplicatePath(before.ID, before.Sections[1].ID), map[string]any{"position": 3})

	expectError(t, res, http.StatusBadRequest, "position must be between 0 and 2")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected duplicate = %+v, want it unchanged %+v", got, before)
	}
}

func TestDuplicatingASectionOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.songWithSections("Elsewhere")
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodPost, duplicatePath(before.ID, other.Sections[0].ID), map[string]any{})

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected duplicate = %+v, want it unchanged %+v", got, before)
	}
}

func TestPuttingASectionIntoTheArrangementTwiceIsRefused(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse", "Chorus")

	res := ts.Do(http.MethodPost, fmt.Sprintf("/api/songs/%d/occurrences", before.ID),
		map[string]any{"sectionId": before.Sections[1].ID, "position": 0})

	expectError(t, res, http.StatusConflict, "that Section is already in the Lyric Sheet; Duplicate it instead")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after refused add = %+v, want it unchanged %+v", got, before)
	}
}

func TestPuttingAScrapbookSectionBackOutsideTheArrangementIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse", "Chorus")
	before = ts.addToScrapbook(before.ID, "Bridge")

	res := ts.Do(http.MethodPost, fmt.Sprintf("/api/songs/%d/occurrences", before.ID),
		map[string]any{"sectionId": before.Sections[2].ID, "position": 3})

	expectError(t, res, http.StatusBadRequest, "position must be between 0 and 2")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected add = %+v, want it unchanged %+v", got, before)
	}
}

func TestPuttingASectionOfAnotherSongIntoTheArrangementIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.songWithSections("Elsewhere")
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodPost, fmt.Sprintf("/api/songs/%d/occurrences", before.ID),
		map[string]any{"sectionId": other.Sections[0].ID})

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected add = %+v, want it unchanged %+v", got, before)
	}
}

func TestPuttingASectionIntoTheArrangementWithoutASectionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodPost, fmt.Sprintf("/api/songs/%d/occurrences", before.ID), map[string]any{})

	expectError(t, res, http.StatusBadRequest, "sectionId is required")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected add = %+v, want it unchanged %+v", got, before)
	}
}

func TestTheDetachEndpointIsGone(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()

	res := ts.Do(http.MethodPost, fmt.Sprintf("/api/songs/%d/occurrences/%d/detach", s.ID, s.Arrangement[3].ID), nil)

	expectStatus(t, res, http.StatusNotFound)
}

// occurrencePath is where one Occurrence of the Arrangement lives.
func occurrencePath(songID, occurrenceID int64) string {
	return fmt.Sprintf("/api/songs/%d/occurrences/%d", songID, occurrenceID)
}

func TestRemovingAnOccurrenceOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.duplicatedChorus()
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodDelete, occurrencePath(before.ID, other.Arrangement[0].ID), nil)

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); !reflect.DeepEqual(got, other) {
		t.Errorf("other song = %+v, want it unchanged %+v", got, other)
	}
}
