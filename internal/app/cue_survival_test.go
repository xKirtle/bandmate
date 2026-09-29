package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// Cues survive the Lyric Sheet changes that keep what they point at, and go
// with the Lines and Sections that are removed.

// chorusWithACuedAlternate returns duplicatedChorus with its first chorus's
// Lines cued ("Drive, drive" at 2 and "all night" at 6) and a second,
// inactive Alternate copied from the first before it was cued.
func (ts *testServer) chorusWithACuedAlternate() song {
	ts.t.Helper()
	s := ts.duplicatedChorus()
	s = ts.addAlternate(s.ID, s.Sections[0].ID, map[string]any{"name": "B"})
	s = ts.activate(s.ID, s.Sections[0].Alternates[0].ID)
	drive, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, drive, 2)
	return ts.setLineCue(s.ID, night, 6)
}

func TestSwitchingAlternatesLeavesLineCuesDormantAndSwitchingBackRestoresThem(t *testing.T) {
	ts := newTestServer(t)
	s := ts.chorusWithACuedAlternate()
	drive, night, _, _ := chorusLines(s)
	want := map[int64]float64{drive: 2, night: 6}

	got := ts.activate(s.ID, s.Sections[0].Alternates[1].ID)

	if !reflect.DeepEqual(lineCues(got)[0], want) {
		t.Errorf("lineCues while dormant = %v, want %v kept", lineCues(got)[0], want)
	}

	got = ts.activate(s.ID, s.Sections[0].Alternates[0].ID)

	if !reflect.DeepEqual(lineCues(got)[0], want) {
		t.Errorf("lineCues switched back = %v, want %v", lineCues(got)[0], want)
	}
}

func TestANewAlternateCarriesTheCuesOfTheOneItCopiesWhichStayDormant(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	drive, night, _, _ := chorusLines(s)
	_, _, _, lastChords := chorusLinesAt(s, 3)
	ts.setLineCue(s.ID, drive, 2)
	ts.setLineCue(s.ID, night, 6)
	ts.setLineCue(s.ID, lastChords, 99)

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
	if !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
	}

	// From then on, each keeps its own.
	ts.setLineCue(s.ID, c[1].ID, 7)
	got = ts.activate(s.ID, alts[0].ID)
	if want := map[int64]float64{drive: 2, night: 6, c[0].ID: 2, c[1].ID: 7}; !reflect.DeepEqual(lineCues(got)[0], want) {
		t.Errorf("lineCues after recueing the copy = %v, want %v", lineCues(got)[0], want)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestEditingALinesTextKeepsItsCue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	_, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, night, 6)

	got := ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "Drive, [Am]drive\nall [F]night long\n\n[C] [G]")

	if got.Sections[0].Alternates[0].Lines[1].ID != night {
		t.Fatalf("edited Line lost its id %d", night)
	}
	if want := map[int64]float64{night: 6}; !reflect.DeepEqual(lineCues(got)[0], want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got)[0], want)
	}
}

func TestDeletingALineDropsItsCue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	drive, night, _, _ := chorusLines(s)
	_, lastNight, _, _ := chorusLinesAt(s, 3)
	ts.setLineCue(s.ID, drive, 2)
	ts.setLineCue(s.ID, night, 6)
	ts.setLineCue(s.ID, lastNight, 96)

	got := ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "Drive, [Am]drive\n\n[C] [G]")

	if want := map[int64]float64{drive: 2}; !reflect.DeepEqual(lineCues(got)[0], want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got)[0], want)
	}
	if want := map[int64]float64{lastNight: 96}; !reflect.DeepEqual(lineCues(got)[3], want) {
		t.Errorf("Duplicate's lineCues = %v, want %v", lineCues(got)[3], want)
	}
}

func TestDeletingAnInactiveAlternateDropsItsDormantCues(t *testing.T) {
	ts := newTestServer(t)
	s := ts.chorusWithACuedAlternate()
	drive, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Sections[0].Alternates[1].Lines[0].ID, 30)
	ts.activate(s.ID, s.Sections[0].Alternates[1].ID)

	got := ts.lyricSheetChange(http.MethodDelete, alternatePath(s.ID, s.Sections[0].Alternates[0].ID), nil)

	want := map[int64]float64{got.Sections[0].Alternates[0].Lines[0].ID: 30}
	if !reflect.DeepEqual(lineCues(got)[0], want) {
		t.Errorf("lineCues = %v, want %v, without %d and %d", lineCues(got)[0], want, drive, night)
	}
}

func TestTakingOutASectionTakesItsCuesWithIt(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	_, night, _, _ := chorusLines(s)
	_, secondNight, _, _ := chorusLinesAt(s, 2)
	ids := s.Arrangement
	ts.setLineCue(s.ID, night, 6)
	ts.setLineCue(s.ID, secondNight, 56)

	got := ts.lyricSheetChange(http.MethodDelete, sectionInArrangementPath(s.ID, ids[2]), nil)

	want := []map[int64]float64{{night: 6}, {}, {}}
	if !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
	}
	if cues := cuesOf(sectionOf(t, got, ids[2])); !reflect.DeepEqual(cues, map[int64]float64{secondNight: 56}) {
		t.Errorf("Scrapbook Section's cues = %v, want its own kept", cues)
	}
}

func TestReorderingSectionsKeepsTheirLineCues(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	_, night, _, _ := chorusLines(s)
	drive, _, _, _ := chorusLinesAt(s, 2)
	ids := s.Arrangement
	ts.setLineCue(s.ID, night, 6)
	ts.setLineCue(s.ID, drive, 40)

	got := ts.lyricSheetChange(http.MethodPut, reorderPath(s.ID),
		map[string]any{"sections": []int64{ids[2], ids[0], ids[1], ids[3]}})

	want := []map[int64]float64{{drive: 40}, {night: 6}, {}, {}}
	if !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
	}
}
