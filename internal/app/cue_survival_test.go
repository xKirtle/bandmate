package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// Cues survive the Lyric Sheet changes that keep what they point at, and go
// with the Lines and Occurrences that are removed.

// chorusWithACuedAlternate returns sharedChorus with its first Occurrence's
// Lines cued ("Drive, drive" at 2, so the Occurrence too, and "all night" at
// 6) and a second, inactive Alternate copied from the first.
func (ts *testServer) chorusWithACuedAlternate() song {
	ts.t.Helper()
	s := ts.sharedChorus()
	drive, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 2)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 6)
	return ts.addAlternate(s.ID, s.Sections[0].ID, map[string]any{"name": "B"})
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
	if want := []float64{2, -1, -1, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
}

func TestAFreshlyActivatedAlternateFallsBackToTheOccurrenceCue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.chorusWithACuedAlternate()
	b := s.Sections[0].Alternates[1]

	got := ts.activate(s.ID, b.ID)

	if want := []float64{2, -1, -1, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want the Occurrence's Cue unaffected: %v", cues(got), want)
	}
	for _, l := range b.Lines {
		if cue, ok := got.Arrangement[0].LineCues[l.ID]; ok {
			t.Errorf("line %d of the new Alternate has Cue %v, want none", l.ID, cue)
		}
	}
}

func TestCueingTheOccurrenceLeavesDormantCuesAlone(t *testing.T) {
	ts := newTestServer(t)
	s := ts.chorusWithACuedAlternate()
	drive, night, _, _ := chorusLines(s)
	ts.activate(s.ID, s.Sections[0].Alternates[1].ID)

	got := ts.setCue(s.ID, s.Arrangement[0].ID, 3)

	if want := map[int64]float64{drive: 2, night: 6}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want the dormant ones unmoved: %v", got.Arrangement[0].LineCues, want)
	}
}

func TestDetachingAnOccurrenceCarriesItsCuesOverToItsNewSection(t *testing.T) {
	ts := newTestServer(t)
	s := ts.chorusWithACuedAlternate()
	drive, night, _, chords := chorusLines(s)
	ids := occurrenceIDs(s)
	dormant := s.Sections[0].Alternates[1].Lines[1].ID
	ts.setLineCue(s.ID, ids[3], drive, 90)
	ts.setLineCue(s.ID, ids[3], chords, 99)
	ts.setLineCue(s.ID, ids[3], dormant, 95)

	got := ts.lyricSheetChange(http.MethodPost, detachPath(s.ID, ids[3]), nil)

	copied := sectionOf(t, got, got.Arrangement[3])
	a, b := copied.Alternates[0].Lines, copied.Alternates[1].Lines
	want := map[int64]float64{a[0].ID: 90, a[3].ID: 99, b[1].ID: 95}
	if !reflect.DeepEqual(got.Arrangement[3].LineCues, want) {
		t.Errorf("detached lineCues = %v, want %v on the copy's Lines", got.Arrangement[3].LineCues, want)
	}
	if want := []float64{2, -1, -1, 90}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
	if want := map[int64]float64{drive: 2, night: 6}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("original's lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestEditingALinesTextKeepsItsCue(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	_, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 6)
	ts.setLineCue(s.ID, s.Arrangement[3].ID, night, 96)

	got := ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "Drive, [Am]drive\nall [F]night long\n\n[C] [G]")

	if got.Sections[0].Alternates[0].Lines[1].ID != night {
		t.Fatalf("edited Line lost its id %d", night)
	}
	if want := map[int64]float64{night: 6}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
	}
	if want := map[int64]float64{night: 96}; !reflect.DeepEqual(got.Arrangement[3].LineCues, want) {
		t.Errorf("last lineCues = %v, want %v", got.Arrangement[3].LineCues, want)
	}
}

func TestDeletingALineDropsItsCuesInEveryOccurrence(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	drive, night, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 2)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, night, 6)
	ts.setLineCue(s.ID, s.Arrangement[3].ID, night, 96)

	got := ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "Drive, [Am]drive\n\n[C] [G]")

	if want := map[int64]float64{drive: 2}; !reflect.DeepEqual(got.Arrangement[0].LineCues, want) {
		t.Errorf("lineCues = %v, want %v", got.Arrangement[0].LineCues, want)
	}
	if len(got.Arrangement[3].LineCues) != 0 {
		t.Errorf("last lineCues = %v, want none", got.Arrangement[3].LineCues)
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
	s := ts.sharedChorus()
	_, night, _, _ := chorusLines(s)
	ids := occurrenceIDs(s)
	ts.setLineCue(s.ID, ids[0], night, 6)
	ts.setCue(s.ID, ids[2], 50)
	ts.setLineCue(s.ID, ids[2], night, 56)

	got := ts.lyricSheetChange(http.MethodDelete, occurrencePath(s.ID, ids[2]), nil)

	if want := []float64{-1, -1, -1}; !reflect.DeepEqual(cues(got), want) {
		t.Errorf("cues = %v, want %v", cues(got), want)
	}
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
	if back.Cue != nil || len(back.LineCues) != 0 {
		t.Errorf("returned Occurrence has cue %v and lineCues %v, want none", back.Cue, back.LineCues)
	}
}

func TestReorderingOccurrencesKeepsTheirLineCues(t *testing.T) {
	ts := newTestServer(t)
	s := ts.sharedChorus()
	drive, night, _, _ := chorusLines(s)
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
