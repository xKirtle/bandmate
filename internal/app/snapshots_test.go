package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
)

// snapshotSummary is a Snapshot as the list gives it, without its sheet.
type snapshotSummary struct {
	ID      int64  `json:"id"`
	TakenAt string `json:"takenAt"`
	Reason  string `json:"reason"`
	Deleted string `json:"deleted"`
	Kept    bool   `json:"kept"`
}

// snapshot is one Snapshot with the Lyric Sheet and Scrapbook it holds.
type snapshot struct {
	snapshotSummary
	Sheet struct {
		Arrangement []int64   `json:"arrangement"`
		Sections    []section `json:"sections"`
		Scrapbook   []int64   `json:"scrapbook"`
	} `json:"sheet"`
}

// snapshotServer starts a server on a clock the test moves on, holding a
// Song with one Section, "Verse", whose Lines are lines.
func snapshotServer(t *testing.T, lines string) (*testServer, *testClock, song) {
	t.Helper()
	clock := &testClock{now: time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC)}
	ts := newTestServerWith(t, func(c *app.Config) { c.Now = clock.Now })
	s := ts.createSong("Night Drive")
	s = ts.addSection(s.ID, map[string]any{"label": "Verse"})
	s = ts.setText(s.ID, s.Sections[0].Alternates[0].ID, lines)
	return ts, clock, s
}

func (ts *testServer) listSnapshots(songID int64) []snapshotSummary {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, fmt.Sprintf("/api/songs/%d/snapshots", songID), nil)
	expectStatus(ts.t, res, http.StatusOK)
	var list []snapshotSummary
	res.JSON(ts.t, &list)
	return list
}

func (ts *testServer) getSnapshot(songID, snapshotID int64) snapshot {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, fmt.Sprintf("/api/songs/%d/snapshots/%d", songID, snapshotID), nil)
	expectStatus(ts.t, res, http.StatusOK)
	var s snapshot
	res.JSON(ts.t, &s)
	return s
}

func TestAChangeAfterTenMinutesTakesASnapshotOfTheSheetAsItWas(t *testing.T) {
	ts, clock, s := snapshotServer(t, "City lights\n[Am]Fading out")
	clock.Advance(10 * time.Minute)
	ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "City lights\nFading slow")

	list := ts.listSnapshots(s.ID)
	if len(list) != 1 {
		t.Fatalf("snapshots = %+v, want one", list)
	}
	if list[0].Reason != "editing" || !parseTime(t, list[0].TakenAt).Equal(clock.Now()) {
		t.Errorf("snapshot = %+v, want one taken now, for editing", list[0])
	}
	got := ts.getSnapshot(s.ID, list[0].ID)
	if len(got.Sheet.Sections) != 1 || got.Sheet.Sections[0].Label != "Verse" {
		t.Fatalf("sheet = %+v, want the one Section, Verse", got.Sheet)
	}
	if texts := activeLines(got.Sheet.Sections[0]); fmt.Sprint(texts) != "[City lights [Am]Fading out]" {
		t.Errorf("lines = %q, want them as they were before the change", texts)
	}
	if got.Sheet.Sections[0].Alternates[0].Lines[1].Lyrics != "Fading out" {
		t.Errorf("line = %+v, want its lyrics read from its text", got.Sheet.Sections[0].Alternates[0].Lines[1])
	}
	if fmt.Sprint(got.Sheet.Arrangement) != fmt.Sprint([]int64{s.Sections[0].ID}) {
		t.Errorf("arrangement = %v, want the Section's id", got.Sheet.Arrangement)
	}
}

func TestSnapshotsOfAnotherSongArentFound(t *testing.T) {
	ts, clock, s := snapshotServer(t, "City lights")
	clock.Advance(time.Hour)
	ts.setLabel(s.ID, s.Sections[0].ID, "Verse 1")
	other := ts.createSong("Other")
	id := ts.listSnapshots(s.ID)[0].ID

	expectStatus(t, ts.Do(http.MethodGet, fmt.Sprintf("/api/songs/%d/snapshots/%d", other.ID, id), nil), http.StatusNotFound)
	expectStatus(t, ts.DoAt(other.Version, http.MethodPost,
		fmt.Sprintf("/api/songs/%d/snapshots/%d/restore", other.ID, id), nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodGet, "/api/songs/9999/snapshots", nil), http.StatusNotFound)
}

// restoreSnapshot restores a Snapshot, based on the version given.
func (ts *testServer) restoreSnapshot(songID int64, version int64, snapshotID int64) response {
	ts.t.Helper()
	return ts.DoAt(version, http.MethodPost, fmt.Sprintf("/api/songs/%d/snapshots/%d/restore", songID, snapshotID), nil)
}

// sectionLabeled finds a Section by its Label.
func sectionLabeled(t *testing.T, sections []section, label string) section {
	t.Helper()
	for _, sec := range sections {
		if sec.Label == label {
			return sec
		}
	}
	t.Fatalf("no Section %q in %+v", label, sections)
	return section{}
}

func TestRestoringASnapshotMakesTheSheetAndScrapbookItsKeepingCuesOnLinesStillThere(t *testing.T) {
	ts, clock, s := snapshotServer(t, "City lights\nFading out")
	verse := s.Sections[0]
	city, fading := verse.Alternates[0].Lines[0].ID, verse.Alternates[0].Lines[1].ID
	ts.setLineCue(s.ID, city, 1)
	ts.setLineCue(s.ID, fading, 2)
	s = ts.addAlternate(s.ID, verse.ID, map[string]any{"name": "Slower"})
	slower := sectionsByID(s)[verse.ID].Alternates[1].ID
	ts.lyricSheetChange(http.MethodPost, alternatePath(s.ID, verse.Alternates[0].ID)+"/activate", nil)
	s = ts.addToScrapbook(s.ID, "Idea")
	idea := s.Scrapbook[0]
	ts.setText(s.ID, sectionsByID(s)[idea].Alternates[0].ID, "Neon rain")

	// The Snapshot to restore, then the changes it undoes.
	clock.Advance(time.Hour)
	ts.setText(s.ID, verse.Alternates[0].ID, "City lights")
	snap := ts.listSnapshots(s.ID)[0]
	ts.lyricSheetChange(http.MethodDelete, alternatePath(s.ID, slower), nil)
	ts.lyricSheetChange(http.MethodDelete, sectionPath(s.ID, idea), nil)
	ts.addSection(s.ID, map[string]any{"label": "Bridge"})
	before := ts.setLineCue(s.ID, city, 5)

	clock.Advance(time.Minute)
	res := ts.restoreSnapshot(s.ID, before.Version, snap.ID)
	expectStatus(t, res, http.StatusOK)
	var after song
	res.JSON(t, &after)

	if after.Version != before.Version+1 {
		t.Errorf("version = %d, want %d", after.Version, before.Version+1)
	}
	if fmt.Sprint(after.Arrangement) != fmt.Sprint([]int64{verse.ID}) || fmt.Sprint(after.Scrapbook) != fmt.Sprint([]int64{idea}) {
		t.Fatalf("arrangement %v and scrapbook %v, want the Verse, and Idea back with its id", after.Arrangement, after.Scrapbook)
	}
	got := sectionsByID(after)
	if lines := activeLines(got[verse.ID]); fmt.Sprint(lines) != "[City lights Fading out]" {
		t.Errorf("verse = %q, want its Lines as the Snapshot holds them", lines)
	}
	if ids := lineIDs(got[verse.ID].Alternates[0]); fmt.Sprint(ids) != fmt.Sprint([]int64{city, fading}) {
		t.Errorf("line ids = %v, want City lights's kept and Fading out's back", ids)
	}
	if alts := got[verse.ID].Alternates; len(alts) != 2 || alts[1].ID != slower || alts[1].Name != "Slower" || alts[1].Active || !alts[0].Active {
		t.Errorf("alternates = %+v, want Slower back, inactive, with its id", alts)
	}
	if lines := activeLines(got[idea]); fmt.Sprint(lines) != "[Neon rain]" {
		t.Errorf("idea = %q, want it back", lines)
	}
	want := map[int64]float64{city: 5, fading: 2}
	if cues := cuesOf(got[verse.ID]); len(cues) != 4 || cues[city] != want[city] || cues[fading] != want[fading] {
		t.Errorf("cues = %v, want City lights's as it is now, %v, Fading out's, deleted and brought back, as it was, %v, and Slower's copies back",
			cues, want[city], want[fading])
	}
	if got := ts.getSong(s.ID); !reflect.DeepEqual(got.Sections, after.Sections) {
		t.Errorf("song = %+v, want it as the restore answered", got)
	}

	list := ts.listSnapshots(s.ID)
	if len(list) != 4 || list[0].Reason != "restoring" || !parseTime(t, list[0].TakenAt).Equal(clock.Now()) {
		t.Fatalf("snapshots = %+v, want four: one before the session, one before each deletion, and one taken now, before restoring", list)
	}
	held := ts.getSnapshot(s.ID, list[0].ID).Sheet
	if len(held.Sections) != 2 {
		t.Errorf("sheet = %+v, want the Verse and the Bridge, as they were before restoring", held)
	}
	sectionLabeled(t, held.Sections, "Bridge")
	if lines := activeLines(sectionLabeled(t, held.Sections, "Verse")); fmt.Sprint(lines) != "[City lights]" {
		t.Errorf("verse = %q, want it as it was before restoring", lines)
	}
}

func TestARestoreBasedOnAnOldVersionIsRejectedAsStale(t *testing.T) {
	ts, clock, s := snapshotServer(t, "City lights")
	clock.Advance(time.Hour)
	ts.setLabel(s.ID, s.Sections[0].ID, "Verse 1")
	snap := ts.listSnapshots(s.ID)[0]

	expectStale(t, ts.restoreSnapshot(s.ID, s.Version, snap.ID))
	if got := ts.getSong(s.ID); got.Sections[0].Label != "Verse 1" {
		t.Errorf("label = %q, want the sheet left as it is", got.Sections[0].Label)
	}
	if list := ts.listSnapshots(s.ID); len(list) != 1 {
		t.Errorf("snapshots = %+v, want no new one", list)
	}
}

func TestASnapshotRestoredFromABackupKeepsCuesAsAnyOther(t *testing.T) {
	ts, clock, s := snapshotServer(t, "City lights\nFading out")
	verse := s.Sections[0].Alternates[0]
	city := verse.Lines[0].ID
	ts.setLineCue(s.ID, city, 1)
	ts.setLineCue(s.ID, verse.Lines[1].ID, 2)
	clock.Advance(time.Hour)
	ts.setText(s.ID, verse.ID, "City lights")
	ts.setLineCue(s.ID, city, 5)
	b := ts.backUp(map[string]any{"songs": []int64{s.ID}})

	restored := ts.restore(b.ID, ts.backupSongs(b.ID)[0].ID)
	if len(restored) != 1 || restored[0].ID == s.ID {
		t.Fatalf("restored = %+v, want the Song kept alongside", restored)
	}
	// Lines added since take ids of their own, never one a Snapshot
	// restored from the Backup holds.
	ts.setText(s.ID, verse.ID, "City lights\nNeon rain\nFalling")

	for _, id := range []int64{restored[0].ID, s.ID} {
		now := ts.getSong(id)
		list := ts.listSnapshots(id)
		if len(list) != 1 || list[0].Reason != "editing" {
			t.Fatalf("song %d's snapshots = %+v, want the one taken before editing", id, list)
		}
		held := ts.getSnapshot(id, list[0].ID).Sheet
		if len(held.Sections) != 1 || held.Sections[0].ID != now.Sections[0].ID ||
			held.Sections[0].Alternates[0].ID != now.Sections[0].Alternates[0].ID ||
			held.Sections[0].Alternates[0].Lines[0].ID != now.Sections[0].Alternates[0].Lines[0].ID {
			t.Fatalf("song %d's snapshot holds %+v, want the ids of its own Verse, %+v", id, held, now.Sections)
		}
		res := ts.restoreSnapshot(id, now.Version, list[0].ID)
		expectStatus(t, res, http.StatusOK)
		var after song
		res.JSON(t, &after)
		alt := after.Sections[0].Alternates[0]
		if lines := activeLines(after.Sections[0]); fmt.Sprint(lines) != "[City lights Fading out]" {
			t.Fatalf("song %d's verse = %q, want it as the Snapshot holds it", id, lines)
		}
		if alt.Lines[0].ID != now.Sections[0].Alternates[0].Lines[0].ID {
			t.Errorf("song %d's City lights = %d, want it kept, %d", id, alt.Lines[0].ID, now.Sections[0].Alternates[0].Lines[0].ID)
		}
		if cues := cuesOf(after.Sections[0]); len(cues) != 2 || cues[alt.Lines[0].ID] != 5 || cues[alt.Lines[1].ID] != 2 {
			t.Errorf("song %d's cues = %v, want City lights's as it is now, 5, and Fading out's back as it was, 2", id, cues)
		}
	}
}

func TestDeletingAScrapbookSectionTakesASnapshotFirstNamingIt(t *testing.T) {
	ts, clock, s := snapshotServer(t, "City lights")
	s = ts.addToScrapbook(s.ID, "Verse 3")
	verse3 := s.Scrapbook[0]
	ts.setText(s.ID, sectionsByID(s)[verse3].Alternates[0].ID, "Neon rain")
	clock.Advance(time.Hour)

	// A Section in the Arrangement can't be deleted, so takes none.
	expectStatus(t, ts.Do(http.MethodDelete, sectionPath(s.ID, s.Arrangement[0]), nil), http.StatusConflict)
	if list := ts.listSnapshots(s.ID); len(list) != 0 {
		t.Fatalf("snapshots = %+v, want none, as nothing was deleted", list)
	}

	ts.lyricSheetChange(http.MethodDelete, sectionPath(s.ID, verse3), nil)
	list := ts.listSnapshots(s.ID)
	if len(list) != 1 {
		t.Fatalf("snapshots = %+v, want one, before the deletion, and none for the session", list)
	}
	if list[0].Reason != "deleting" || list[0].Deleted != "Verse 3" || !parseTime(t, list[0].TakenAt).Equal(clock.Now()) {
		t.Errorf("snapshot = %+v, want one taken now, before deleting Verse 3", list[0])
	}
	held := ts.getSnapshot(s.ID, list[0].ID).Sheet
	if lines := activeLines(sectionLabeled(t, held.Sections, "Verse 3")); fmt.Sprint(lines) != "[Neon rain]" {
		t.Errorf("verse 3 = %q, want it held as it was", lines)
	}
}
