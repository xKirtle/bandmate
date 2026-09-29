package app_test

import (
	"context"
	"fmt"
	"net/http"
	"reflect"
	"slices"
	"testing"

	"github.com/xKirtle/bandmate/internal/db"
)

// addToScrapbook creates a Section straight in a Song's Scrapbook and returns
// the Song.
func (ts *testServer) addToScrapbook(songID int64, label string) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPost, fmt.Sprintf("/api/songs/%d/scrapbook", songID),
		map[string]any{"label": label})
}

// sectionPath is where one Section of a Song lives.
func sectionPath(songID, sectionID int64) string {
	return fmt.Sprintf("/api/songs/%d/sections/%d", songID, sectionID)
}

func TestRemovingASectionsLastOccurrenceMovesItToTheScrapbook(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse", "Chorus")
	chorus := before.Sections[1]
	before = ts.setText(before.ID, chorus.Alternates[0].ID, "Drive, [Am]drive")

	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(before.ID, before.Arrangement[1].ID), nil)

	if want := []string{"Verse"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Errorf("arrangement = %q, want %q", arrangementLabels(got), want)
	}
	if want := []int64{chorus.ID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want %v", got.Scrapbook, want)
	}
	if !reflect.DeepEqual(got.Sections, before.Sections) {
		t.Errorf("sections = %+v, want them all kept unchanged %+v", got.Sections, before.Sections)
	}
	if read := ts.getSong(before.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestRemovingADuplicateSendsItToTheScrapbookAndLeavesTheOriginal(t *testing.T) {
	ts := newTestServer(t)
	before := ts.repeatedChorus()
	original := before.Arrangement[0]
	duplicate := before.Arrangement[2]

	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(before.ID, duplicate.ID), nil)

	if want := []int64{duplicate.SectionID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want the Duplicate %v", got.Scrapbook, want)
	}
	if want := []string{"Chorus", "Verse", "Chorus"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Errorf("arrangement = %q, want %q", arrangementLabels(got), want)
	}
	if got.Arrangement[0].SectionID != original.SectionID {
		t.Errorf("first occurrence shows section %d, want the original %d", got.Arrangement[0].SectionID, original.SectionID)
	}
}

func TestASectionCanBeCreatedStraightInTheScrapbook(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse")

	got := ts.addToScrapbook(before.ID, "  Idea  ")

	if len(got.Sections) != 2 {
		t.Fatalf("sections = %+v, want a second one", got.Sections)
	}
	idea := got.Sections[1]
	if idea.Label != "Idea" {
		t.Errorf("label = %q, want %q", idea.Label, "Idea")
	}
	if len(idea.Alternates) != 1 || !idea.Alternates[0].Active || len(idea.Alternates[0].Lines) != 0 {
		t.Errorf("alternates = %+v, want one active, empty Alternate", idea.Alternates)
	}
	if want := []int64{idea.ID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want %v", got.Scrapbook, want)
	}
	if !reflect.DeepEqual(got.Arrangement, before.Arrangement) {
		t.Errorf("arrangement = %+v, want it unchanged %+v", got.Arrangement, before.Arrangement)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(before.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}

	// A Scrapbook Section can be written in like any other.
	got = ts.setText(before.ID, idea.Alternates[0].ID, "a loose [G]line")
	if lines := activeLines(got.Sections[1]); !reflect.DeepEqual(lines, []string{"a loose [G]line"}) {
		t.Errorf("lines = %q, want the loose line", lines)
	}
}

func TestCreatingInTheScrapbookOfAnUnknownSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodPost, "/api/songs/999/scrapbook", map[string]any{"label": "Idea"})

	expectStatus(t, res, http.StatusNotFound)
}

func TestAScrapbookSectionCanBeMovedBackIntoTheArrangementAtAPosition(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse", "Chorus")
	s = ts.addToScrapbook(s.ID, "Bridge")
	bridge := s.Sections[2]

	got := ts.addOccurrence(s.ID, bridge.ID, map[string]any{"position": 1})

	if want := []string{"Verse", "Bridge", "Chorus"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Errorf("arrangement = %q, want %q", arrangementLabels(got), want)
	}
	if len(got.Scrapbook) != 0 {
		t.Errorf("scrapbook = %v, want it empty", got.Scrapbook)
	}
	if !reflect.DeepEqual(got.Sections, s.Sections) {
		t.Errorf("sections = %+v, want them unchanged %+v", got.Sections, s.Sections)
	}
}

func TestAScrapbookSectionCanBeDeletedPermanently(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	s = ts.addToScrapbook(s.ID, "Keep")
	s = ts.addToScrapbook(s.ID, "Scrap")
	scrap := s.Sections[2]
	s = ts.setText(s.ID, scrap.Alternates[0].ID, "gone\nfor good")

	got := ts.lyricSheetChange(http.MethodDelete, sectionPath(s.ID, scrap.ID), nil)

	if want := s.Sections[:2]; !reflect.DeepEqual(got.Sections, want) {
		t.Errorf("sections = %+v, want %+v", got.Sections, want)
	}
	if want := []int64{s.Sections[1].ID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want %v", got.Scrapbook, want)
	}
	if !reflect.DeepEqual(got.Arrangement, s.Arrangement) {
		t.Errorf("arrangement = %+v, want it unchanged %+v", got.Arrangement, s.Arrangement)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, s.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, s.UpdatedAt)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}

	// It's gone: a second delete finds nothing.
	expectStatus(t, ts.Do(http.MethodDelete, sectionPath(s.ID, scrap.ID), nil), http.StatusNotFound)
}

func TestDeletingASectionStillInTheArrangementIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before := ts.repeatedChorus()

	res := ts.Do(http.MethodDelete, sectionPath(before.ID, before.Arrangement[0].SectionID), nil)

	expectError(t, res, http.StatusConflict,
		"only a Section in the Scrapbook can be deleted; remove it from the Arrangement first")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected delete = %+v, want it unchanged %+v", got, before)
	}
}

func TestDeletingASectionOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.songWithSections("Verse")
	other = ts.addToScrapbook(other.ID, "Idea")
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodDelete, sectionPath(before.ID, other.Sections[1].ID), nil)

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); !reflect.DeepEqual(got, other) {
		t.Errorf("other song = %+v, want it unchanged %+v", got, other)
	}

	// Whether it's in its own Song's Arrangement or not.
	res = ts.Do(http.MethodDelete, sectionPath(before.ID, other.Sections[0].ID), nil)
	expectStatus(t, res, http.StatusNotFound)
}

// writeLines puts Lines straight into an Alternate in the database, for text
// the editor can't save, like an Alternate of only blank Lines.
func (ts *testServer) writeLines(alternateID int64, texts ...string) {
	ts.t.Helper()
	conn, err := db.Open(context.Background(), ts.DataDir)
	if err != nil {
		ts.t.Fatalf("opening database: %v", err)
	}
	defer conn.Close()
	for i, text := range texts {
		if _, err := conn.Exec(`INSERT INTO lines (alternate_id, position, text) VALUES (?, ?, ?)`,
			alternateID, i, text); err != nil {
			ts.t.Fatalf("writing line: %v", err)
		}
	}
}

// expectSectionDeleted checks a Song no longer has a Section, in its
// Sections or its Scrapbook.
func expectSectionDeleted(t *testing.T, s song, sectionID int64) {
	t.Helper()
	for _, sec := range s.Sections {
		if sec.ID == sectionID {
			t.Errorf("sections = %+v, want Section %d deleted", s.Sections, sectionID)
		}
	}
	if slices.Contains(s.Scrapbook, sectionID) {
		t.Errorf("scrapbook = %v, want Section %d not in it", s.Scrapbook, sectionID)
	}
}

func TestRemovingTheOnlyOccurrenceOfASectionWithNoLinesDeletesIt(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse", "Chorus")
	before = ts.setText(before.ID, before.Sections[0].Alternates[0].ID, "Down the [G]road")
	chorus := before.Sections[1]

	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(before.ID, before.Arrangement[1].ID), nil)

	expectSectionDeleted(t, got, chorus.ID)
	if want := before.Sections[:1]; !reflect.DeepEqual(got.Sections, want) {
		t.Errorf("sections = %+v, want %+v", got.Sections, want)
	}
	if len(got.Scrapbook) != 0 {
		t.Errorf("scrapbook = %v, want it empty", got.Scrapbook)
	}
	if want := []string{"Verse"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Errorf("arrangement = %q, want %q", arrangementLabels(got), want)
	}
	if read := ts.getSong(before.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}

	// Its text was cleared: that's as empty as never written in.
	s := ts.addSection(got.ID, map[string]any{"label": "Bridge"})
	bridge := s.Sections[1]
	ts.setText(s.ID, bridge.Alternates[0].ID, "gone")
	s = ts.setText(s.ID, bridge.Alternates[0].ID, "  \n\t\n")
	got = ts.lyricSheetChange(http.MethodDelete, occurrencePath(s.ID, s.Arrangement[1].ID), nil)
	expectSectionDeleted(t, got, bridge.ID)
}

func TestRemovingTheOnlyOccurrenceOfASectionOfBlankLinesDeletesIt(t *testing.T) {
	ts := newTestServer(t)
	s, chorus := ts.chorusWithTwoAlternates()
	for _, alt := range chorus.Alternates {
		ts.setText(s.ID, alt.ID, "")
		ts.writeLines(alt.ID, "", "   ", "\t")
	}
	s = ts.getSong(s.ID)

	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(s.ID, s.Arrangement[1].ID), nil)

	expectSectionDeleted(t, got, chorus.ID)
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestASectionOfOnlyAChordLineGoesToTheScrapbook(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse", "Intro")
	intro := s.Sections[1]
	s = ts.setText(s.ID, intro.Alternates[0].ID, "[G] [C] [D]")

	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(s.ID, s.Arrangement[1].ID), nil)

	if want := []int64{intro.ID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want %v", got.Scrapbook, want)
	}
	if !reflect.DeepEqual(got.Sections, s.Sections) {
		t.Errorf("sections = %+v, want them unchanged %+v", got.Sections, s.Sections)
	}
}

func TestASectionWithLinesOnlyInAnInactiveAlternateGoesToTheScrapbook(t *testing.T) {
	ts := newTestServer(t)
	s, chorus := ts.chorusWithTwoAlternates()
	s = ts.setText(s.ID, chorus.Alternates[0].ID, "")

	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(s.ID, s.Arrangement[1].ID), nil)

	if want := []int64{chorus.ID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want %v", got.Scrapbook, want)
	}
	if !reflect.DeepEqual(got.Sections, s.Sections) {
		t.Errorf("sections = %+v, want them unchanged %+v", got.Sections, s.Sections)
	}
}

func TestAnEmptySectionMadeInTheScrapbookStaysThere(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse", "Chorus")
	s = ts.addToScrapbook(s.ID, "Idea")
	idea := s.Sections[2]

	// Another empty Section leaving the Arrangement doesn't take it along.
	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(s.ID, s.Arrangement[1].ID), nil)

	if want := []int64{idea.ID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want %v", got.Scrapbook, want)
	}
	if want := []section{s.Sections[0], idea}; !reflect.DeepEqual(got.Sections, want) {
		t.Errorf("sections = %+v, want %+v", got.Sections, want)
	}
}

func TestASectionTakenOutOfTheArrangementGoesToTheEndOfTheScrapbook(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse", "Chorus")
	verse := s.Sections[0]
	s = ts.setText(s.ID, verse.Alternates[0].ID, "Out on the road")
	s = ts.addToScrapbook(s.ID, "Idea")
	idea := s.Sections[2]

	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(s.ID, s.Arrangement[0].ID), nil)

	if want := []int64{idea.ID, verse.ID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want the Verse after the Idea already there %v", got.Scrapbook, want)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read.Scrapbook, got.Scrapbook) {
		t.Errorf("scrapbook read back = %v, want %v", read.Scrapbook, got.Scrapbook)
	}

	// One made in the Scrapbook afterwards comes after it.
	got = ts.addToScrapbook(s.ID, "Another")
	if want := []int64{idea.ID, verse.ID, got.Sections[len(got.Sections)-1].ID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want the new one last %v", got.Scrapbook, want)
	}
}

// occurrenceToScrapbookPath is where an Occurrence is moved to the Scrapbook.
func occurrenceToScrapbookPath(songID, occurrenceID int64) string {
	return occurrencePath(songID, occurrenceID) + "/scrapbook"
}

func TestMovingAnOccurrenceToTheScrapbookMovesItsSectionToTheEnd(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse", "Chorus")
	verse := s.Sections[0]
	s = ts.setText(s.ID, verse.Alternates[0].ID, "Out on the road")
	s = ts.addToScrapbook(s.ID, "Idea")
	idea := s.Sections[2]

	got := ts.lyricSheetChange(http.MethodPost, occurrenceToScrapbookPath(s.ID, s.Arrangement[0].ID), nil)

	if want := []string{"Chorus"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Errorf("arrangement = %q, want %q", arrangementLabels(got), want)
	}
	if want := []int64{idea.ID, verse.ID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want the Verse at its end %v", got.Scrapbook, want)
	}
	if !reflect.DeepEqual(got.Sections, s.Sections) {
		t.Errorf("sections = %+v, want them all kept unchanged %+v", got.Sections, s.Sections)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestMovingADuplicateToTheScrapbookMovesItAndLeavesTheOriginal(t *testing.T) {
	ts := newTestServer(t)
	before := ts.repeatedChorus()
	before = ts.addToScrapbook(before.ID, "Idea")
	idea := before.Sections[len(before.Sections)-1]
	original := sectionOf(t, before, before.Arrangement[0])
	duplicate := sectionOf(t, before, before.Arrangement[3])

	got := ts.lyricSheetChange(http.MethodPost, occurrenceToScrapbookPath(before.ID, before.Arrangement[3].ID), nil)

	if want := before.Arrangement[:3]; !reflect.DeepEqual(got.Arrangement, want) {
		t.Errorf("arrangement = %+v, want the others untouched %+v", got.Arrangement, want)
	}
	if want := []int64{idea.ID, duplicate.ID}; !reflect.DeepEqual(got.Scrapbook, want) {
		t.Errorf("scrapbook = %v, want the Idea then the Duplicate %v", got.Scrapbook, want)
	}
	if !reflect.DeepEqual(got.Sections, before.Sections) {
		t.Errorf("sections = %+v, want them all kept unchanged %+v", got.Sections, before.Sections)
	}
	if kept := sectionOf(t, got, got.Arrangement[0]); !reflect.DeepEqual(kept, original) {
		t.Errorf("chorus = %+v, want it unchanged %+v", kept, original)
	}
}

func TestMovingAnOccurrenceOfAnEmptySectionToTheScrapbookDeletesIt(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse", "Chorus")
	verse := s.Sections[0]

	got := ts.lyricSheetChange(http.MethodPost, occurrenceToScrapbookPath(s.ID, s.Arrangement[0].ID), nil)

	expectSectionDeleted(t, got, verse.ID)
	if want := []string{"Chorus"}; !reflect.DeepEqual(arrangementLabels(got), want) {
		t.Errorf("arrangement = %q, want %q", arrangementLabels(got), want)
	}
}

func TestMovingAnOccurrenceOfAnotherSongToTheScrapbookIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	other := ts.createSong("Other")

	res := ts.DoAt(other.Version, http.MethodPost, occurrenceToScrapbookPath(other.ID, s.Arrangement[0].ID), nil)

	expectStatus(t, res, http.StatusNotFound)
}
