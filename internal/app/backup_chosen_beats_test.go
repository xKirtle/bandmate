package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

func TestABackupOfChosenBeatsHoldsOnlyThoseBeats(t *testing.T) {
	ts := newTestServer(t)
	a := ts.uploadBeat(fakeAudio("a.mp3").with(map[string]any{"title": "Dark Trap", "producer": "Kai"}))
	b := ts.beatOfLength("Lo-fi", 20)
	ts.beatOfLength("Left Out", 20)
	ts.createSong("Night Drive")

	made := ts.backUp(map[string]any{"beats": []int64{a.ID, b.ID}})
	held := openBackup(t, ts.downloadBackup(made.ID).Body)

	if made.Songs != 0 || made.AllSongs || made.Beats != 2 || made.BeatLibrary {
		t.Errorf("backup = %+v, want the 2 Beats picked, not the Beat Library, and no Songs", made)
	}
	if got := held.listSongs(); len(got) != 0 {
		t.Errorf("songs in the backup = %q, want none", titles(got))
	}
	if got := sorted(beatTitles(held.listBeats())); !reflect.DeepEqual(got, []string{"Dark Trap", "Lo-fi"}) {
		t.Errorf("beats in the backup = %q, want only the two picked", got)
	}
	expectSame(t, ts, held, beatPath(a.ID))
	expectSame(t, ts, held, beatPath(a.ID)+"/audio")
	expectSame(t, ts, held, beatPath(b.ID)+"/audio")
}

func TestABackupOfChosenSongsAndChosenBeatsHoldsThemWithTheBeatsTheSongsUse(t *testing.T) {
	ts := newTestServer(t)
	used := ts.beatOfLength("Used", 20)
	picked := ts.beatOfLength("Picked", 20)
	ts.beatOfLength("Left Out", 20)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	other := ts.createSong("Midnight")
	timelineChange(t, ts.addBeatToSong(other.ID, picked.ID))

	made := ts.backUp(map[string]any{"songs": []int64{s.ID}, "beats": []int64{picked.ID, used.ID}})
	held := openBackup(t, ts.downloadBackup(made.ID).Body)

	if made.Songs != 1 || made.Beats != 2 || made.BeatLibrary {
		t.Errorf("backup = %+v, want 1 Song and 2 Beats, not the Beat Library", made)
	}
	if got := titles(held.listSongs()); !reflect.DeepEqual(got, []string{"Night Drive"}) {
		t.Errorf("songs in the backup = %q, want only the one picked", got)
	}
	if got := sorted(beatTitles(held.listBeats())); !reflect.DeepEqual(got, []string{"Picked", "Used"}) {
		t.Errorf("beats in the backup = %q, want the one picked and the one the Song uses", got)
	}
	expectSame(t, ts, held, timelinePath(s.ID))
	expectSame(t, ts, held, beatPath(used.ID)+"/audio")
	expectSame(t, ts, held, beatPath(picked.ID)+"/audio")
}

func TestABackupCountsTheBeatsItsSongsBring(t *testing.T) {
	ts := newTestServer(t)
	a, b := ts.beatOfLength("Dark Trap", 20), ts.beatOfLength("Lo-fi", 20)
	ts.beatOfLength("Unused", 20)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, a.ID))
	timelineChange(t, ts.addBeatToSong(s.ID, b.ID))
	ts.createSong("Midnight")

	songsOnly := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	library := ts.backUp(map[string]any{"songs": []int64{s.ID}, "beatLibrary": true})

	if songsOnly.Songs != 1 || songsOnly.Beats != 2 || songsOnly.BeatLibrary {
		t.Errorf("backup = %+v, want 1 Song bringing the 2 Beats it uses", songsOnly)
	}
	if library.Beats != 3 || !library.BeatLibrary {
		t.Errorf("backup = %+v, want the Beat Library's 3 Beats", library)
	}
	if got := ts.listBackups(); !reflect.DeepEqual(got, []backup{library, songsOnly}) {
		t.Errorf("backups = %+v, want both as made", got)
	}
}

func TestChosenBeatsMustExistAndNotBeTheBeatLibraryToo(t *testing.T) {
	ts := newTestServer(t)
	b := ts.beatOfLength("Dark Trap", 20)

	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"beats": []int64{}}),
		http.StatusBadRequest, "pick at least one Song or Beat")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"beats": []int64{b.ID, b.ID + 1}}),
		http.StatusBadRequest, "a Beat picked doesn't exist")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"beats": []int64{b.ID}, "beatLibrary": true}),
		http.StatusBadRequest, "pick the Beat Library or some Beats, not both")

	if list := ts.listBackups(); len(list) != 0 {
		t.Errorf("backups = %+v, want none made", list)
	}
}

func TestABackupOfChosenBeatsUploadedKeepsWhatItHolds(t *testing.T) {
	elsewhere := newTestServer(t)
	used := elsewhere.beatOfLength("Used", 20)
	picked := elsewhere.beatOfLength("Picked", 20)
	elsewhere.beatOfLength("Left Out", 20)
	s := elsewhere.createSong("Night Drive")
	timelineChange(t, elsewhere.addBeatToSong(s.ID, used.ID))
	made := elsewhere.backUp(map[string]any{"songs": []int64{s.ID}, "beats": []int64{picked.ID}})
	file := elsewhere.downloadBackup(made.ID).Body
	ts := newTestServer(t)

	res := ts.uploadBackup(file)

	expectStatus(t, res, http.StatusCreated)
	var up backup
	res.JSON(t, &up)
	if up.Songs != 1 || up.AllSongs || up.Beats != 2 || up.BeatLibrary {
		t.Errorf("uploaded = %+v, want its 1 Song and 2 Beats, not the Beat Library", up)
	}
	held := openBackup(t, ts.downloadBackup(up.ID).Body)
	if got := sorted(beatTitles(held.listBeats())); !reflect.DeepEqual(got, []string{"Picked", "Used"}) {
		t.Errorf("beats in the uploaded backup = %q, want the two it was made with", got)
	}
}
