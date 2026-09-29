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

// renameAlternate names an Alternate and returns the Song.
func (ts *testServer) renameAlternate(songID, alternateID int64, name string) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPatch, alternatePath(songID, alternateID), map[string]any{"name": name})
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

// toScrapbookPath is where an Alternate is moved to the Scrapbook.
func toScrapbookPath(songID, alternateID int64) string {
	return alternatePath(songID, alternateID) + "/scrapbook"
}

// moveToScrapbook moves an Alternate out of its Section into the Scrapbook
// and returns the Song.
func (ts *testServer) moveToScrapbook(songID, alternateID int64) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPost, toScrapbookPath(songID, alternateID), nil)
}

func TestAnInactiveAlternateCanBeMovedToTheScrapbookAsASectionOfItsOwn(t *testing.T) {
	ts := newTestServer(t)
	s, chorus := ts.chorusWithTwoAlternates()
	ts.renameAlternate(s.ID, chorus.Alternates[1].ID, "Darker")
	before := ts.setText(s.ID, chorus.Alternates[1].ID, "Slow it [Dm]down")
	moved := before.Sections[1].Alternates[1]

	got := ts.moveToScrapbook(s.ID, moved.ID)

	if want := []alternate{chorus.Alternates[0]}; !reflect.DeepEqual(got.Sections[1].Alternates, want) {
		t.Errorf("chorus alternates = %+v, want only the active one %+v", got.Sections[1].Alternates, want)
	}
	if !reflect.DeepEqual(got.Arrangement, before.Arrangement) {
		t.Errorf("arrangement = %+v, want it unchanged %+v", got.Arrangement, before.Arrangement)
	}
	if len(got.Sections) != 3 || len(got.Scrapbook) != 1 || got.Scrapbook[0] != got.Sections[2].ID {
		t.Fatalf("sections = %+v, scrapbook = %v; want a new Section in the Scrapbook", got.Sections, got.Scrapbook)
	}
	added := got.Sections[2]
	if added.Label != "Chorus · Darker" {
		t.Errorf("label = %q, want %q", added.Label, "Chorus · Darker")
	}
	if len(added.Alternates) != 1 {
		t.Fatalf("new section alternates = %+v, want one", added.Alternates)
	}
	if alt := added.Alternates[0]; !alt.Active || !reflect.DeepEqual(alt.Lines, moved.Lines) {
		t.Errorf("new section alternate = %+v, want the moved Lines %+v, active", alt, moved.Lines)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestAnAlternateMovedToTheScrapbookIsLabelledByWhatHasANameOrLabel(t *testing.T) {
	for _, tc := range []struct{ label, name, want string }{
		{"Chorus", "", "Chorus"},
		{"", "Darker", "Darker"},
		{"", "", ""},
	} {
		ts := newTestServer(t)
		s, chorus := ts.chorusWithTwoAlternates()
		ts.setLabel(s.ID, chorus.ID, tc.label)
		ts.renameAlternate(s.ID, chorus.Alternates[1].ID, tc.name)

		got := ts.moveToScrapbook(s.ID, chorus.Alternates[1].ID)

		if label := got.Sections[2].Label; label != tc.want {
			t.Errorf("label %q, name %q: new label = %q, want %q", tc.label, tc.name, label, tc.want)
		}
	}
}

func TestAnAlternateMovedToTheScrapbookLeavesItsCuesBehindAndTheOthersKeepTheirs(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	drive, night, _, chords := chorusLines(s)
	ids := occurrenceIDs(s)
	ts.setLineCue(s.ID, ids[0], drive, 2)
	ts.setLineCue(s.ID, ids[0], night, 6)
	ts.setLineCue(s.ID, ids[3], chords, 99)
	// The copy carries the Cues, then goes dormant with them.
	s = ts.addAlternate(s.ID, s.Sections[0].ID, nil)
	s = ts.activate(s.ID, s.Sections[0].Alternates[0].ID)

	got := ts.moveToScrapbook(s.ID, s.Sections[0].Alternates[1].ID)

	want := []map[int64]float64{{drive: 2, night: 6}, {}, {}, {chords: 99}}
	for i, o := range got.Arrangement {
		if !reflect.DeepEqual(o.LineCues, want[i]) {
			t.Errorf("occurrence %d lineCues = %v, want %v", i, o.LineCues, want[i])
		}
	}
	// Put back, the new Section starts with no Cues.
	got = ts.addOccurrence(s.ID, got.Sections[2].ID, nil)
	if cues := got.Arrangement[4].LineCues; len(cues) != 0 {
		t.Errorf("put back lineCues = %v, want none", cues)
	}
}

func TestAnAlternateMovedToTheScrapbookLeavesEveryOccurrenceOfItsSection(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	s = ts.addAlternate(s.ID, s.Sections[0].ID, nil)
	moved := s.Sections[0].Alternates[1]
	s = ts.activate(s.ID, s.Sections[0].Alternates[0].ID)

	got := ts.moveToScrapbook(s.ID, moved.ID)

	for _, i := range []int{0, 2, 3} {
		sec := sectionOf(t, got, got.Arrangement[i])
		if len(sec.Alternates) != 1 || sec.Alternates[0].ID == moved.ID {
			t.Errorf("occurrence %d alternates = %+v, want the moved one gone", i, sec.Alternates)
		}
	}
}

func TestMovingTheActiveAlternateToTheScrapbookIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before, chorus := ts.chorusWithTwoAlternates()

	res := ts.Do(http.MethodPost, toScrapbookPath(before.ID, chorus.Alternates[0].ID), nil)

	expectError(t, res, http.StatusConflict, "the active Alternate can't be moved to the Scrapbook; activate another one first")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected move = %+v, want it unchanged %+v", got, before)
	}
}

func TestMovingAnAlternateOfAnotherSongToTheScrapbookIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other, chorus := ts.chorusWithTwoAlternates()
	before := ts.songWithSections("Verse")

	res := ts.Do(http.MethodPost, toScrapbookPath(before.ID, chorus.Alternates[1].ID), nil)

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); !reflect.DeepEqual(got, other) {
		t.Errorf("other song = %+v, want it unchanged %+v", got, other)
	}
}

// addToSectionPath is where a Scrapbook Section is added to a Section.
func addToSectionPath(songID, sectionID int64) string {
	return fmt.Sprintf("/api/songs/%d/sections/%d/add-to-section", songID, sectionID)
}

// addToSection adds a Scrapbook Section to a Section, its Alternates joining
// that Section's, and returns the Song.
func (ts *testServer) addToSection(songID, scrapID, sectionID int64) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPost, addToSectionPath(songID, scrapID), map[string]any{"sectionId": sectionID})
}

// scrapWithTwoAlternates adds a Section to a Song's Scrapbook with Lines in
// an unnamed active Alternate and an inactive one named "Darker", and
// returns the Song and the Section.
func (ts *testServer) scrapWithTwoAlternates(songID int64, label string) (song, section) {
	ts.t.Helper()
	s := ts.addToScrapbook(songID, label)
	scrap := s.Sections[len(s.Sections)-1]
	ts.setText(songID, scrap.Alternates[0].ID, "Headlights [Em]on")
	s = ts.addAlternate(songID, scrap.ID, map[string]any{"name": "Darker"})
	scrap = s.Sections[len(s.Sections)-1]
	s = ts.setText(songID, scrap.Alternates[1].ID, "Headlights [Dm]off")
	s = ts.activate(songID, scrap.Alternates[0].ID)
	return s, s.Sections[len(s.Sections)-1]
}

func TestAScrapbookSectionAddedToASectionJoinsItsAlternatesInactive(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	drive, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 2)
	ts.setLineCue(s.ID, s.Arrangement[2].ID, night, 40)
	before, scrap := ts.scrapWithTwoAlternates(s.ID, "Idea")
	chorus := before.Sections[0]

	got := ts.addToSection(before.ID, scrap.ID, chorus.ID)

	expectSectionDeleted(t, got, scrap.ID)
	if !reflect.DeepEqual(got.Arrangement, before.Arrangement) {
		t.Errorf("arrangement = %+v, want it and its Cues unchanged %+v", got.Arrangement, before.Arrangement)
	}
	alternates := got.Sections[0].Alternates
	if len(alternates) != 3 || !reflect.DeepEqual(alternates[0], chorus.Alternates[0]) {
		t.Fatalf("chorus alternates = %+v, want its own active one then the scrap's two", alternates)
	}
	for i, want := range []alternate{
		{Name: "Idea", Lines: scrap.Alternates[0].Lines},
		{Name: "Darker", Lines: scrap.Alternates[1].Lines},
	} {
		added := alternates[i+1]
		added.ID = 0
		if !reflect.DeepEqual(added, want) {
			t.Errorf("added alternate %d = %+v, want %+v, inactive", i, added, want)
		}
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestAnUnnamedAlternateAddedToASectionTakesTheScrapsLabel(t *testing.T) {
	for _, tc := range []struct{ label, name, want string }{
		{"Idea", "", "Idea"},
		{"Idea", "Darker", "Darker"},
		{"", "Darker", "Darker"},
		{"", "", ""},
	} {
		ts := newTestServer(t)
		s := ts.songWithSections("Verse", "Chorus")
		s = ts.addToScrapbook(s.ID, tc.label)
		scrap := s.Sections[2]
		ts.renameAlternate(s.ID, scrap.Alternates[0].ID, tc.name)

		got := ts.addToSection(s.ID, scrap.ID, s.Sections[1].ID)

		if name := got.Sections[1].Alternates[1].Name; name != tc.want {
			t.Errorf("label %q, name %q: added alternate's name = %q, want %q", tc.label, tc.name, name, tc.want)
		}
	}
}

func TestAddingASectionStillInTheArrangementToASectionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse", "Hook")

	res := ts.Do(http.MethodPost, addToSectionPath(before.ID, before.Sections[1].ID),
		map[string]any{"sectionId": before.Sections[0].ID})

	expectError(t, res, http.StatusConflict, "only a Scrapbook Section can be added to a Section")
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected add = %+v, want it unchanged %+v", got, before)
	}
}

func TestAddingAScrapbookSectionToAnotherInTheScrapbookIsRejected(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	s = ts.addToScrapbook(s.ID, "Idea")
	before := ts.addToScrapbook(s.ID, "Another")

	for _, target := range []int64{before.Sections[2].ID, before.Sections[1].ID} {
		res := ts.Do(http.MethodPost, addToSectionPath(before.ID, before.Sections[1].ID),
			map[string]any{"sectionId": target})

		expectError(t, res, http.StatusConflict, "a Scrapbook Section can only be added to a Section in the Lyric Sheet")
	}
	if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("song after rejected add = %+v, want it unchanged %+v", got, before)
	}
}

func TestAddingToASectionWithoutASectionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	s = ts.addToScrapbook(s.ID, "Idea")

	res := ts.Do(http.MethodPost, addToSectionPath(s.ID, s.Sections[1].ID), map[string]any{})

	expectError(t, res, http.StatusBadRequest, "sectionId is required")
}

func TestAddingToASectionAcrossSongsIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	s = ts.addToScrapbook(s.ID, "Idea")
	other := ts.songWithSections("Chorus")
	other = ts.addToScrapbook(other.ID, "Other idea")

	for _, tc := range []struct{ scrap, target int64 }{
		{other.Sections[1].ID, s.Sections[0].ID},
		{s.Sections[1].ID, other.Sections[0].ID},
	} {
		res := ts.Do(http.MethodPost, addToSectionPath(s.ID, tc.scrap), map[string]any{"sectionId": tc.target})

		expectStatus(t, res, http.StatusNotFound)
	}
}
