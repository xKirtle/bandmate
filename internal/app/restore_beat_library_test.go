package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// restoredContents is what a Restore brought back, as it answers: the
// Songs, and how many Beats were added or replaced.
type restoredContents struct {
	Songs []restoredSong `json:"songs"`
	Beats int            `json:"beats"`
}

// restoreBody restores what body picks from a Backup, e.g.
// {"beatLibrary": true}, and returns what came back.
func (ts *testServer) restoreBody(id int64, body map[string]any) restoredContents {
	ts.t.Helper()
	res := ts.Do(http.MethodPost, backupPath(id)+"/restore", body)
	expectStatus(ts.t, res, http.StatusOK)
	var got restoredContents
	res.JSON(ts.t, &got)
	return got
}

func TestRestoringTheBeatLibraryBringsBackEveryBeatWithoutSongs(t *testing.T) {
	ts := newTestServer(t)
	used := ts.uploadBeat(fakeAudio("used.mp3").with(map[string]any{"title": "Used", "producer": "Kai", "bpm": 92}))
	unused := ts.uploadBeat(fakeAudio("unused.mp3").with(map[string]any{"title": "Unused", "notes": "for later"}))
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	made := ts.backUp(map[string]any{"songs": []int64{}, "beatLibrary": true})
	audio := map[string][]byte{}
	for _, b := range []beat{used, unused} {
		audio[b.Title] = ts.Do(http.MethodGet, beatPath(b.ID)+"/audio", nil).Body
	}
	expectStatus(t, ts.Do(http.MethodDelete, songPath(s.ID), nil), http.StatusNoContent)
	for _, b := range []beat{used, unused} {
		expectStatus(t, ts.Do(http.MethodDelete, beatPath(b.ID), nil), http.StatusNoContent)
	}

	got := ts.restoreBody(made.ID, map[string]any{"beatLibrary": true})

	if len(got.Songs) != 0 || got.Beats != 2 {
		t.Errorf("restored = %+v, want no Songs and 2 Beats", got)
	}
	if songs := ts.listSongs(); len(songs) != 0 {
		t.Errorf("songs = %q, want none", titles(songs))
	}
	beats := ts.listBeats()
	if got := sorted(beatTitles(beats)); !reflect.DeepEqual(got, []string{"Unused", "Used"}) {
		t.Fatalf("beats = %q, want both back", got)
	}
	for _, b := range beats {
		want := used
		if b.Title == "Unused" {
			want = unused
		}
		if b.Producer != want.Producer || !reflect.DeepEqual(b.BPM, want.BPM) || b.Notes != want.Notes ||
			b.FileName != want.FileName || b.Duration != want.Duration || len(b.Songs) != 0 {
			t.Errorf("beat = %+v, want it as backed up, %+v, used by no Song", b, want)
		}
		expectBody(t, ts.Do(http.MethodGet, beatPath(b.ID)+"/audio", nil), string(audio[b.Title]))
	}
}

// presentPicked lists what of body's picks from a Backup, e.g.
// {"beatLibrary": true}, is already in Bandmate.
func (ts *testServer) presentPicked(id int64, body map[string]any) (presentSongs, presentBeats []presentItem) {
	ts.t.Helper()
	res := ts.Do(http.MethodPost, backupPath(id)+"/present", body)
	expectStatus(ts.t, res, http.StatusOK)
	var got struct {
		Songs []presentItem `json:"songs"`
		Beats []presentItem `json:"beats"`
	}
	res.JSON(ts.t, &got)
	return got.Songs, got.Beats
}

func TestBeatsOfTheBeatLibraryAlreadyInBandmateAreReplacedOrKeptBoth(t *testing.T) {
	ts := newTestServer(t)
	used := ts.uploadBeat(fakeAudio("used.mp3").with(map[string]any{"title": "Used", "producer": "Kai"}))
	unused := ts.uploadBeat(fakeAudio("unused.mp3").with(map[string]any{"title": "Unused", "producer": "Kai"}))
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	made := ts.backUp(map[string]any{"songs": []int64{}, "beatLibrary": true})
	for _, b := range []beat{used, unused} {
		expectStatus(t, ts.Do(http.MethodPatch, beatPath(b.ID), map[string]any{"title": b.Title + " Again", "producer": "Someone"}),
			http.StatusOK)
	}

	songs, beats := ts.presentPicked(made.ID, map[string]any{"beatLibrary": true})

	want := []presentItem{
		{unused.ID, "Unused", restoredSong{unused.ID, "Unused Again"}},
		{used.ID, "Used", restoredSong{used.ID, "Used Again"}},
	}
	if len(songs) != 0 || !reflect.DeepEqual(beats, want) {
		t.Errorf("already in Bandmate = %+v, %+v, want no Songs and the two Beats, %+v", songs, beats, want)
	}

	// Used is replaced; Unused is kept both.
	got := ts.restoreBody(made.ID, map[string]any{"beatLibrary": true, "replace": map[string]any{"beats": []int64{used.ID}}})

	if len(got.Songs) != 0 || got.Beats != 2 {
		t.Errorf("restored = %+v, want no Songs and 2 Beats", got)
	}
	if got := sorted(beatTitles(ts.listBeats())); !reflect.DeepEqual(got, []string{"Unused (restored)", "Unused Again", "Used"}) {
		t.Errorf("beats = %q, want Used replaced, and Unused kept both", got)
	}
	if b := ts.getBeat(used.ID); b.Title != "Used" || b.Producer != "Kai" || len(b.Songs) != 1 {
		t.Errorf("replaced = %+v, want the Backup's Details, still used by Night Drive", b)
	}
	if b := ts.getBeat(unused.ID); b.Title != "Unused Again" || b.Producer != "Someone" {
		t.Errorf("kept = %+v, want it untouched", b)
	}
	if got := titles(ts.listSongs()); !reflect.DeepEqual(got, []string{"Night Drive"}) {
		t.Errorf("songs = %q, want only the one there was", got)
	}
}

func TestRestoringEverythingABackupHoldsLeavesWhatItDoesntHoldUntouched(t *testing.T) {
	ts := newTestServer(t)
	used := ts.uploadBeat(fakeAudio("used.mp3").with(map[string]any{"title": "Used", "producer": "Kai"}))
	gone := ts.uploadBeat(fakeAudio("gone.mp3").with(map[string]any{"title": "Gone", "producer": "Kai"}))
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	lost := ts.createSong("Midnight")
	made := ts.backUp(map[string]any{"allSongs": true, "beatLibrary": true})
	// Since backed up: newer work the Backup doesn't hold, and a Song and a
	// Beat it does hold deleted.
	newer := ts.createSong("Newer")
	fresh := ts.uploadBeat(fakeAudio("fresh.mp3").with(map[string]any{"title": "Fresh", "producer": "Kai"}))
	timelineChange(t, ts.addBeatToSong(newer.ID, fresh.ID))
	timelineChange(t, ts.addBeatToSong(newer.ID, used.ID))
	ts.updateSong(s.ID, map[string]any{"notes": "newer"})
	expectStatus(t, ts.Do(http.MethodDelete, songPath(lost.ID), nil), http.StatusNoContent)
	expectStatus(t, ts.Do(http.MethodDelete, beatPath(gone.ID), nil), http.StatusNoContent)
	newerBefore := ts.readSongCopy(newer.ID)
	all := ts.backupSongs(made.ID)
	everything := map[string]any{"songs": []int64{all[0].ID, all[1].ID}, "beatLibrary": true}

	songs, beats := ts.presentPicked(made.ID, everything)

	if len(songs) != 1 || songs[0].ID != s.ID || len(beats) != 1 || beats[0].ID != used.ID {
		t.Errorf("already in Bandmate = %+v, %+v, want Night Drive and Used", songs, beats)
	}

	everything["replace"] = map[string]any{"songs": []int64{s.ID}, "beats": []int64{used.ID}}
	got := ts.restoreBody(made.ID, everything)

	if got := restoredTitles(got.Songs); !reflect.DeepEqual(got, []string{"Midnight", "Night Drive"}) {
		t.Errorf("restored = %q, want both Songs", got)
	}
	if got.Beats != 2 {
		t.Errorf("restored %d Beats, want 2", got.Beats)
	}
	if got := sorted(titles(ts.listSongs())); !reflect.DeepEqual(got, []string{"Midnight", "Newer", "Night Drive"}) {
		t.Errorf("songs = %q, want the two restored and the newer one", got)
	}
	if got := sorted(beatTitles(ts.listBeats())); !reflect.DeepEqual(got, []string{"Fresh", "Gone", "Used"}) {
		t.Errorf("beats = %q, want the two restored and the fresh one", got)
	}
	expectSameSong(t, newerBefore, ts.readSongCopy(newer.ID))
	if b := ts.getBeat(fresh.ID); b.Title != "Fresh" || len(b.Songs) != 1 {
		t.Errorf("fresh = %+v, want it untouched", b)
	}
	if b := ts.getBeat(used.ID); len(b.Songs) != 2 {
		t.Errorf("used = %+v, want it still used by Night Drive and Newer", b)
	}
	if got := ts.getSong(s.ID); got.Notes != "" {
		t.Errorf("night drive = %+v, want it replaced by the Backup's", got)
	}
}

func TestASongRestoredWithTheBeatLibraryPlaysTheSameBeatKeptBoth(t *testing.T) {
	ts := newTestServer(t)
	used := ts.uploadBeat(fakeAudio("used.mp3").with(map[string]any{"title": "Used", "producer": "Kai"}))
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	made := ts.backUp(map[string]any{"allSongs": true, "beatLibrary": true})

	got := ts.restoreBody(made.ID, map[string]any{"songs": []int64{s.ID}, "beatLibrary": true})

	if len(got.Songs) != 1 || got.Songs[0].Title != "Night Drive (restored)" || got.Beats != 1 {
		t.Fatalf("restored = %+v, want Night Drive and its Beat, kept both", got)
	}
	if got := sorted(beatTitles(ts.listBeats())); !reflect.DeepEqual(got, []string{"Used", "Used (restored)"}) {
		t.Fatalf("beats = %q, want the one there was and one restored, once", got)
	}
	if tl := ts.getTimeline(got.Songs[0].ID); len(tl.Beats) != 1 || tl.Beats[0].Title != "Used (restored)" {
		t.Errorf("beats of the restored Song = %+v, want the one restored with it", tl.Beats)
	}
}
