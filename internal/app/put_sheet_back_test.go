package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
	"time"
)

// sheetOf is a Song's Lyric Sheet and Scrapbook, as a copy to put back.
func sheetOf(s song) map[string]any {
	return map[string]any{"arrangement": s.Arrangement, "scrapbook": s.Scrapbook, "sections": s.Sections}
}

// putSheetBack puts a copy of the Lyric Sheet and Scrapbook back, based on
// the version given.
func (ts *testServer) putSheetBack(songID, version int64, sheet any) response {
	ts.t.Helper()
	return ts.DoAt(version, http.MethodPut, fmt.Sprintf("/api/songs/%d/sheet", songID), sheet)
}

// sameSheet fails the test unless got's Lyric Sheet and Scrapbook are want's.
func sameSheet(t *testing.T, got, want song) {
	t.Helper()
	if !reflect.DeepEqual(got.Arrangement, want.Arrangement) || !reflect.DeepEqual(got.Scrapbook, want.Scrapbook) ||
		!reflect.DeepEqual(got.Sections, want.Sections) {
		t.Errorf("sheet = %v %v %+v,\nwant %v %v %+v", got.Arrangement, got.Scrapbook, got.Sections,
			want.Arrangement, want.Scrapbook, want.Sections)
	}
}

func TestPuttingTheSheetBackBringsBackWhatWasDeletedUnderItsIdsWithItsCues(t *testing.T) {
	ts, clock, s := snapshotServer(t, "City lights\nFading out")
	verse := s.Sections[0]
	ts.setLineCue(s.ID, verse.Alternates[0].Lines[0].ID, 1)
	s = ts.addAlternate(s.ID, verse.ID, map[string]any{"name": "Slower"})
	slower := sectionsByID(s)[verse.ID].Alternates[1]
	// Its Line keeps the Cue copied with it, dormant.
	ts.setText(s.ID, slower.ID, "City lights, slower")
	s = ts.activate(s.ID, verse.Alternates[0].ID)
	s = ts.addToScrapbook(s.ID, "Idea")
	idea := s.Scrapbook[0]
	s = ts.setText(s.ID, sectionsByID(s)[idea].Alternates[0].ID, "Neon rain")
	s = ts.addSection(s.ID, map[string]any{"label": "Chorus"})
	before := ts.setText(s.ID, sectionsByID(s)[s.Arrangement[1]].Alternates[0].ID, "Hold on")

	clock.Advance(time.Minute)
	ts.lyricSheetChange(http.MethodDelete, alternatePath(s.ID, slower.ID), nil)
	ts.lyricSheetChange(http.MethodDelete, sectionPath(s.ID, idea), nil)
	ts.lyricSheetChange(http.MethodPut, reorderPath(s.ID), map[string]any{"sections": []int64{before.Arrangement[1], verse.ID}})
	now := ts.lyricSheetChange(http.MethodDelete, fmt.Sprintf("/api/songs/%d/arrangement/%d", s.ID, before.Arrangement[1]), nil)
	snapshots := len(ts.listSnapshots(s.ID))

	res := ts.putSheetBack(s.ID, now.Version, sheetOf(before))
	expectStatus(t, res, http.StatusOK)
	var after song
	res.JSON(t, &after)
	if after.Version != now.Version+1 {
		t.Errorf("version = %d, want %d", after.Version, now.Version+1)
	}
	sameSheet(t, after, before)
	if cues := cuesOf(sectionsByID(after)[verse.ID]); len(cues) != 2 {
		t.Errorf("cues = %v, want the Verse's and Slower's back", cues)
	}
	if got := ts.getSong(s.ID); !reflect.DeepEqual(got.Sections, after.Sections) {
		t.Errorf("song = %+v, want it as putting the sheet back answered", got)
	}
	if list := ts.listSnapshots(s.ID); len(list) != snapshots {
		t.Errorf("snapshots = %+v, want none taken, as the change was within the editing session", list)
	}
}

func TestPuttingTheSheetBackDeletesWhatTheCopyDoesntHold(t *testing.T) {
	ts, _, s := snapshotServer(t, "City lights")
	before := s
	s = ts.addSection(s.ID, map[string]any{"label": "Chorus"})
	s = ts.addToScrapbook(s.ID, "Idea")
	s = ts.addAlternate(s.ID, before.Sections[0].ID, nil)
	s = ts.setText(s.ID, before.Sections[0].Alternates[0].ID, "City lights\nNeon rain")

	res := ts.putSheetBack(s.ID, s.Version, sheetOf(before))
	expectStatus(t, res, http.StatusOK)
	var after song
	res.JSON(t, &after)
	sameSheet(t, after, before)
}

func TestPuttingTheSheetBackBasedOnAnOldVersionIsRejectedAsStale(t *testing.T) {
	ts, _, s := snapshotServer(t, "City lights")
	before := s
	ts.setLabel(s.ID, s.Sections[0].ID, "Verse 1")

	expectStale(t, ts.putSheetBack(s.ID, before.Version, sheetOf(before)))
	if got := ts.getSong(s.ID); got.Sections[0].Label != "Verse 1" {
		t.Errorf("label = %q, want the sheet left as it is", got.Sections[0].Label)
	}
}

func TestPuttingBackACopyThatIsntASheetIsRefused(t *testing.T) {
	ts, _, s := snapshotServer(t, "City lights")
	s = ts.addAlternate(s.ID, s.Sections[0].ID, nil)
	s = ts.addToScrapbook(s.ID, "Idea")
	verse, idea := s.Arrangement[0], s.Scrapbook[0]
	other := ts.createSong("Other")
	other = ts.addSection(other.ID, map[string]any{"label": "Theirs"})

	// edited is the Song's sheet with one thing changed by edit.
	edited := func(edit func(s *song)) map[string]any {
		var c song
		res := ts.Do(http.MethodGet, songPath(s.ID), nil)
		res.JSON(t, &c)
		edit(&c)
		return sheetOf(c)
	}
	cases := map[string]map[string]any{
		"a Section in neither": edited(func(c *song) { c.Scrapbook = []int64{} }),
		"a Section in both":    edited(func(c *song) { c.Scrapbook = []int64{verse, idea} }),
		"a Section twice":      edited(func(c *song) { c.Arrangement = []int64{verse, verse} }),
		"a Section not held":   edited(func(c *song) { c.Arrangement = []int64{verse, 999999} }),
		"no active Alternate":  edited(func(c *song) { c.Sections[0].Alternates[1].Active = false }),
		"two active Alternates": edited(func(c *song) {
			c.Sections[0].Alternates[0].Active = true
		}),
		"another Song's Section": edited(func(c *song) {
			c.Sections[1].ID = other.Sections[0].ID
			c.Scrapbook = []int64{other.Sections[0].ID}
		}),
		"another Song's Alternate": edited(func(c *song) {
			c.Sections[0].Alternates[1].ID = other.Sections[0].Alternates[0].ID
		}),
		"an Alternate twice": edited(func(c *song) {
			c.Sections[1].Alternates[0].ID = c.Sections[0].Alternates[0].ID
		}),
		"a Line twice": edited(func(c *song) {
			c.Sections[0].Alternates[1].Lines[0].ID = c.Sections[0].Alternates[0].Lines[0].ID
		}),
		"a Line with a line break": edited(func(c *song) { c.Sections[0].Alternates[0].Lines[0].Text = "City\nlights" }),
		"a Cue out of range": edited(func(c *song) {
			cue := -1.0
			c.Sections[0].Alternates[0].Lines[0].Cue = &cue
		}),
	}
	for name, sheet := range cases {
		t.Run(name, func(t *testing.T) {
			expectStatus(t, ts.putSheetBack(s.ID, s.Version, sheet), http.StatusBadRequest)
		})
	}
	if got := ts.getSong(s.ID); got.Version != s.Version || !reflect.DeepEqual(got.Sections, s.Sections) {
		t.Errorf("song = %+v, want it left as it was", got)
	}
}
