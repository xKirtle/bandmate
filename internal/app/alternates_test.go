package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// alternatesPath is where a Section's Alternates are created.
func alternatesPath(songID, sectionID int64) string {
	return fmt.Sprintf("/api/songs/%d/sections/%d/alternates", songID, sectionID)
}

// alternatePath is where one Alternate of a Song lives.
func alternatePath(songID, alternateID int64) string {
	return fmt.Sprintf("/api/songs/%d/alternates/%d", songID, alternateID)
}

// activatePath is where an Alternate is made the active one.
func activatePath(songID, alternateID int64) string {
	return alternatePath(songID, alternateID) + "/activate"
}

// addAlternate creates an Alternate of a Section and returns the Song. body
// may set "name".
func (ts *testServer) addAlternate(songID, sectionID int64, body map[string]any) song {
	ts.t.Helper()
	if body == nil {
		body = map[string]any{}
	}
	return ts.lyricSheetChange(http.MethodPost, alternatesPath(songID, sectionID), body)
}

// activate makes an Alternate the active one of its Section and returns the
// Song.
func (ts *testServer) activate(songID, alternateID int64) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPost, activatePath(songID, alternateID), nil)
}

// chorusWithTwoAlternates returns a Song with a Verse and a Chorus whose
// Section has an active Alternate with Lines and an inactive copy of it.
func (ts *testServer) chorusWithTwoAlternates() (song, section) {
	ts.t.Helper()
	s := ts.songWithSections("Verse", "Chorus")
	chorus := s.Sections[1]
	ts.setText(s.ID, chorus.Alternates[0].ID, "Drive, [Am]drive\nall [F]night")
	s = ts.addAlternate(s.ID, chorus.ID, nil)
	s = ts.activate(s.ID, s.Sections[1].Alternates[0].ID)
	return s, s.Sections[1]
}

func TestANewAlternateIsAnActiveCopyOfTheActiveOne(t *testing.T) {
	ts := newTestServer(t)
	s, chorus := ts.chorusWithTwoAlternates()
	// A third Alternate copies the active first one, not the newest.
	ts.setText(s.ID, s.Sections[1].Alternates[1].ID, "Something else")
	before := ts.getSong(s.ID)
	first := before.Sections[1].Alternates[0]

	got := ts.addAlternate(s.ID, chorus.ID, nil)

	alts := got.Sections[1].Alternates
	if len(alts) != 3 {
		t.Fatalf("alternates = %+v, want three", alts)
	}
	if alts[0].Active {
		t.Errorf("the copied alternate is still active, want only the new one")
	}
	if !reflect.DeepEqual(alts[0].Lines, first.Lines) || alts[0].Name != first.Name {
		t.Errorf("copied alternate = %+v, want it unchanged %+v", alts[0], first)
	}
	if !reflect.DeepEqual(alts[1], before.Sections[1].Alternates[1]) {
		t.Errorf("other alternate = %+v, want it unchanged %+v", alts[1], before.Sections[1].Alternates[1])
	}
	added := alts[2]
	if !added.Active {
		t.Errorf("new alternate is inactive, want it active")
	}
	if want := lineTexts(first); !reflect.DeepEqual(activeLines(got.Sections[1]), want) {
		t.Errorf("lyric sheet lines = %q, want the copy's %q", activeLines(got.Sections[1]), want)
	}
	if added.Name != "" {
		t.Errorf("new alternate name = %q, want none", added.Name)
	}
	if want := lineTexts(first); !reflect.DeepEqual(lineTexts(added), want) {
		t.Errorf("new alternate lines = %q, want a copy of the active one %q", lineTexts(added), want)
	}
	for _, id := range lineIDs(added) {
		for _, old := range lineIDs(first) {
			if id == old {
				t.Errorf("new alternate shares line id %d with the active one, want its own Lines", id)
			}
		}
	}
	if !reflect.DeepEqual(got.Sections[0], before.Sections[0]) {
		t.Errorf("other section = %+v, want it unchanged %+v", got.Sections[0], before.Sections[0])
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestANewAlternateCanBeNamed(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Chorus")

	got := ts.addAlternate(s.ID, s.Sections[0].ID, map[string]any{"name": "  Darker  "})

	if name := got.Sections[0].Alternates[1].Name; name != "Darker" {
		t.Errorf("name = %q, want %q", name, "Darker")
	}
}

func TestAddingAnAlternateToASectionOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.songWithSections("Elsewhere")
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodPost, alternatesPath(before.ID, other.Sections[0].ID), map[string]any{})

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); !reflect.DeepEqual(got, other) {
		t.Errorf("other song = %+v, want it unchanged %+v", got, other)
	}
}

func TestAnAlternateCanBeRenamed(t *testing.T) {
	ts := newTestServer(t)
	before, chorus := ts.chorusWithTwoAlternates()

	got := ts.lyricSheetChange(http.MethodPatch, alternatePath(before.ID, chorus.Alternates[1].ID),
		map[string]any{"name": " Stripped back "})
	got = ts.lyricSheetChange(http.MethodPatch, alternatePath(before.ID, chorus.Alternates[0].ID),
		map[string]any{"name": "Original"})

	alts := got.Sections[1].Alternates
	if names := []string{alts[0].Name, alts[1].Name}; !reflect.DeepEqual(names, []string{"Original", "Stripped back"}) {
		t.Errorf("names = %q, want %q", names, []string{"Original", "Stripped back"})
	}
	if !alts[0].Active || alts[1].Active {
		t.Errorf("active = %v, %v; want renaming to leave the first one active", alts[0].Active, alts[1].Active)
	}

	got = ts.lyricSheetChange(http.MethodPatch, alternatePath(before.ID, chorus.Alternates[1].ID),
		map[string]any{"name": "   "})
	if name := got.Sections[1].Alternates[1].Name; name != "" {
		t.Errorf("name after blanking = %q, want none", name)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
}

func TestRenamingAnAlternateOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other, chorus := ts.chorusWithTwoAlternates()
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodPatch, alternatePath(before.ID, chorus.Alternates[1].ID), map[string]any{"name": "Mine"})

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); !reflect.DeepEqual(got, other) {
		t.Errorf("other song = %+v, want it unchanged %+v", got, other)
	}
}

func TestActivatingAnAlternateMakesItTheOnlyActiveOne(t *testing.T) {
	ts := newTestServer(t)
	s, chorus := ts.chorusWithTwoAlternates()
	ts.setText(s.ID, chorus.Alternates[1].ID, "Slow it down")
	before := ts.addAlternate(s.ID, chorus.ID, nil)
	second := chorus.Alternates[1].ID

	got := ts.activate(s.ID, second)

	alts := got.Sections[1].Alternates
	if flags := []bool{alts[0].Active, alts[1].Active, alts[2].Active}; !reflect.DeepEqual(flags, []bool{false, true, false}) {
		t.Errorf("active = %v, want only the second", flags)
	}
	if want := []string{"Slow it down"}; !reflect.DeepEqual(activeLines(got.Sections[1]), want) {
		t.Errorf("active lines = %q, want %q", activeLines(got.Sections[1]), want)
	}
	for i := range alts {
		if !reflect.DeepEqual(alts[i].Lines, before.Sections[1].Alternates[i].Lines) {
			t.Errorf("alternate %d lines = %+v, want them unchanged", i, alts[i].Lines)
		}
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}

	// Activating the active one again changes nothing.
	again := ts.activate(s.ID, second)
	if !reflect.DeepEqual(again.Sections, got.Sections) {
		t.Errorf("sections after activating again = %+v, want them unchanged %+v", again.Sections, got.Sections)
	}
}

func TestActivatingAnAlternateOfASharedSectionAppliesToEveryOccurrence(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	chorus := sectionOf(t, s, s.Arrangement[0])
	s = ts.addAlternate(s.ID, chorus.ID, nil)
	alt := sectionOf(t, s, s.Arrangement[0]).Alternates[1]
	ts.setText(s.ID, alt.ID, "One more time")

	got := ts.activate(s.ID, alt.ID)

	for _, i := range []int{0, 2, 3} {
		if lines := activeLines(sectionOf(t, got, got.Arrangement[i])); !reflect.DeepEqual(lines, []string{"One more time"}) {
			t.Errorf("occurrence %d lines = %q, want the activated Alternate's", i, lines)
		}
	}
}

func TestActivatingAnAlternateOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other, chorus := ts.chorusWithTwoAlternates()
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodPost, activatePath(before.ID, chorus.Alternates[1].ID), nil)

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); !reflect.DeepEqual(got, other) {
		t.Errorf("other song = %+v, want it unchanged %+v", got, other)
	}
}

func TestEditingAnInactiveAlternateLeavesTheLyricSheetAsItWas(t *testing.T) {
	ts := newTestServer(t)
	before, chorus := ts.chorusWithTwoAlternates()
	inactive := chorus.Alternates[1]

	got := ts.setText(before.ID, inactive.ID, "Drive, [Am]drive\nall [G]day\nand night")

	if !reflect.DeepEqual(got.Sections[1].Alternates[0], chorus.Alternates[0]) {
		t.Errorf("active alternate = %+v, want it unchanged %+v", got.Sections[1].Alternates[0], chorus.Alternates[0])
	}
	if want := []string{"Drive, [Am]drive", "all [F]night"}; !reflect.DeepEqual(activeLines(got.Sections[1]), want) {
		t.Errorf("lyric sheet lines = %q, want %q", activeLines(got.Sections[1]), want)
	}
	edited := got.Sections[1].Alternates[1]
	if edited.Active {
		t.Errorf("edited alternate became active")
	}
	if want := []string{"Drive, [Am]drive", "all [G]day", "and night"}; !reflect.DeepEqual(lineTexts(edited), want) {
		t.Errorf("edited lines = %q, want %q", lineTexts(edited), want)
	}
	ids := lineIDs(edited)
	if old := lineIDs(inactive); ids[0] != old[0] || ids[1] != old[1] {
		t.Errorf("line ids = %v, want the first two to keep %v", ids, old)
	}
}

func TestAnInactiveAlternateCanBeDeleted(t *testing.T) {
	ts := newTestServer(t)
	before, chorus := ts.chorusWithTwoAlternates()

	got := ts.lyricSheetChange(http.MethodDelete, alternatePath(before.ID, chorus.Alternates[1].ID), nil)

	if want := []alternate{chorus.Alternates[0]}; !reflect.DeepEqual(got.Sections[1].Alternates, want) {
		t.Errorf("alternates = %+v, want only the active one %+v", got.Sections[1].Alternates, want)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(before.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestDeletingTheActiveAlternateIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before, chorus := ts.chorusWithTwoAlternates()

	res := ts.Do(http.MethodDelete, alternatePath(before.ID, chorus.Alternates[0].ID), nil)

	expectError(t, res, http.StatusConflict, "the active Alternate can't be deleted; activate another one first")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected delete = %+v, want it unchanged %+v", got, before)
	}
}

func TestDeletingTheLastAlternateIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse")
	before = ts.setText(before.ID, before.Sections[0].Alternates[0].ID, "City lights")

	res := ts.Do(http.MethodDelete, alternatePath(before.ID, before.Sections[0].Alternates[0].ID), nil)

	expectError(t, res, http.StatusConflict, "a Section's last Alternate can't be deleted")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected delete = %+v, want it unchanged %+v", got, before)
	}
}

func TestDeletingAnAlternateOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other, chorus := ts.chorusWithTwoAlternates()
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodDelete, alternatePath(before.ID, chorus.Alternates[1].ID), nil)

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); !reflect.DeepEqual(got, other) {
		t.Errorf("other song = %+v, want it unchanged %+v", got, other)
	}
}
