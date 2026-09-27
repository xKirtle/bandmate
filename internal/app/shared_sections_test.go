package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// addOccurrence adds an Occurrence of an existing Section and returns the
// Song. body may set "position".
func (ts *testServer) addOccurrence(songID, sectionID int64, body map[string]any) song {
	ts.t.Helper()
	if body == nil {
		body = map[string]any{}
	}
	body["sectionId"] = sectionID
	return ts.lyricSheetChange(http.MethodPost, fmt.Sprintf("/api/songs/%d/occurrences", songID), body)
}

func TestAnOccurrenceOfAnExistingSectionCanBeAddedAtAPosition(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse 1", "Chorus", "Verse 2")
	chorus := before.Sections[1]

	got := ts.addOccurrence(before.ID, chorus.ID, map[string]any{"position": 3})
	got = ts.addOccurrence(before.ID, chorus.ID, map[string]any{"position": 0})
	got = ts.addOccurrence(before.ID, chorus.ID, nil)

	want := []string{"Chorus", "Verse 1", "Chorus", "Verse 2", "Chorus", "Chorus"}
	if labels := arrangementLabels(got); !reflect.DeepEqual(labels, want) {
		t.Errorf("arrangement = %q, want %q", labels, want)
	}
	if !reflect.DeepEqual(got.Sections, before.Sections) {
		t.Errorf("sections = %+v, want them unchanged %+v", got.Sections, before.Sections)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(before.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestAddingAnOccurrenceOutsideTheArrangementIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse", "Chorus")

	res := ts.Do(http.MethodPost, fmt.Sprintf("/api/songs/%d/occurrences", before.ID),
		map[string]any{"sectionId": before.Sections[1].ID, "position": 3})

	expectError(t, res, http.StatusBadRequest, "position must be between 0 and 2")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected add = %+v, want it unchanged %+v", got, before)
	}
}

func TestAddingAnOccurrenceOfASectionOfAnotherSongIsNotFound(t *testing.T) {
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

func TestAddingAnOccurrenceWithoutASectionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodPost, fmt.Sprintf("/api/songs/%d/occurrences", before.ID), map[string]any{})

	expectError(t, res, http.StatusBadRequest, "sectionId is required")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected add = %+v, want it unchanged %+v", got, before)
	}
}

// sharedFlags lists whether each Occurrence of the Arrangement is shared.
func sharedFlags(s song) []bool {
	out := []bool{}
	for _, o := range s.Arrangement {
		out = append(out, o.Shared)
	}
	return out
}

func TestOccurrencesOfTheSameSectionAreMarkedShared(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse", "Chorus", "Bridge")

	if flags := sharedFlags(s); !reflect.DeepEqual(flags, []bool{false, false, false}) {
		t.Errorf("shared = %v before repeating the chorus, want none shared", flags)
	}

	got := ts.addOccurrence(s.ID, s.Sections[1].ID, nil)

	if flags := sharedFlags(got); !reflect.DeepEqual(flags, []bool{false, true, false, true}) {
		t.Errorf("shared = %v, want only the two choruses shared", flags)
	}
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

func TestEditingASharedSectionShowsInEveryOccurrence(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Chorus", "Verse")
	chorus := s.Sections[0]
	s = ts.addOccurrence(s.ID, chorus.ID, nil)

	ts.setText(s.ID, chorus.Alternates[0].ID, "Drive, drive\nall [Am]night")
	ts.setLabel(s.ID, chorus.ID, "Hook")
	got := ts.getSong(s.ID)

	for _, i := range []int{0, 2} {
		sec := sectionOf(t, got, got.Arrangement[i])
		if sec.Label != "Hook" {
			t.Errorf("occurrence %d label = %q, want %q", i, sec.Label, "Hook")
		}
		want := []string{"Drive, drive", "all [Am]night"}
		if lines := activeLines(sec); !reflect.DeepEqual(lines, want) {
			t.Errorf("occurrence %d lines = %q, want %q", i, lines, want)
		}
	}
}

// detachPath is where an Occurrence is Detached.
func detachPath(songID, occurrenceID int64) string {
	return fmt.Sprintf("/api/songs/%d/occurrences/%d/detach", songID, occurrenceID)
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

// sharedChorus returns a Song whose Arrangement is Chorus, Verse, Chorus,
// Chorus, with one shared chorus Section that has Lines and Chords.
func (ts *testServer) sharedChorus() song {
	ts.t.Helper()
	s := ts.songWithSections("Chorus", "Verse")
	chorus := s.Sections[0]
	ts.setText(s.ID, chorus.Alternates[0].ID, "Drive, [Am]drive\nall [F]night\n\n[C] [G]")
	ts.addOccurrence(s.ID, chorus.ID, nil)
	return ts.addOccurrence(s.ID, chorus.ID, nil)
}

func TestDetachingAnOccurrenceGivesItAnIndependentCopyOfItsSection(t *testing.T) {
	ts := newTestServer(t)
	before := ts.sharedChorus()
	last := before.Arrangement[3]
	chorus := sectionOf(t, before, last)

	got := ts.lyricSheetChange(http.MethodPost, detachPath(before.ID, last.ID), nil)

	if len(got.Sections) != 3 {
		t.Fatalf("sections = %+v, want a third one, the copy", got.Sections)
	}
	detached := got.Arrangement[3]
	if detached.ID != last.ID {
		t.Errorf("detached occurrence id = %d, want it to keep %d", detached.ID, last.ID)
	}
	if detached.SectionID == chorus.ID {
		t.Fatalf("detached occurrence still points at the shared section %d", chorus.ID)
	}
	copied := sectionOf(t, got, detached)
	if !reflect.DeepEqual(withoutIDs(copied), withoutIDs(chorus)) {
		t.Errorf("copy = %+v, want the same content as %+v", withoutIDs(copied), withoutIDs(chorus))
	}
	if !reflect.DeepEqual(occurrenceIDs(got), occurrenceIDs(before)) {
		t.Errorf("occurrences = %v, want them unchanged %v", occurrenceIDs(got), occurrenceIDs(before))
	}
	for _, i := range []int{0, 2} {
		if got.Arrangement[i] != before.Arrangement[i] {
			t.Errorf("occurrence %d = %+v, want it unchanged %+v", i, got.Arrangement[i], before.Arrangement[i])
		}
	}
	if flags := sharedFlags(got); !reflect.DeepEqual(flags, []bool{true, false, true, false}) {
		t.Errorf("shared = %v, want the two remaining choruses shared and the copy not", flags)
	}
	if !reflect.DeepEqual(sectionOf(t, got, got.Arrangement[0]), chorus) {
		t.Errorf("shared chorus = %+v, want it unchanged %+v", sectionOf(t, got, got.Arrangement[0]), chorus)
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

func TestEditsDoNotLeakBetweenADetachedCopyAndItsOriginal(t *testing.T) {
	ts := newTestServer(t)
	before := ts.sharedChorus()
	s := ts.lyricSheetChange(http.MethodPost, detachPath(before.ID, before.Arrangement[3].ID), nil)
	original, copied := sectionOf(t, s, s.Arrangement[0]), sectionOf(t, s, s.Arrangement[3])

	ts.setText(s.ID, copied.Alternates[0].ID, "One last time")
	ts.setLabel(s.ID, copied.ID, "Last Chorus")
	got := ts.getSong(s.ID)

	if sec := sectionOf(t, got, got.Arrangement[0]); !reflect.DeepEqual(sec, original) {
		t.Errorf("original after editing the copy = %+v, want it unchanged %+v", sec, original)
	}

	ts.setText(s.ID, original.Alternates[0].ID, "Drive, drive")
	ts.setLabel(s.ID, original.ID, "Hook")
	got = ts.getSong(s.ID)

	copiedNow := sectionOf(t, got, got.Arrangement[3])
	if copiedNow.Label != "Last Chorus" || !reflect.DeepEqual(activeLines(copiedNow), []string{"One last time"}) {
		t.Errorf("copy after editing the original = %+v, want it unchanged", copiedNow)
	}
}

func TestDetachingAnOccurrenceOfAnUnsharedSectionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse", "Chorus")
	before = ts.setText(before.ID, before.Sections[1].Alternates[0].ID, "Drive, drive")

	res := ts.Do(http.MethodPost, detachPath(before.ID, before.Arrangement[1].ID), nil)

	expectError(t, res, http.StatusBadRequest, "only an Occurrence of a shared Section can be Detached")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected detach = %+v, want it unchanged %+v", got, before)
	}
}

func TestDetachingAnOccurrenceOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.sharedChorus()
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodPost, detachPath(before.ID, other.Arrangement[3].ID), nil)

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); !reflect.DeepEqual(got, other) {
		t.Errorf("other song = %+v, want it unchanged %+v", got, other)
	}
}

// occurrencePath is where one Occurrence of the Arrangement lives.
func occurrencePath(songID, occurrenceID int64) string {
	return fmt.Sprintf("/api/songs/%d/occurrences/%d", songID, occurrenceID)
}

func TestRemovingOneOccurrenceOfASharedSectionLeavesTheOthersIntact(t *testing.T) {
	ts := newTestServer(t)
	before := ts.sharedChorus()
	ids := occurrenceIDs(before)
	chorus := sectionOf(t, before, before.Arrangement[0])

	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(before.ID, ids[2]), nil)

	if want := []int64{ids[0], ids[1], ids[3]}; !reflect.DeepEqual(occurrenceIDs(got), want) {
		t.Errorf("occurrences = %v, want %v", occurrenceIDs(got), want)
	}
	if want := []string{"Chorus", "Verse", "Chorus"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Errorf("arrangement = %q, want %q", arrangementLabels(got), want)
	}
	if flags := sharedFlags(got); !reflect.DeepEqual(flags, []bool{true, false, true}) {
		t.Errorf("shared = %v, want the two remaining choruses shared", flags)
	}
	if !reflect.DeepEqual(got.Sections, before.Sections) {
		t.Errorf("sections = %+v, want them unchanged %+v", got.Sections, before.Sections)
	}
	if sec := sectionOf(t, got, got.Arrangement[2]); !reflect.DeepEqual(sec, chorus) {
		t.Errorf("chorus = %+v, want it unchanged %+v", sec, chorus)
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

	// Positions stay contiguous, so adding at the end still lands last.
	got = ts.addSection(before.ID, map[string]any{"label": "Outro", "position": 3})
	if want := []string{"Chorus", "Verse", "Chorus", "Outro"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Errorf("arrangement after adding = %q, want %q", arrangementLabels(got), want)
	}
}

func TestRemovingAnOccurrenceOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.sharedChorus()
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodDelete, occurrencePath(before.ID, other.Arrangement[0].ID), nil)

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); !reflect.DeepEqual(got, other) {
		t.Errorf("other song = %+v, want it unchanged %+v", got, other)
	}
}
