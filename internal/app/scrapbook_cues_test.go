package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// Cues go wherever their Lines go (ADR 0010): into the Scrapbook, back out
// of it, and into another Section as an Alternate.

// cuedVerse returns a Song whose Arrangement is Chorus, Verse, with the
// Verse's two Lines cued at 10 and 14, and the ids of those Lines.
func (ts *testServer) cuedVerse() (s song, first, second int64) {
	ts.t.Helper()
	s = ts.songWithSections("Chorus", "Verse")
	s = ts.setText(s.ID, s.Sections[1].Alternates[0].ID, "First words\nSecond words")
	lines := s.Sections[1].Alternates[0].Lines
	ts.setLineCue(s.ID, lines[0].ID, 10)
	return ts.setLineCue(s.ID, lines[1].ID, 14), lines[0].ID, lines[1].ID
}

func TestASectionSentToTheScrapbookAndPutBackHasTheSameCues(t *testing.T) {
	ts := newTestServer(t)
	s, first, second := ts.cuedVerse()
	verse := s.Sections[1].ID
	want := map[int64]float64{first: 10, second: 14}

	s = ts.lyricSheetChange(http.MethodDelete, sectionInArrangementPath(s.ID, verse), nil)

	if !reflect.DeepEqual(s.Scrapbook, []int64{verse}) {
		t.Fatalf("scrapbook = %v, want the Verse", s.Scrapbook)
	}
	if cues := cuesOf(sectionOf(t, s, verse)); !reflect.DeepEqual(cues, want) {
		t.Errorf("Scrapbook Section's cues = %v, want %v kept", cues, want)
	}

	got := ts.putBack(s.ID, verse, nil)

	if cues := lineCues(got); !reflect.DeepEqual(cues, []map[int64]float64{{}, want}) {
		t.Errorf("lineCues put back = %v, want the Verse's %v", cues, want)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestASectionPutBackWhereItsCuesAreOutOfOrderKeepsThem(t *testing.T) {
	ts := newTestServer(t)
	s, first, second := ts.cuedVerse()
	verse := s.Sections[1].ID
	chorus := s.Sections[0].Alternates[0]
	s = ts.setText(s.ID, chorus.ID, "Drive all night")
	ts.setLineCue(s.ID, s.Sections[0].Alternates[0].Lines[0].ID, 30)
	ts.lyricSheetChange(http.MethodDelete, sectionInArrangementPath(s.ID, verse), nil)

	// Before a chorus cued later, where they're out of order: kept all the same.
	got := ts.putBack(s.ID, verse, map[string]any{"position": 0})

	if !reflect.DeepEqual(got.Arrangement[0], verse) {
		t.Fatalf("arrangement = %v, want the Verse first", got.Arrangement)
	}
	if cues := lineCues(got)[0]; !reflect.DeepEqual(cues, map[int64]float64{first: 10, second: 14}) {
		t.Errorf("Verse's lineCues = %v, want them kept", cues)
	}
}

func TestASectionSentToTheScrapbookKeepsItsDormantCues(t *testing.T) {
	ts := newTestServer(t)
	s := ts.chorusWithACuedAlternate()
	drive, night, _, _ := chorusLines(s)
	dormantDrive := s.Sections[0].Alternates[1].Lines[0].ID
	ts.setLineCue(s.ID, dormantDrive, 30)
	chorus := s.Sections[0].ID
	want := map[int64]float64{drive: 2, night: 6, dormantDrive: 30}

	s = ts.lyricSheetChange(http.MethodDelete, sectionInArrangementPath(s.ID, chorus), nil)
	got := ts.putBack(s.ID, chorus, map[string]any{"position": 0})

	if cues := lineCues(got)[0]; !reflect.DeepEqual(cues, want) {
		t.Errorf("lineCues put back = %v, want %v", cues, want)
	}
}

func TestAnInactiveAlternateMovedToTheScrapbookKeepsItsCuesLiveOnceItsSectionIsPutBack(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	drive, _, _, _ := chorusLines(s)
	// The copy carries the Cues, then goes dormant with them.
	s = ts.addAlternate(s.ID, s.Sections[0].ID, nil)
	s = ts.activate(s.ID, s.Sections[0].Alternates[0].ID)
	moved := s.Sections[0].Alternates[1]
	ts.setLineCue(s.ID, drive, 2)
	ts.setLineCue(s.ID, moved.Lines[1].ID, 7)

	got := ts.moveToScrapbook(s.ID, moved.ID)

	if want := []map[int64]float64{{drive: 2}, {}, {}, {}}; !reflect.DeepEqual(lineCues(got), want) {
		t.Errorf("lineCues = %v, want %v", lineCues(got), want)
	}
	scrap := got.Scrapbook[0]
	if cues := cuesOf(sectionOf(t, got, scrap)); !reflect.DeepEqual(cues, map[int64]float64{moved.Lines[1].ID: 7}) {
		t.Errorf("Scrapbook Section's cues = %v, want the moved Alternate's kept", cues)
	}

	got = ts.putBack(s.ID, scrap, nil)

	sec := sectionOf(t, got, scrap)
	if alt := sec.Alternates[0]; !alt.Active || alt.ID != moved.ID {
		t.Fatalf("put back alternates = %+v, want the moved one, active", sec.Alternates)
	}
	if cues := lineCues(got)[4]; !reflect.DeepEqual(cues, map[int64]float64{moved.Lines[1].ID: 7}) {
		t.Errorf("put back lineCues = %v, want the moved Alternate's, now live", cues)
	}
}

func TestAScrapbookSectionAddedToASectionBringsItsCuesDormant(t *testing.T) {
	ts := newTestServer(t)
	s, first, second := ts.cuedVerse()
	verse := s.Sections[1].ID
	chorus := s.Sections[0]
	s = ts.lyricSheetChange(http.MethodDelete, sectionInArrangementPath(s.ID, verse), nil)

	got := ts.addToSection(s.ID, verse, chorus.ID)

	alts := got.Sections[0].Alternates
	if len(alts) != 2 || !alts[0].Active || alts[1].Active {
		t.Fatalf("chorus alternates = %+v, want its own active and the Verse's inactive", alts)
	}
	want := map[int64]float64{first: 10, second: 14}
	if cues := lineCues(got)[0]; !reflect.DeepEqual(cues, want) {
		t.Errorf("chorus lineCues = %v, want the Verse's, dormant, %v", cues, want)
	}

	// Made active, they come back into effect.
	got = ts.activate(s.ID, alts[1].ID)

	if cues := lineCues(got)[0]; !reflect.DeepEqual(cues, want) {
		t.Errorf("chorus lineCues once active = %v, want %v", cues, want)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

func TestDeletingAScrapbookSectionDropsItsCues(t *testing.T) {
	ts := newTestServer(t)
	s, _, _ := ts.cuedVerse()
	verse := s.Sections[1].ID
	ts.lyricSheetChange(http.MethodDelete, sectionInArrangementPath(s.ID, verse), nil)

	got := ts.lyricSheetChange(http.MethodDelete, sectionPath(s.ID, verse), nil)

	expectSectionDeleted(t, got, verse)
	if cues := songCues(got); len(cues) != 0 {
		t.Errorf("song cues = %v, want none", cues)
	}
}

func TestCuesClearedInTheScrapbookCanBeRestored(t *testing.T) {
	ts := newTestServer(t)
	s, first, second := ts.cuedVerse()
	verse := s.Sections[1].ID
	before := ts.lyricSheetChange(http.MethodDelete, sectionInArrangementPath(s.ID, verse), nil)
	cleared := ts.lyricSheetChange(http.MethodDelete, songCuesPath(s.ID), nil)
	if cues := songCues(cleared); len(cues) != 0 {
		t.Fatalf("song cues = %v, want all cleared, the Scrapbook's included", cues)
	}

	// As undo does: putting back what the clear took.
	got := ts.restoreCues(s.ID, cueValue{LineID: &first, Cue: ptr(10.0)}, cueValue{LineID: &second, Cue: ptr(14.0)})

	if !reflect.DeepEqual(songCues(got), songCues(before)) {
		t.Errorf("song cues = %v, want them back as %v", songCues(got), songCues(before))
	}
}
