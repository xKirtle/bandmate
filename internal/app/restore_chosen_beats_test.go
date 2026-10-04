package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// backupBeat is a Beat a Backup holds, as it lists them: by its id there,
// with the Songs it holds that use it.
type backupBeat struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	Producer string `json:"producer"`
	Songs    []struct {
		ID int64 `json:"id"`
	} `json:"songs"`
}

// backupBeats lists the Beats a Backup holds.
func (ts *testServer) backupBeats(id int64) []backupBeat {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, backupPath(id)+"/beats", nil)
	expectStatus(ts.t, res, http.StatusOK)
	var list []backupBeat
	res.JSON(ts.t, &list)
	return list
}

// everyBeatIn lists, by their ids there, every Beat a Backup holds, to
// pick them all for a Restore.
func (ts *testServer) everyBeatIn(id int64) []int64 {
	ts.t.Helper()
	ids := []int64{}
	for _, b := range ts.backupBeats(id) {
		ids = append(ids, b.ID)
	}
	return ids
}

// songIDs lists the ids of the Songs using b.
func (b backupBeat) songIDs() []int64 {
	ids := []int64{}
	for _, s := range b.Songs {
		ids = append(ids, s.ID)
	}
	return ids
}

func TestABackupListsTheBeatsItHoldsWithTheSongsUsingThem(t *testing.T) {
	ts := newTestServer(t)
	used := ts.uploadBeat(fakeAudio("used.mp3").with(map[string]any{"title": "used", "producer": "Kai"}))
	picked := ts.uploadBeat(fakeAudio("picked.mp3").with(map[string]any{"title": "Picked"}))
	ts.beatOfLength("Left Out", 20)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	made := ts.backUp(map[string]any{"songs": []int64{s.ID}, "beats": []int64{picked.ID}})

	got := ts.backupBeats(made.ID)

	if len(got) != 2 {
		t.Fatalf("beats = %+v, want the one picked and the one the Song uses", got)
	}
	if got[0].ID != picked.ID || got[0].Title != "Picked" || got[0].Producer != "" || len(got[0].songIDs()) != 0 {
		t.Errorf("first = %+v, want Picked, by title, used by no Song", got[0])
	}
	if got[1].ID != used.ID || got[1].Title != "used" || got[1].Producer != "Kai" ||
		!reflect.DeepEqual(got[1].songIDs(), []int64{s.ID}) {
		t.Errorf("second = %+v, want used, by Kai, used by Night Drive", got[1])
	}
	expectError(t, ts.Do(http.MethodGet, backupPath(made.ID+1)+"/beats", nil), http.StatusNotFound, "not found")
}

func TestRestoringChosenBeatsBringsBackOnlyThoseBeats(t *testing.T) {
	ts := newTestServer(t)
	a := ts.uploadBeat(fakeAudio("a.mp3").with(map[string]any{"title": "Dark Trap", "producer": "Kai", "bpm": 92}))
	b := ts.beatOfLength("Lo-fi", 20)
	c := ts.beatOfLength("Not Picked", 20)
	made := ts.backUp(map[string]any{"beats": []int64{a.ID, b.ID, c.ID}})
	audio := ts.Do(http.MethodGet, beatPath(a.ID)+"/audio", nil).Body
	for _, beat := range []beat{a, b, c} {
		expectStatus(t, ts.Do(http.MethodDelete, beatPath(beat.ID), nil), http.StatusNoContent)
	}

	got := ts.restoreBody(made.ID, map[string]any{"beats": []int64{a.ID, b.ID}})

	if len(got.Songs) != 0 || got.Beats != 2 {
		t.Errorf("restored = %+v, want no Songs and 2 Beats", got)
	}
	beats := ts.listBeats()
	if got := sorted(beatTitles(beats)); !reflect.DeepEqual(got, []string{"Dark Trap", "Lo-fi"}) {
		t.Fatalf("beats = %q, want only the two picked", got)
	}
	for _, back := range beats {
		if back.Title != "Dark Trap" {
			continue
		}
		if back.Producer != "Kai" || !reflect.DeepEqual(back.BPM, a.BPM) || back.Duration != a.Duration {
			t.Errorf("beat = %+v, want it as backed up, %+v", back, a)
		}
		expectBody(t, ts.Do(http.MethodGet, beatPath(back.ID)+"/audio", nil), string(audio))
	}
}

func TestRestoringPickedSongsBringsTheBeatsTheyUseBesideThePickedBeats(t *testing.T) {
	ts := newTestServer(t)
	used := ts.beatOfLength("Used", 20)
	picked := ts.beatOfLength("Picked", 20)
	ts.beatOfLength("Not Picked", 20)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	made := ts.backUp(map[string]any{"allSongs": true, "beatLibrary": true})
	expectStatus(t, ts.Do(http.MethodDelete, songPath(s.ID), nil), http.StatusNoContent)
	for _, b := range ts.listBeats() {
		expectStatus(t, ts.Do(http.MethodDelete, beatPath(b.ID), nil), http.StatusNoContent)
	}

	got := ts.restoreBody(made.ID, map[string]any{"songs": []int64{s.ID}, "beats": []int64{picked.ID}})

	if len(got.Songs) != 1 || got.Beats != 2 {
		t.Fatalf("restored = %+v, want Night Drive and 2 Beats", got)
	}
	if got := sorted(beatTitles(ts.listBeats())); !reflect.DeepEqual(got, []string{"Picked", "Used"}) {
		t.Errorf("beats = %q, want the one picked and the one the Song uses", got)
	}
	if tl := ts.getTimeline(got.Songs[0].ID); len(tl.Beats) != 1 || tl.Beats[0].Title != "Used" {
		t.Errorf("beats of the restored Song = %+v, want Used", tl.Beats)
	}
}

func TestChosenBeatsAlreadyInBandmateAreReplacedOrKeptBoth(t *testing.T) {
	ts := newTestServer(t)
	kept := ts.uploadBeat(fakeAudio("kept.mp3").with(map[string]any{"title": "Kept", "producer": "Kai"}))
	replaced := ts.uploadBeat(fakeAudio("replaced.mp3").with(map[string]any{"title": "Replaced", "producer": "Kai"}))
	notPicked := ts.uploadBeat(fakeAudio("not.mp3").with(map[string]any{"title": "Not Picked", "producer": "Kai"}))
	made := ts.backUp(map[string]any{"beats": []int64{kept.ID, replaced.ID, notPicked.ID}})
	for _, b := range []beat{kept, replaced, notPicked} {
		expectStatus(t, ts.Do(http.MethodPatch, beatPath(b.ID), map[string]any{"title": b.Title + " Again"}), http.StatusOK)
	}
	picks := map[string]any{"beats": []int64{kept.ID, replaced.ID}}

	songs, beats := ts.presentPicked(made.ID, picks)

	want := []presentItem{
		{kept.ID, "Kept", restoredSong{kept.ID, "Kept Again"}},
		{replaced.ID, "Replaced", restoredSong{replaced.ID, "Replaced Again"}},
	}
	if len(songs) != 0 || !reflect.DeepEqual(beats, want) {
		t.Errorf("already in Bandmate = %+v, %+v, want only the two Beats picked, %+v", songs, beats, want)
	}

	picks["replace"] = map[string]any{"beats": []int64{replaced.ID}}
	got := ts.restoreBody(made.ID, picks)

	if got.Beats != 2 {
		t.Errorf("restored = %+v, want 2 Beats", got)
	}
	if got := sorted(beatTitles(ts.listBeats())); !reflect.DeepEqual(got,
		[]string{"Kept (restored)", "Kept Again", "Not Picked Again", "Replaced"}) {
		t.Errorf("beats = %q, want Replaced replaced, Kept kept both, and Not Picked untouched", got)
	}
}

func TestARestoreMustPickBeatsTheBackupHolds(t *testing.T) {
	ts := newTestServer(t)
	held := ts.beatOfLength("Held", 20)
	notHeld := ts.beatOfLength("Not Held", 20)
	made := ts.backUp(map[string]any{"beats": []int64{held.ID}})

	for _, path := range []string{"/restore", "/present"} {
		expectError(t, ts.Do(http.MethodPost, backupPath(made.ID)+path, map[string]any{"beats": []int64{notHeld.ID}}),
			http.StatusBadRequest, "a Beat picked isn't in the Backup")
	}
	if got := sorted(beatTitles(ts.listBeats())); !reflect.DeepEqual(got, []string{"Held", "Not Held"}) {
		t.Errorf("beats = %q, want nothing restored", got)
	}
}
