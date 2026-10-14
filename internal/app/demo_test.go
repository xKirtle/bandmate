package app_test

import (
	"net/http"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
	"github.com/xKirtle/bandmate/internal/demo"
)

const demoPath = "/api/demo"

// putDemoBack puts the Demo back as built into Bandmate, as starting a Tour
// does, and returns the Demo Song it answers with.
func (ts *testServer) putDemoBack() song {
	ts.t.Helper()
	res := ts.Do(http.MethodPost, demoPath, nil)
	expectStatus(ts.t, res, http.StatusOK)
	var s song
	res.JSON(ts.t, &s)
	return s
}

// demoBeat is the Beat the Demo Song's Timeline plays.
func (ts *testServer) demoBeat(demo song) int64 {
	ts.t.Helper()
	tl := ts.getTimeline(demo.ID)
	for _, tr := range tl.Tracks {
		for _, c := range tr.Clips {
			if c.BeatID != 0 {
				return c.BeatID
			}
		}
	}
	ts.t.Fatalf("the Demo Song's Timeline = %+v, want a Clip of the Demo Beat", tl)
	return 0
}

func TestPuttingTheDemoBackRestoresTheDemoSongWithTheDemoBeatOnItsTimeline(t *testing.T) {
	ts := newTestServer(t)

	demo := ts.putDemoBack()

	if demo.Title != "Paper Boats" {
		t.Errorf("Demo Song's title = %q, want Paper Boats", demo.Title)
	}
	sections := sectionsByID(demo)
	var labels []string
	for _, id := range demo.Arrangement {
		labels = append(labels, sections[id].Label)
	}
	if want := []string{"Verse", "Chorus", "Verse 2", "Chorus"}; !reflect.DeepEqual(labels, want) {
		t.Errorf("Demo Song's Arrangement = %v, want %v", labels, want)
	}
	if got := ts.getSong(demo.ID); got.ID != demo.ID || got.Title != demo.Title {
		t.Errorf("reading the Demo Song = %+v, want the one answered, %+v", got, demo)
	}
	beatID := ts.demoBeat(demo)
	b := ts.getBeat(beatID)
	if b.Duration <= 0 || len(b.Peaks) == 0 {
		t.Errorf("Demo Beat = %+v, want its duration and peaks", b)
	}
	audio := ts.Do(http.MethodGet, beatPath(beatID)+"/audio", nil)
	expectStatus(t, audio, http.StatusOK)
	if len(audio.Body) == 0 {
		t.Error("the Demo Beat's audio is empty")
	}
}

func TestPuttingTheDemoBackAgainReplacesThePreviousDemo(t *testing.T) {
	ts := newTestServer(t)
	first := ts.putDemoBack()
	firstBeat := ts.demoBeat(first)
	// As if the Tour had changed it, which it can't, or an older Bandmate
	// had built it.
	ts.updateSong(first.ID, map[string]any{"title": "Paper Boats, changed"})

	again := ts.putDemoBack()

	if again.Title != "Paper Boats" {
		t.Errorf("Demo Song's title = %q, want Paper Boats as built", again.Title)
	}
	if again.ID != first.ID {
		expectStatus(t, ts.Do(http.MethodGet, songPath(first.ID), nil), http.StatusNotFound)
	}
	if beat := ts.demoBeat(again); beat != firstBeat {
		expectStatus(t, ts.Do(http.MethodGet, beatPath(firstBeat), nil), http.StatusNotFound)
	}
	if files := audioFiles(t, ts); len(files) != 1 {
		t.Errorf("audio files = %v, want only the Demo Beat's", files)
	}
}

func TestTheBuiltInDemoIsAWholeBackupOfOneSongAndTheBeatItUses(t *testing.T) {
	ts := newTestServer(t)

	res := ts.uploadBackup(demo.Backup)

	expectStatus(t, res, http.StatusCreated)
	var b backup
	res.JSON(t, &b)
	if b.Songs != 1 || b.Beats != 1 {
		t.Errorf("built-in Demo = %+v, want 1 Song and 1 Beat", b)
	}
}

func TestARestoreNeverTakesTheDemoForWhatsAlreadyInBandmate(t *testing.T) {
	ts := newTestServer(t)
	ts.putDemoBack()
	// The built-in Demo, as if a user had a Backup of it.
	res := ts.uploadBackup(demo.Backup)
	expectStatus(t, res, http.StatusCreated)
	var up backup
	res.JSON(t, &up)
	var held []struct{ ID int64 }
	ts.Do(http.MethodGet, backupPath(up.ID)+"/songs", nil).JSON(t, &held)
	picks := map[string]any{"songs": []int64{held[0].ID}}

	songs, beats := ts.presentPicked(up.ID, picks)
	restored := ts.restoreBody(up.ID, picks)

	if len(songs) != 0 || len(beats) != 0 {
		t.Errorf("already in Bandmate = %+v and %+v, want neither the Demo Song nor the Demo Beat", songs, beats)
	}
	if got := titles(ts.listSongs()); !reflect.DeepEqual(got, []string{"Paper Boats"}) || len(restored.Songs) != 1 {
		t.Errorf("Songs = %v after restoring %+v, want Paper Boats, as it's titled in the Backup", got, restored)
	}
	if got := beatTitles(ts.listBeats()); len(got) != 1 {
		t.Errorf("Beat Library = %v, want the Beat restored", got)
	}
}

func TestTheDemoNeverGoesIntoABackup(t *testing.T) {
	ts := newTestServer(t)
	demo := ts.putDemoBack()
	demoBeat := ts.demoBeat(demo)

	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"allSongs": true}),
		http.StatusBadRequest, "there are no Songs to back up")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"allSongs": true, "beatLibrary": true}),
		http.StatusBadRequest, "there's nothing to back up")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"songs": []int64{demo.ID}}),
		http.StatusBadRequest, "a Song picked doesn't exist")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"beats": []int64{demoBeat}}),
		http.StatusBadRequest, "a Beat picked doesn't exist")

	ts.createSong("Night Drive")
	ts.uploadBeat(fakeAudio("trap.mp3").with(map[string]any{"title": "Trap"}))
	everything := ts.backUp(map[string]any{"allSongs": true, "beatLibrary": true})

	if everything.Songs != 1 || everything.Beats != 1 {
		t.Errorf("Backup of Everything = %+v, want 1 Song and 1 Beat", everything)
	}
	var songs []struct{ Title string }
	ts.Do(http.MethodGet, backupPath(everything.ID)+"/songs", nil).JSON(t, &songs)
	var beats []struct{ Title string }
	ts.Do(http.MethodGet, backupPath(everything.ID)+"/beats", nil).JSON(t, &beats)
	if len(songs) != 1 || songs[0].Title != "Night Drive" || len(beats) != 1 || beats[0].Title != "Trap" {
		t.Errorf("Backup of Everything holds Songs %+v and Beats %+v, want Night Drive and Trap", songs, beats)
	}
}

func TestPuttingTheDemoBackIsNoChangeForAScheduledBackup(t *testing.T) {
	clock := newScheduleClock()
	ts := scheduledServer(t, clock, backupSchedule{On: true, Period: "weekly", Keep: 4})

	ts.putDemoBack()
	clock.Advance(7 * 24 * time.Hour)
	ts.app.CheckBackupSchedule()

	if list := ts.listBackups(); len(list) != 1 {
		t.Errorf("backups = %+v, want still 1", list)
	}
	if last := ts.schedule().Last; last == nil || last.Outcome != "unchanged" {
		t.Errorf("last try = %+v, want nothing changed", last)
	}
}

func TestAScheduledBackupFindsNothingToBackUpBesideTheDemo(t *testing.T) {
	clock := newScheduleClock()
	ts := newTestServerWith(t, func(c *app.Config) { c.Now = clock.Now })
	ts.putDemoBack()

	ts.setSchedule(backupSchedule{On: true, Period: "weekly", Keep: 4})
	ts.app.CheckBackupSchedule()

	if list := ts.listBackups(); len(list) != 0 {
		t.Errorf("backups = %+v, want none", list)
	}
	if last := ts.schedule().Last; last == nil || last.Outcome != "empty" {
		t.Errorf("last try = %+v, want nothing to back up", last)
	}
}

func TestTheDemoSongAndDemoBeatNeverShowAmongTheUsersSongsAndBeats(t *testing.T) {
	ts := newTestServer(t)
	mine := ts.createSong("Paper Planes")
	demos := ts.createFolder("Demos")
	expectStatus(t, ts.moveSong(mine.ID, &demos.ID), http.StatusNoContent)
	ts.tagSong(mine.ID, "paper")
	ts.uploadBeat(fakeAudio("trap.mp3").with(map[string]any{"title": "Demo Trap"}))
	demo := ts.putDemoBack()
	// Filed and tagged, as the Tour never does, it still doesn't show.
	expectStatus(t, ts.moveSong(demo.ID, &demos.ID), http.StatusNoContent)
	ts.tagSong(demo.ID, "paper")

	for query, want := range map[string][]string{
		"":          {"Paper Planes"},
		"q=paper":   {"Paper Planes"},
		"q=boats":   {},
		"tag=paper": {"Paper Planes"},
		"folder=" + strconv.FormatInt(demos.ID, 10): {"Paper Planes"},
	} {
		if got := titles(ts.listSongs(query)); !reflect.DeepEqual(got, want) {
			t.Errorf("Songs listed with %q = %v, want %v", query, got, want)
		}
	}
	if got := ts.listFolders(); len(got) != 1 || got[0].Songs != 1 {
		t.Errorf("Folders = %+v, want Demos holding 1 Song", got)
	}
	if got := ts.listTags(); len(got) != 1 || got[0].Songs != 1 {
		t.Errorf("Tags = %+v, want paper carried by 1 Song", got)
	}
	for _, query := range []string{"", "q=demo"} {
		if got := beatTitles(ts.listBeats(query)); !reflect.DeepEqual(got, []string{"Demo Trap"}) {
			t.Errorf("Beat Library with %q = %v, want only Demo Trap", query, got)
		}
	}
}
