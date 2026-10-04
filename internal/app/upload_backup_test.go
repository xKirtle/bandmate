package app_test

import (
	"archive/zip"
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"testing"

	"github.com/xKirtle/bandmate/internal/db"
)

// uploadBackup sends a Backup's file, as the SPA does.
func (ts *testServer) uploadBackup(file []byte) response {
	ts.t.Helper()
	return ts.DoRaw(http.MethodPost, "/api/backups/upload",
		http.Header{"Content-Type": {"application/octet-stream"}}, bytes.NewReader(file))
}

// backupFiles lists the files in the backups directory, sorted.
func backupFiles(t *testing.T, ts *testServer) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(ts.DataDir, "backups"))
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names
}

func TestAnUploadedBackupJoinsTheListWithItsNameAndSize(t *testing.T) {
	elsewhere := newTestServer(t)
	a := elsewhere.createSong("Night Drive")
	elsewhere.createSong("Left Out")
	b := elsewhere.createSong("Midnight")
	theirs := elsewhere.renameBackup(elsewhere.backUp(map[string]any{"songs": []int64{a.ID, b.ID}}).ID, "Theirs")
	file := elsewhere.downloadBackup(theirs.ID).Body
	ts := newTestServer(t)
	ts.createSong("Ours")
	ours := ts.backUp(map[string]any{"allSongs": true})

	res := ts.uploadBackup(file)

	expectStatus(t, res, http.StatusCreated)
	var up backup
	res.JSON(t, &up)
	// It's named as it was made: when, and what it holds. A name of its own
	// stays with the install it was given on.
	want := backup{ID: up.ID, CreatedAt: theirs.CreatedAt, Songs: 2, Size: int64(len(file))}
	if up != want || up.ID == ours.ID {
		t.Errorf("uploaded = %+v, want %+v", up, want)
	}
	list := ts.listBackups()
	if len(list) != 2 || !slices.Contains(list, up) || !slices.Contains(list, ours) {
		t.Errorf("backups = %+v, want ours and the one uploaded", list)
	}
	if got := ts.downloadBackup(up.ID).Body; !bytes.Equal(got, file) {
		t.Error("the uploaded Backup doesn't download as the file uploaded")
	}
	if got := restoredTitles(ts.backupSongs(up.ID)); !reflect.DeepEqual(got, []string{"Midnight", "Night Drive"}) {
		t.Errorf("songs in the uploaded backup = %q, want the two backed up", got)
	}
	// Kept like one made here.
	restarted := startTestServer(t, ts.DataDir)
	if got := restarted.listBackups(); !reflect.DeepEqual(got, list) {
		t.Errorf("backups after restarting = %+v, want %+v", got, list)
	}
}

func TestABackupOfEverythingUploadedKeepsWhatItHolds(t *testing.T) {
	elsewhere := newTestServer(t)
	elsewhere.beatOfLength("Unused", 20)
	elsewhere.createSong("Night Drive")
	made := elsewhere.backUp(map[string]any{"allSongs": true, "beatLibrary": true})
	ts := newTestServer(t)

	res := ts.uploadBackup(elsewhere.downloadBackup(made.ID).Body)

	expectStatus(t, res, http.StatusCreated)
	var up backup
	res.JSON(t, &up)
	if up.Songs != 1 || !up.AllSongs || !up.BeatLibrary {
		t.Errorf("uploaded = %+v, want Everything, with its one Song", up)
	}
}

func TestABackupUploadedFromAnotherInstallRestoresItsSongsAsNewSongs(t *testing.T) {
	elsewhere := newTestServer(t)
	used := elsewhere.uploadBeat(fakeAudio("used.mp3").with(map[string]any{"title": "Used", "producer": "Kai"}))
	s := elsewhere.fullSong(t, used.ID)
	want := elsewhere.readSongCopy(s.ID)
	file := elsewhere.downloadBackup(elsewhere.backUp(map[string]any{"songs": []int64{s.ID}}).ID).Body
	ts := newTestServer(t)
	ours := ts.createSong("Night Drive")
	ts.beatOfLength("Used", 20)
	res := ts.uploadBackup(file)
	expectStatus(t, res, http.StatusCreated)
	var up backup
	res.JSON(t, &up)

	songs, beats := ts.present(up.ID, s.ID)
	restored := ts.restore(up.ID, s.ID)

	if len(songs) != 0 || len(beats) != 0 {
		t.Errorf("already in Bandmate = %+v, %+v, want nothing: they're from another install", songs, beats)
	}
	if len(restored) != 1 || restored[0].Title != "Night Drive" || restored[0].ID == ours.ID {
		t.Fatalf("restored = %+v, want Night Drive, as a new Song", restored)
	}
	expectSameSong(t, want, ts.readSongCopy(restored[0].ID))
	if got := sorted(titles(ts.listSongs())); !reflect.DeepEqual(got, []string{"Night Drive", "Night Drive"}) {
		t.Errorf("songs = %q, want ours and the one restored", got)
	}
	if got := beatTitles(ts.listBeats()); len(got) != 2 {
		t.Errorf("beats = %q, want ours and the one restored", got)
	}
}

func TestABackupFromAnOlderBandmateUploadsAndRestores(t *testing.T) {
	dir := olderBackupDir(t)
	writeFile(t, filepath.Join(dir, "backup.json"), []byte(
		`{"createdAt":"2025-01-02T03:04:05Z","songs":1,"allSongs":true,"beats":1,"beatLibrary":false}`))
	ts := newTestServer(t)

	res := ts.uploadBackup(packBackup(t, dir))

	expectStatus(t, res, http.StatusCreated)
	var up backup
	res.JSON(t, &up)
	if up.Songs != 1 || !up.AllSongs || up.BeatLibrary || up.CreatedAt != "2025-01-02T03:04:05Z" {
		t.Errorf("uploaded = %+v, want all of its 1 Song, made when it says", up)
	}
	restored := ts.restore(up.ID, 4)
	if len(restored) != 1 || restored[0].Title != "Night Drive" {
		t.Fatalf("restored = %+v, want Night Drive", restored)
	}
	tl := ts.getTimeline(restored[0].ID)
	if len(tl.Beats) != 1 || tl.Beats[0].Title != "Dark Trap" {
		t.Errorf("beats = %+v, want Dark Trap", tl.Beats)
	}
	expectBody(t, ts.Do(http.MethodGet, beatPath(tl.Beats[0].ID)+"/audio", nil), "dark trap")
}

// expectRefused fails the test unless uploading file is refused with msg,
// leaving the install as it was.
func expectRefused(t *testing.T, ts *testServer, file []byte, msg string) {
	t.Helper()
	backupsBefore, filesBefore := ts.listBackups(), backupFiles(t, ts)
	songsBefore, beatsBefore := titles(ts.listSongs()), beatTitles(ts.listBeats())

	expectError(t, ts.uploadBackup(file), http.StatusBadRequest, msg)

	if got := ts.listBackups(); !reflect.DeepEqual(got, backupsBefore) {
		t.Errorf("backups = %+v, want them as they were, %+v", got, backupsBefore)
	}
	if got := backupFiles(t, ts); !reflect.DeepEqual(got, filesBefore) {
		t.Errorf("backups directory holds %q, want %q", got, filesBefore)
	}
	if got := titles(ts.listSongs()); !reflect.DeepEqual(got, songsBefore) {
		t.Errorf("songs = %q, want them as they were, %q", got, songsBefore)
	}
	if got := beatTitles(ts.listBeats()); !reflect.DeepEqual(got, beatsBefore) {
		t.Errorf("beats = %q, want them as they were, %q", got, beatsBefore)
	}
}

// zipOf packs files, by name, as a zip.
func zipOf(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// installWithABackup is an install holding a Song and a Backup of it, with
// the Backup's file unpacked in a directory to change it.
func installWithABackup(t *testing.T) (ts *testServer, held string) {
	t.Helper()
	ts = newTestServer(t)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, ts.beatOfLength("Used", 20).ID))
	made := ts.backUp(map[string]any{"allSongs": true})
	return ts, openBackupDir(t, ts.downloadBackup(made.ID).Body)
}

const (
	notABackupMsg = "the file isn't a Bandmate Backup"
	damagedMsg    = "the Backup is damaged"
	newerMsg      = "the Backup was made by a newer Bandmate: update Bandmate to restore it"
)

func TestAFileThatIsntABackupIsRefused(t *testing.T) {
	ts, held := installWithABackup(t)
	database, err := os.ReadFile(filepath.Join(held, db.FileName))
	if err != nil {
		t.Fatal(err)
	}

	for name, file := range map[string][]byte{
		"nothing":            {},
		"not a zip":          []byte("ID3 an mp3, picked by mistake"),
		"a zip of something": zipOf(t, map[string][]byte{"notes.txt": []byte("hello")}),
		"a database alone":   database,
	} {
		t.Run(name, func(t *testing.T) {
			expectRefused(t, ts, file, notABackupMsg)
		})
	}
}

func TestADamagedBackupIsRefused(t *testing.T) {
	ts, held := installWithABackup(t)
	whole := packBackup(t, held)
	damagedCopy := func(change func(dir string)) []byte {
		t.Helper()
		dir := openBackupDir(t, whole)
		change(dir)
		return packBackup(t, dir)
	}
	for name, file := range map[string][]byte{
		"cut short": whole[:len(whole)/2],
		"changed":   changedInPlace(t, held),
		"it holds no database": damagedCopy(func(dir string) {
			if err := os.Remove(filepath.Join(dir, db.FileName)); err != nil {
				t.Fatal(err)
			}
		}),
		"its database isn't one": damagedCopy(func(dir string) {
			writeFile(t, filepath.Join(dir, db.FileName), []byte("not a database"))
		}),
		"its database is cut short": damagedCopy(func(dir string) {
			data, err := os.ReadFile(filepath.Join(dir, db.FileName))
			if err != nil {
				t.Fatal(err)
			}
			writeFile(t, filepath.Join(dir, db.FileName), data[:len(data)/2])
		}),
		"its rows break the database's rules": damagedCopy(func(dir string) {
			damage(t, dir, `UPDATE songs SET status = 'lost'`)
		}),
		"a Beat's audio is missing": damagedCopy(func(dir string) {
			if err := os.RemoveAll(filepath.Join(dir, "audio")); err != nil {
				t.Fatal(err)
			}
		}),
		"its description isn't readable": damagedCopy(func(dir string) {
			writeFile(t, filepath.Join(dir, "backup.json"), []byte("{"))
		}),
	} {
		t.Run(name, func(t *testing.T) {
			expectRefused(t, ts, file, damagedMsg)
		})
	}
}

// changedInPlace is the Backup's file of held, packed uncompressed, with a
// byte of its database changed, so the entry no longer matches its
// checksum.
func changedInPlace(t *testing.T, held string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	entries, err := os.ReadDir(held)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(held, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		w, err := zw.CreateHeader(&zip.FileHeader{Name: e.Name(), Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	stored := buf.Bytes()
	if i := bytes.Index(stored, []byte("CREATE TABLE")); i >= 0 {
		stored[i] = 'X'
	} else {
		t.Fatal("no schema to change in the backup")
	}
	return stored
}

func writeFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// fromANewerBandmate is a Backup's file of held as a newer Bandmate would
// make it, recording a migration this one doesn't know.
func fromANewerBandmate(t *testing.T, held string) []byte {
	t.Helper()
	// Not damage, but the same way of changing the Backup's database.
	damage(t, held, `INSERT INTO schema_migrations (name) VALUES ('9999_from_the_future')`)
	return packBackup(t, held)
}

func TestABackupFromANewerBandmateIsRefused(t *testing.T) {
	ts, held := installWithABackup(t)

	expectRefused(t, ts, fromANewerBandmate(t, held), newerMsg)
}

func TestABackupFromANewerBandmateIsntRestored(t *testing.T) {
	// Kept from before rolling back to an older Bandmate.
	ts, held := installWithABackup(t)
	made := ts.listBackups()[0]
	ts.replaceBackupFile(made.ID, fromANewerBandmate(t, held))
	s := ts.listSongs()[0]

	expectError(t, ts.Do(http.MethodGet, backupPath(made.ID)+"/songs", nil), http.StatusBadRequest, newerMsg)
	expectError(t, ts.Do(http.MethodPost, backupPath(made.ID)+"/restore", map[string]any{"songs": []int64{s.ID}}),
		http.StatusBadRequest, newerMsg)
	if got := titles(ts.listSongs()); !reflect.DeepEqual(got, []string{"Night Drive"}) {
		t.Errorf("songs = %q, want nothing restored", got)
	}
}
