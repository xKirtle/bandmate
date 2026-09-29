package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// Cues survive the Lyric Sheet changes that keep what they point at, and go
// with the Lines and Occurrences that are removed.

// chorusWithACuedAlternate returns repeatedChorus with its first Occurrence's
// Lines cued ("Drive, drive" at 2 and "all night" at 6) and a second,
// inactive Alternate copied from the first before it was cued.
func (ts *testServer) chorusWithACuedAlternate() song {
	ts.t.Helper()
	s := ts.repeatedChorus()
	s = ts.addAlternate(s.ID, s.Sections[0].ID, map[string]any{"name": "B"})
	s = ts.activate(s.ID, s.Sections[0].Alternates[0].ID)
	drive, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 2)
	return ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 6)
}

func TestSwitchingAlternatesLeavesLineCuesDormantAndSwitchingBackRestoresThem(t *testing.T) {
	ts := newTestServer(t)
	s := ts.chorusWithACuedAlternate()
	drive, night, _, _ := chorusLines(s)
	want := map[int64]float64{drive: 2, night: 6}

	got := ts.activate(s.ID, s.Sections[0].Alternates[1].ID)

	if !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues while dormant = %v, want %v kept", got.Arrangement[0].LineCues, want)
	}

	got = ts.activate(s.ID, s.Sections[0].Alternates[0].ID)

	if !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues switched back = %v, want %v", got.Arrangement[0].LineCues, want)
	}
}

func TestANewAlternateCarriesTheCuesOfTheOneItCopiesWhichStayDormant(t *testing.T) {
	ts := newTestServer(t)
	s := ts.repeatedChorus()
	drive, night, _, _ := chorusLines(s)
	_, _, _, lastChords := chorusLinesAt(s, 3)
	ids := occurrenceIDs(s)
	ts.setLineCue(s.ID, ids[0], drive, 2)
	ts.setLineCue(s.ID, ids[0], night, 6)
	ts.setLineCue(s.ID, ids[3], lastChords, 99)

	got := ts.addAlternate(s.ID, s.Sections[0].ID, nil)

	alts := got.Sections[0].Alternates
	if alts[0].Active || !alts[1].Active {
		t.Fatalf("active = %v, %v; want the copy active", alts[0].Active, alts[1].Active)
	}
	c := alts[1].Lines
	want := []map[int64]float64{
		{drive: 2, night: 6, c[0].ID: 2, c[1].ID: 6},
		{},
		{},
		{lastChords: 99},
	}
	for i, o := range got.Arrangement {
		if !reflect.DeepEqual(o.LineCues, want[i]) {
			t.Errorf("occurrence %d lineCues = %v, want %v", i, o.LineCues, want[i])
		}
	}

	// From then on, each keeps its own.
	ts.setLineCue(s.ID, ids[0], c[1].ID, 7)
	got = ts.activate(s.ID, alts[0].ID)
	if want := map[int64]float64{drive: 2, night: 6, c[0].ID: 2, c[1].ID: 7}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues after recueing the copy = %v, want %v", got.Arrangement[0].LineCues, want)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestEditingALinesTextKeepsItsCue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.repeatedChorus()
	_, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 6)

	got := ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "Drive, [Am]drive\nall [F]night long\n\n[C] [G]")

	if got.Sections[0].Alternates[0].Lines[1].ID != night {
		t.Fatalf("edited Line lost its id %d", night)
	}
	if want := map[int64]float64{night: 6}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
	}
}

func TestDeletingALineDropsItsCue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.repeatedChorus()
	drive, night, _, _ := chorusLines(s)
	_, lastNight, _, _ := chorusLinesAt(s, 3)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 2)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 6)
	ts.setLineCue(s.ID, s.Arrangement[3].ID, lastNight, 96)

	got := ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "Drive, [Am]drive\n\n[C] [G]")

	if want := map[int64]float64{drive: 2}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
	}
	if want := map[int64]float64{lastNight: 96}; !reflect.DeepEqual(got.Arrangement[3].LineCues, want) {
		t.Errorf("Duplicate's lineCues = %v, want %v", got.Arrangement[3].LineCues, want)
	}
}

func TestDeletingAnInactiveAlternateDropsItsDormantCues(t *testing.T) {
	ts := newTestServer(t)
	s := ts.chorusWithACuedAlternate()
	drive, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, s.Sections[0].Alternates[1].Lines[0].ID, 30)
	ts.activate(s.ID, s.Sections[0].Alternates[1].ID)

	got := ts.lyricSheetChange(http.MethodDelete, alternatePath(s.ID, s.Sections[0].Alternates[0].ID), nil)

	want := map[int64]float64{got.Sections[0].Alternates[0].Lines[0].ID: 30}
	if !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v, without %d and %d", got.Arrangement[0].LineCues, want, drive, night)
	}
}

func TestRemovingAnOccurrenceDropsOnlyItsCues(t *testing.T) {
	ts := newTestServer(t)
	s := ts.repeatedChorus()
	_, night, _, _ := chorusLines(s)
	_, secondNight, _, _ := chorusLinesAt(s, 2)
	ids := occurrenceIDs(s)
	ts.setLineCue(s.ID, ids[0], night, 6)
	ts.setLineCue(s.ID, ids[2], secondNight, 56)

	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(s.ID, ids[2]), nil)

	want := []map[int64]float64{{night: 6}, {}, {}}
	for i, o := range got.Arrangement {
		if !reflect.DeepEqual(o.LineCues, want[i]) {
			t.Errorf("occurrence %d lineCues = %v, want %v", i, o.LineCues, want[i])
		}
	}
}

func TestASectionBroughtBackFromTheScrapbookHasNoCues(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Chorus", "Verse")
	verse := s.Sections[1]
	s = ts.setText(s.ID, verse.Alternates[0].ID, "First words\nSecond words")
	lines := s.Sections[1].Alternates[0].Lines
	ts.setLineCue(s.ID, s.Arrangement[1].ID, lines[0].ID, 10)
	ts.setLineCue(s.ID, s.Arrangement[1].ID, lines[1].ID, 14)

	s = ts.lyricSheetChange(http.MethodDelete, occurrencePath(s.ID, s.Arrangement[1].ID), nil)
	if !reflect.DeepEqual(s.Scrapbook, []int64{verse.ID}) {
		t.Fatalf("scrapbook = %v, want the Verse", s.Scrapbook)
	}
	got := ts.addOccurrence(s.ID, verse.ID, nil)

	back := got.Arrangement[1]
	if len(back.LineCues) != 0 {
		t.Errorf("returned Occurrence has lineCues %v, want none", back.LineCues)
	}
}

func TestReorderingOccurrencesKeepsTheirLineCues(t *testing.T) {
	ts := newTestServer(t)
	s := ts.repeatedChorus()
	_, night, _, _ := chorusLines(s)
	drive, _, _, _ := chorusLinesAt(s, 2)
	ids := occurrenceIDs(s)
	ts.setLineCue(s.ID, ids[0], night, 6)
	ts.setLineCue(s.ID, ids[2], drive, 40)

	got := ts.lyricSheetChange(http.MethodPut, reorderPath(s.ID),
		map[string]any{"occurrences": []int64{ids[2], ids[0], ids[1], ids[3]}})

	want := []map[int64]float64{{drive: 40}, {night: 6}, {}, {}}
	for i, o := range got.Arrangement {
		if !reflect.DeepEqual(o.LineCues, want[i]) {
			t.Errorf("occurrence %d lineCues = %v, want %v", i, o.LineCues, want[i])
		}
	}
}
