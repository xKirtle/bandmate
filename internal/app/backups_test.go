package app_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"sync"
	"testing"
)

// backup is a Backup as the API lists it.
type backup struct {
	ID        int64  `json:"id"`
	CreatedAt string `json:"createdAt"`
	// Songs is how many Songs it holds.
	Songs int `json:"songs"`
	// AllSongs tells whether it holds every Song there was.
	AllSongs bool `json:"allSongs"`
	// Beats is how many Beats it holds, with those its Songs bring.
	Beats int `json:"beats"`
	// BeatLibrary tells whether it holds the whole Beat Library.
	BeatLibrary bool `json:"beatLibrary"`
	// Size is its file's size in bytes.
	Size int64 `json:"size"`
	// Name is the name of its own it's been given, "" for none.
	Name string `json:"name"`
}

func backupPath(id int64) string {
	return fmt.Sprintf("/api/backups/%d", id)
}

// listBackups reads the Backups, newest first.
func (ts *testServer) listBackups() []backup {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, "/api/backups", nil)
	expectStatus(ts.t, res, http.StatusOK)
	var list []backup
	res.JSON(ts.t, &list)
	return list
}

// backUp makes a Backup of what body picks, e.g. {"songs": [1, 2]} or
// {"allSongs": true}, and returns it.
func (ts *testServer) backUp(body map[string]any) backup {
	ts.t.Helper()
	res := ts.Do(http.MethodPost, "/api/backups", body)
	expectStatus(ts.t, res, http.StatusCreated)
	var b backup
	res.JSON(ts.t, &b)
	return b
}

// downloadBackup reads a Backup's file, as downloaded.
func (ts *testServer) downloadBackup(id int64) response {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, backupPath(id)+"/file", nil)
	expectStatus(ts.t, res, http.StatusOK)
	return res
}

func TestThereAreNoBackupsAtFirst(t *testing.T) {
	ts := newTestServer(t)

	if list := ts.listBackups(); len(list) != 0 {
		t.Errorf("backups = %+v, want none", list)
	}
}

func TestABackupOfChosenSongsIsListedWithItsSizeAndDownloadsAsOneFile(t *testing.T) {
	ts := newTestServer(t)
	a := ts.createSong("Night Drive")
	ts.createSong("Left Out")
	b := ts.createSong("Midnight")

	made := ts.backUp(map[string]any{"songs": []int64{a.ID, b.ID}})

	if made.Songs != 2 || made.Size <= 0 {
		t.Errorf("backup = %+v, want 2 Songs and a size", made)
	}
	parseTime(t, made.CreatedAt)
	if list := ts.listBackups(); len(list) != 1 || list[0] != made {
		t.Errorf("backups = %+v, want only %+v", list, made)
	}
	file := ts.downloadBackup(made.ID)
	if int64(len(file.Body)) != made.Size {
		t.Errorf("downloaded %d bytes, want the listed size, %d", len(file.Body), made.Size)
	}
	if got := file.Header.Get("Content-Disposition"); got == "" {
		t.Error("the file isn't offered to save")
	}
	if got := file.Header.Get("Content-Length"); got != strconv.FormatInt(made.Size, 10) {
		t.Errorf("Content-Length = %q, want %d", got, made.Size)
	}
}

// openBackup starts a Bandmate on a downloaded Backup's file, unpacked: a
// Backup is a Bandmate database with its files, laid out like a data
// directory, so what it holds can be read through the API.
func openBackup(t *testing.T, file []byte) *testServer {
	t.Helper()
	return startTestServer(t, openBackupDir(t, file))
}

// openBackupDir unpacks a downloaded Backup's file into a directory, laid
// out like a data directory, and returns it.
func openBackupDir(t *testing.T, file []byte) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(file), int64(len(file)))
	if err != nil {
		t.Fatalf("reading backup: %v", err)
	}
	dir := t.TempDir()
	for _, f := range zr.File {
		path := filepath.Join(dir, filepath.FromSlash(f.Name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		src, err := f.Open()
		if err != nil {
			t.Fatalf("reading %s from backup: %v", f.Name, err)
		}
		data, err := io.ReadAll(src)
		src.Close()
		if err != nil {
			t.Fatalf("reading %s from backup: %v", f.Name, err)
		}
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// expectSame fails the test unless both servers answer a GET of path alike.
func expectSame(t *testing.T, want, got *testServer, path string) {
	t.Helper()
	w, g := want.Do(http.MethodGet, path, nil), got.Do(http.MethodGet, path, nil)
	expectStatus(t, w, http.StatusOK)
	expectStatus(t, g, http.StatusOK)
	if !bytes.Equal(w.Body, g.Body) {
		t.Errorf("GET %s from the backup = %.300s, want %.300s", path, g.Body, w.Body)
	}
}

// fullSong is a Song with something in every part of it: Details and Status,
// a Lyric Sheet with Alternates and Cues, a Scrapbook, a Master, a Cover,
// and a Timeline with a mixed Track, a Loop, and Clips of a Beat, a Take and
// a Sound.
func (ts *testServer) fullSong(t *testing.T, beatID int64) song {
	t.Helper()
	s := ts.cuedChorusWithTwoAlternates()
	ts.updateSong(s.ID, map[string]any{
		"title": "Night Drive", "status": "drafting", "key": "Am", "bpm": 92, "capo": 2,
		"tuning": "Drop D", "notes": "Slow down the bridge",
	})
	scrap := ts.addToScrapbook(s.ID, "Ideas")
	ts.setText(s.ID, scrap.Sections[len(scrap.Sections)-1].Alternates[0].ID, "headlights [G]on")
	ts.uploadMaster(s.ID, fakeAudio("studio.wav").with(map[string]any{"name": "Studio"}))
	ts.addCover(s.ID, fakeCover())
	timelineChange(t, ts.addBeatToSong(s.ID, beatID))
	tl := timelineChange(t, ts.addTrack(s.ID, "Lead vox"))
	vox := tl.Tracks[1].ID
	timelineChange(t, ts.recordTake(s.ID, takeRecording(vox, 1, 1, 0.01, 3)))
	timelineChange(t, ts.importSound(s.ID, soundFile("hum.m4a", "Hum", vox, 2)))
	timelineChange(t, ts.updateTrack(s.ID, vox, map[string]any{"volume": -6, "muted": true}))
	timelineChange(t, ts.setLoop(s.ID, map[string]any{"start": 1, "end": 4, "on": true}))
	return ts.getSong(s.ID)
}

func TestABackedUpSongHoldsEverythingThatBelongsToIt(t *testing.T) {
	ts := newTestServer(t)
	used := ts.uploadBeat(fakeAudio("used.mp3").with(map[string]any{"title": "Used", "producer": "Kai"}))
	ts.uploadBeat(fakeAudio("unused.mp3").with(map[string]any{"title": "Unused"}))
	s := ts.fullSong(t, used.ID)
	other := ts.createSong("Left Out")

	made := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	held := openBackup(t, ts.downloadBackup(made.ID).Body)

	if got := titles(held.listSongs()); !reflect.DeepEqual(got, []string{"Night Drive"}) {
		t.Errorf("songs in the backup = %q, want only the one picked", got)
	}
	expectStatus(t, held.Do(http.MethodGet, songPath(other.ID), nil), http.StatusNotFound)
	expectSame(t, ts, held, songPath(s.ID))
	expectSame(t, ts, held, timelinePath(s.ID))
	if got := beatTitles(held.listBeats()); !reflect.DeepEqual(got, []string{"Used"}) {
		t.Errorf("beats in the backup = %q, want only the one its Clip uses", got)
	}
	expectSame(t, ts, held, beatPath(used.ID))
	expectSame(t, ts, held, beatPath(used.ID)+"/audio")
	for _, m := range s.Masters {
		expectSame(t, ts, held, masterPath(s.ID, m.ID)+"/audio")
	}
	for _, picture := range []string{"original", "list", "header"} {
		expectSame(t, ts, held, songPath(s.ID)+"/cover/"+picture)
	}
	clips := 0
	for _, c := range ts.getTimeline(s.ID).Tracks[1].Clips {
		clips++
		for _, tk := range c.Takes {
			expectSame(t, ts, held, takePath(s.ID, tk.ID)+"/audio")
		}
		if c.SoundID != nil {
			expectSame(t, ts, held, soundPath(s.ID, *c.SoundID)+"/audio")
		}
	}
	if clips != 2 {
		t.Errorf("Lead vox has %d Clips, want the Take's and the Sound's", clips)
	}
}

func TestEachSongIsCopiedWholeWhileItsEditedMeanwhile(t *testing.T) {
	ts := newTestServer(t)
	s, verse := ts.verseWithLines("line 0")
	path := fmt.Sprintf("/api/songs/%d/alternates/%d/text", s.ID, verse.ID)

	// Each edit changes the Song's Lines and its version together, so a copy
	// read partly before an edit and partly after holds a version with the
	// wrong Lines.
	var mu sync.Mutex
	linesAt := map[int64]string{s.Version: "line 0"}
	stop := make(chan struct{})
	edited := make(chan error, 1)
	go func() {
		client := ts.srv.Client()
		for i := 1; ; i++ {
			select {
			case <-stop:
				edited <- nil
				return
			default:
			}
			text := fmt.Sprintf("line %d", i)
			body, _ := json.Marshal(map[string]any{"text": text})
			req, _ := http.NewRequest(http.MethodPut, ts.srv.URL+path, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			res, err := client.Do(req)
			if err != nil {
				edited <- err
				return
			}
			var got song
			err = json.NewDecoder(res.Body).Decode(&got)
			res.Body.Close()
			if err != nil {
				edited <- err
				return
			}
			mu.Lock()
			linesAt[got.Version] = text
			mu.Unlock()
		}
	}()

	var held []song
	for range 5 {
		b := ts.backUp(map[string]any{"songs": []int64{s.ID}})
		held = append(held, openBackup(t, ts.downloadBackup(b.ID).Body).getSong(s.ID))
	}
	close(stop)
	if err := <-edited; err != nil {
		t.Fatalf("editing: %v", err)
	}

	for _, copied := range held {
		mu.Lock()
		want, ok := linesAt[copied.Version]
		mu.Unlock()
		got := lineTexts(copied.Sections[0].Alternates[0])
		if !ok || !reflect.DeepEqual(got, []string{want}) {
			t.Errorf("copy at version %d holds %q, want %q", copied.Version, got, want)
		}
	}
}

func TestABackupOfAllSongsHoldsEverySongAndEachBeatTheirClipsUseOnce(t *testing.T) {
	ts := newTestServer(t)
	shared := ts.beatOfLength("Shared", 20)
	ts.beatOfLength("Unused", 20)
	a, b := ts.createSong("Night Drive"), ts.createSong("Midnight")
	timelineChange(t, ts.addBeatToSong(a.ID, shared.ID))
	timelineChange(t, ts.addBeatToSong(b.ID, shared.ID))
	ts.createSong("Untouched")

	made := ts.backUp(map[string]any{"allSongs": true})
	held := openBackup(t, ts.downloadBackup(made.ID).Body)

	if made.Songs != 3 || !made.AllSongs || made.BeatLibrary {
		t.Errorf("backup = %+v, want all 3 Songs, without the Beat Library", made)
	}
	if got, want := titles(held.listSongs()), titles(ts.listSongs()); !reflect.DeepEqual(got, want) {
		t.Errorf("songs in the backup = %q, want every Song: %q", got, want)
	}
	if got := held.listBeats(); len(got) != 1 || got[0].Title != "Shared" || len(got[0].Songs) != 2 {
		t.Errorf("beats in the backup = %+v, want only the shared one, used by both Songs", got)
	}
	expectSame(t, ts, held, timelinePath(a.ID))
	expectSame(t, ts, held, timelinePath(b.ID))
	expectSame(t, ts, held, beatPath(shared.ID)+"/audio")
}

func TestBackupsAreListedNewestFirst(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	first := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	second := ts.backUp(map[string]any{"allSongs": true})

	if list := ts.listBackups(); !reflect.DeepEqual(list, []backup{second, first}) {
		t.Errorf("backups = %+v, want the second, then the first", list)
	}
}

func TestABackupMustPickSomethingThatExists(t *testing.T) {
	ts := newTestServer(t)
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"allSongs": true}),
		http.StatusBadRequest, "there are no Songs to back up")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"beatLibrary": true}),
		http.StatusBadRequest, "there's nothing to back up")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"allSongs": true, "beatLibrary": true}),
		http.StatusBadRequest, "there's nothing to back up")
	s := ts.createSong("Night Drive")

	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{}),
		http.StatusBadRequest, "pick at least one Song or Beat")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"songs": []int64{}}),
		http.StatusBadRequest, "pick at least one Song or Beat")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"songs": []int64{}, "beatLibrary": true}),
		http.StatusBadRequest, "there's nothing to back up")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"songs": []int64{s.ID, s.ID + 1}}),
		http.StatusBadRequest, "a Song picked doesn't exist")
	expectError(t, ts.Do(http.MethodPost, "/api/backups", map[string]any{"allSongs": true, "songs": []int64{s.ID}}),
		http.StatusBadRequest, "pick all Songs or some, not both")

	if list := ts.listBackups(); len(list) != 0 {
		t.Errorf("backups = %+v, want none made", list)
	}
	expectError(t, ts.Do(http.MethodGet, backupPath(1)+"/file", nil), http.StatusNotFound, "not found")
}

func TestABackupLeavesOutTakesAndSoundsKeptOnlyForUndo(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	s := r.song
	tl := timelineChange(t, ts.importSound(s.ID, soundFile("hum.m4a", "Hum", r.vox.ID, 2)))
	var soundClip clip
	for _, c := range tl.Tracks[1].Clips {
		if c.SoundID != nil {
			soundClip = c
		}
	}
	timelineChange(t, ts.deleteClip(s.ID, r.clip.ID))
	timelineChange(t, ts.deleteClip(s.ID, soundClip.ID))

	held := openBackup(t, ts.downloadBackup(ts.backUp(map[string]any{"songs": []int64{s.ID}}).ID).Body)

	expectSame(t, ts, held, timelinePath(s.ID))
	expectStatus(t, ts.Do(http.MethodGet, takePath(s.ID, r.take.ID), nil), http.StatusOK)
	expectStatus(t, held.Do(http.MethodGet, takePath(s.ID, r.take.ID), nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodGet, soundPath(s.ID, *soundClip.SoundID), nil), http.StatusOK)
	expectStatus(t, held.Do(http.MethodGet, soundPath(s.ID, *soundClip.SoundID), nil), http.StatusNotFound)
}

func TestABackupOfTheBeatLibraryHoldsEveryBeatAndNoSongs(t *testing.T) {
	ts := newTestServer(t)
	used := ts.beatOfLength("Used", 20)
	unused := ts.uploadBeat(fakeAudio("unused.mp3").with(map[string]any{"title": "Unused", "producer": "Kai"}))
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))

	made := ts.backUp(map[string]any{"beatLibrary": true})
	held := openBackup(t, ts.downloadBackup(made.ID).Body)

	if made.Songs != 0 || made.AllSongs || !made.BeatLibrary {
		t.Errorf("backup = %+v, want the Beat Library and no Songs", made)
	}
	if got := held.listSongs(); len(got) != 0 {
		t.Errorf("songs in the backup = %q, want none", titles(got))
	}
	if got := beatTitles(held.listBeats()); !reflect.DeepEqual(got, beatTitles(ts.listBeats())) {
		t.Errorf("beats in the backup = %q, want every Beat", got)
	}
	expectSame(t, ts, held, beatPath(unused.ID))
	expectSame(t, ts, held, beatPath(unused.ID)+"/audio")
	expectSame(t, ts, held, beatPath(used.ID)+"/audio")
}

func TestABackupOfEverythingHoldsEverySongAndEveryBeat(t *testing.T) {
	ts := newTestServer(t)
	used := ts.beatOfLength("Used", 20)
	unused := ts.beatOfLength("Unused", 20)
	s := ts.fullSong(t, used.ID)
	other := ts.createSong("Midnight")

	made := ts.backUp(map[string]any{"allSongs": true, "beatLibrary": true})
	held := openBackup(t, ts.downloadBackup(made.ID).Body)

	if made.Songs != 2 || !made.AllSongs || !made.BeatLibrary {
		t.Errorf("backup = %+v, want Everything: both Songs and the Beat Library", made)
	}
	if list := ts.listBackups(); len(list) != 1 || list[0] != made {
		t.Errorf("backups = %+v, want only %+v", list, made)
	}
	if got, want := titles(held.listSongs()), titles(ts.listSongs()); !reflect.DeepEqual(got, want) {
		t.Errorf("songs in the backup = %q, want every Song: %q", got, want)
	}
	expectSame(t, ts, held, "/api/beats")
	expectSame(t, ts, held, songPath(s.ID))
	expectSame(t, ts, held, timelinePath(s.ID))
	expectSame(t, ts, held, songPath(other.ID))
	expectSame(t, ts, held, beatPath(used.ID))
	expectSame(t, ts, held, beatPath(used.ID)+"/audio")
	expectSame(t, ts, held, beatPath(unused.ID)+"/audio")
}

func TestABackupOfChosenSongsCanHoldTheBeatLibraryToo(t *testing.T) {
	ts := newTestServer(t)
	used := ts.beatOfLength("Used", 20)
	unused := ts.beatOfLength("Unused", 20)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	left := ts.createSong("Left Out")
	timelineChange(t, ts.addBeatToSong(left.ID, used.ID))

	made := ts.backUp(map[string]any{"songs": []int64{s.ID}, "beatLibrary": true})
	held := openBackup(t, ts.downloadBackup(made.ID).Body)

	if made.Songs != 1 || made.AllSongs || !made.BeatLibrary {
		t.Errorf("backup = %+v, want 1 Song and the Beat Library", made)
	}
	if got := titles(held.listSongs()); !reflect.DeepEqual(got, []string{"Night Drive"}) {
		t.Errorf("songs in the backup = %q, want only the one picked", got)
	}
	if got := beatTitles(held.listBeats()); len(got) != 2 {
		t.Errorf("beats in the backup = %q, want both", got)
	}
	expectSame(t, ts, held, timelinePath(s.ID))
	expectSame(t, ts, held, beatPath(used.ID)+"/audio")
	expectSame(t, ts, held, beatPath(unused.ID)+"/audio")
}

// renameBackup gives a Backup a name of its own, or with "" clears it, and
// returns the Backup.
func (ts *testServer) renameBackup(id int64, name string) backup {
	ts.t.Helper()
	res := ts.Do(http.MethodPatch, backupPath(id), map[string]any{"name": name})
	expectStatus(ts.t, res, http.StatusOK)
	var b backup
	res.JSON(ts.t, &b)
	return b
}

func TestABackupHasNoNameOfItsOwnAtFirst(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Night Drive")

	if made := ts.backUp(map[string]any{"allSongs": true}); made.Name != "" {
		t.Errorf("name = %q, want none", made.Name)
	}
}

func TestABackupCanBeGivenANameOfItsOwnAndHaveItClearedBackToTheAutomaticOne(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Night Drive")
	made := ts.backUp(map[string]any{"allSongs": true})
	file := ts.downloadBackup(made.ID).Body

	named := ts.renameBackup(made.ID, "  Before the big rewrite ")

	want := made
	want.Name = "Before the big rewrite"
	if named != want {
		t.Errorf("renamed = %+v, want %+v", named, want)
	}
	if list := ts.listBackups(); len(list) != 1 || list[0] != want {
		t.Errorf("backups = %+v, want only %+v", list, want)
	}
	if renamed := ts.renameBackup(made.ID, "After the rewrite"); renamed.Name != "After the rewrite" {
		t.Errorf("renamed again = %q, want %q", renamed.Name, "After the rewrite")
	}
	if !bytes.Equal(ts.downloadBackup(made.ID).Body, file) {
		t.Error("renaming the Backup changed its file")
	}

	if cleared := ts.renameBackup(made.ID, "   "); cleared != made {
		t.Errorf("cleared = %+v, want %+v", cleared, made)
	}
	if list := ts.listBackups(); len(list) != 1 || list[0] != made {
		t.Errorf("backups = %+v, want only %+v", list, made)
	}
}

func TestRenamingABackupThatDoesntExistIsNotFound(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodPatch, backupPath(1), map[string]any{"name": "Before the big rewrite"})

	expectStatus(t, res, http.StatusNotFound)
}

func TestDeletingABackupRemovesItAndItsFile(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Night Drive")
	kept := ts.backUp(map[string]any{"allSongs": true})
	deleted := ts.backUp(map[string]any{"allSongs": true})

	res := ts.Do(http.MethodDelete, backupPath(deleted.ID), nil)

	expectStatus(t, res, http.StatusNoContent)
	if list := ts.listBackups(); len(list) != 1 || list[0] != kept {
		t.Errorf("backups = %+v, want only %+v", list, kept)
	}
	expectStatus(t, ts.Do(http.MethodGet, backupPath(deleted.ID)+"/file", nil), http.StatusNotFound)
	entries, err := os.ReadDir(filepath.Join(ts.DataDir, "backups"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != strconv.FormatInt(kept.ID, 10) {
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("backups directory holds %v, want only the kept Backup's file", names)
	}
	ts.downloadBackup(kept.ID)

	expectStatus(t, ts.Do(http.MethodDelete, backupPath(deleted.ID), nil), http.StatusNotFound)
}

func TestBackupsAreKeptWhenBandmateRestarts(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Night Drive")
	made := ts.renameBackup(ts.backUp(map[string]any{"allSongs": true}).ID, "Before the big rewrite")

	restarted := startTestServer(t, ts.DataDir)

	if list := restarted.listBackups(); len(list) != 1 || list[0] != made {
		t.Errorf("backups after restarting = %+v, want only %+v", list, made)
	}
	restarted.downloadBackup(made.ID)
}
