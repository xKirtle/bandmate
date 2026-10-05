package app_test

import (
	"context"
	"net/http"
	"reflect"
	"testing"

	"github.com/xKirtle/bandmate/internal/db"
)

// songFolders maps each Song's title to the name of the Folder it sits in,
// or "" for none.
func (ts *testServer) songFolders() map[string]string {
	ts.t.Helper()
	names := map[int64]string{}
	for _, f := range ts.listFolders() {
		names[f.ID] = f.Name
	}
	in := map[string]string{}
	for _, s := range ts.listSongs() {
		in[s.Title] = ""
		if s.FolderID != nil {
			in[s.Title] = names[*s.FolderID]
		}
	}
	return in
}

// putInFolder moves a Song into a Folder.
func (ts *testServer) putInFolder(songID int64, f folder) {
	ts.t.Helper()
	expectStatus(ts.t, ts.moveSong(songID, &f.ID), http.StatusNoContent)
}

// uploadFrom uploads a Backup made on another install, and returns it.
func (ts *testServer) uploadFrom(elsewhere *testServer, made backup) backup {
	ts.t.Helper()
	res := ts.uploadBackup(elsewhere.downloadBackup(made.ID).Body)
	expectStatus(ts.t, res, http.StatusCreated)
	var up backup
	res.JSON(ts.t, &up)
	return up
}

func TestARestoredSongComesBackInItsFolderMadeOnAnInstallWithout(t *testing.T) {
	elsewhere := newTestServer(t)
	ep := elsewhere.createFolder("Summer EP")
	opener := elsewhere.createSong("Opener")
	closer := elsewhere.createSong("Closer")
	loose := elsewhere.createSong("Loose")
	elsewhere.putInFolder(opener.ID, ep)
	elsewhere.putInFolder(closer.ID, ep)
	made := elsewhere.backUp(map[string]any{"allSongs": true})
	ts := newTestServer(t)
	up := ts.uploadFrom(elsewhere, made)

	ts.restore(up.ID, opener.ID, closer.ID, loose.ID)

	want := map[string]string{"Opener": "Summer EP", "Closer": "Summer EP", "Loose": ""}
	if got := ts.songFolders(); !reflect.DeepEqual(got, want) {
		t.Errorf("songs' folders = %v, want %v", got, want)
	}
	if got := folderSongs(ts.listFolders()); !reflect.DeepEqual(got, map[string]int{"Summer EP": 2}) {
		t.Errorf("songs per folder = %v, want Summer EP made once, holding both", got)
	}
}

// songsMovedSinceBackedUp backs up Opener, in Summer EP, and Loose, in no
// Folder, then moves both into Demos and deletes Summer EP, returning the
// Backup and the Songs.
func (ts *testServer) songsMovedSinceBackedUp() (made backup, opener, loose song) {
	ts.t.Helper()
	ep := ts.createFolder("Summer EP")
	demos := ts.createFolder("Demos")
	opener = ts.createSong("Opener")
	loose = ts.createSong("Loose")
	ts.putInFolder(opener.ID, ep)
	made = ts.backUp(map[string]any{"songs": []int64{opener.ID, loose.ID}})
	ts.putInFolder(opener.ID, demos)
	ts.putInFolder(loose.ID, demos)
	expectStatus(ts.t, ts.Do(http.MethodDelete, folderPath(ep.ID), nil), http.StatusNoContent)
	return made, opener, loose
}

func TestASongKeptBothGoesIntoTheBackupsFolder(t *testing.T) {
	ts := newTestServer(t)
	made, opener, loose := ts.songsMovedSinceBackedUp()

	ts.restore(made.ID, opener.ID, loose.ID)

	want := map[string]string{
		"Opener": "Demos", "Loose": "Demos",
		"Opener (restored)": "Summer EP", "Loose (restored)": "",
	}
	if got := ts.songFolders(); !reflect.DeepEqual(got, want) {
		t.Errorf("songs' folders = %v, want %v", got, want)
	}
}

func TestASongReplacedGoesIntoTheBackupsFolder(t *testing.T) {
	ts := newTestServer(t)
	made, opener, loose := ts.songsMovedSinceBackedUp()

	ts.restoreReplacing(made.ID, []int64{opener.ID, loose.ID}, []int64{opener.ID, loose.ID}, nil)

	want := map[string]string{"Opener": "Summer EP", "Loose": ""}
	if got := ts.songFolders(); !reflect.DeepEqual(got, want) {
		t.Errorf("songs' folders = %v, want %v", got, want)
	}
	if got := folderSongs(ts.listFolders()); !reflect.DeepEqual(got, map[string]int{"Demos": 0, "Summer EP": 1}) {
		t.Errorf("songs per folder = %v, want Demos left empty", got)
	}
}

func TestABackupMadeBeforeFoldersRestoresItsSongsInNoFolder(t *testing.T) {
	dir := t.TempDir()
	old, err := db.OpenBefore(context.Background(), dir, "0036_folders")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Exec(`INSERT INTO songs (id, title, status, version, created_at, updated_at)
		VALUES (4, 'Night Drive', 'drafting', 1, '2025-01-02T03:04:05.000000000Z', '2025-01-02T03:04:05.000000000Z')`); err != nil {
		t.Fatal(err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	ts := newTestServer(t)
	ts.createFolder("Summer EP")
	made := ts.backUp(map[string]any{"songs": []int64{ts.createSong("Placeholder").ID}})
	ts.replaceBackupFile(made.ID, packBackup(t, dir))

	restored := ts.restore(made.ID, 4)

	if len(restored) != 1 || restored[0].Title != "Night Drive" {
		t.Fatalf("restored = %+v, want Night Drive", restored)
	}
	if got := ts.songFolders(); got["Night Drive"] != "" {
		t.Errorf("Night Drive is in %q, want no Folder", got["Night Drive"])
	}
	if got := folderSongs(ts.listFolders()); !reflect.DeepEqual(got, map[string]int{"Summer EP": 0}) {
		t.Errorf("songs per folder = %v, want only ours, still empty", got)
	}
}

func TestARestoredSongGoesIntoTheFolderOfTheSameNameIgnoringCase(t *testing.T) {
	elsewhere := newTestServer(t)
	theirs := elsewhere.createFolder("CANÇÃO")
	s := elsewhere.createSong("Opener")
	elsewhere.putInFolder(s.ID, theirs)
	made := elsewhere.backUp(map[string]any{"songs": []int64{s.ID}})
	ts := newTestServer(t)
	ours := ts.createFolder("Canção")
	ts.putInFolder(ts.createSong("Closer").ID, ours)
	up := ts.uploadFrom(elsewhere, made)

	ts.restore(up.ID, s.ID)

	if got := ts.listFolders(); !reflect.DeepEqual(got, []folder{{ID: ours.ID, Name: "Canção", Songs: 2}}) {
		t.Errorf("folders = %+v, want ours alone, as named here, holding both Songs", got)
	}
}
