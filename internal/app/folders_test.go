package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// folder is a Folder as the API returns it.
type folder struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Songs int    `json:"songs"`
}

func folderPath(id int64) string {
	return fmt.Sprintf("/api/folders/%d", id)
}

// createFolder makes a Folder with the given name and returns it.
func (ts *testServer) createFolder(name string) folder {
	ts.t.Helper()
	res := ts.Do(http.MethodPost, "/api/folders", map[string]any{"name": name})
	expectStatus(ts.t, res, http.StatusCreated)
	var f folder
	res.JSON(ts.t, &f)
	return f
}

// listFolders reads every Folder.
func (ts *testServer) listFolders() []folder {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, "/api/folders", nil)
	expectStatus(ts.t, res, http.StatusOK)
	var list []folder
	res.JSON(ts.t, &list)
	return list
}

// moveSong puts a Song into a Folder, or, with nil, into none.
func (ts *testServer) moveSong(songID int64, folderID *int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPut, songPath(songID)+"/folder", map[string]any{"folderId": folderID})
}

func folderNames(list []folder) []string {
	names := []string{}
	for _, f := range list {
		names = append(names, f.Name)
	}
	return names
}

func TestMadeFolderIsListedByName(t *testing.T) {
	ts := newTestServer(t)

	made := ts.createFolder("  Summer EP  ")
	ts.createFolder("demos")
	ts.createFolder("Ballads")

	if made.Name != "Summer EP" || made.Songs != 0 {
		t.Errorf("made folder = %+v, want Summer EP, trimmed, holding no Songs", made)
	}
	if got, want := folderNames(ts.listFolders()), []string{"Ballads", "demos", "Summer EP"}; !reflect.DeepEqual(got, want) {
		t.Errorf("folders = %v, want %v, by name ignoring case", got, want)
	}
}

func TestFolderNamesAreUniqueIgnoringCase(t *testing.T) {
	ts := newTestServer(t)
	ts.createFolder("Canção")

	res := ts.Do(http.MethodPost, "/api/folders", map[string]any{"name": "CANÇÃO"})

	expectError(t, res, http.StatusConflict, "there's already a Folder called “Canção”")
	if got := len(ts.listFolders()); got != 1 {
		t.Errorf("folders = %d, want 1", got)
	}
}

func TestFolderNeedsAName(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodPost, "/api/folders", map[string]any{"name": "   "})

	expectError(t, res, http.StatusBadRequest, "a Folder's name is required")
}

func TestFolderCanBeReadByID(t *testing.T) {
	ts := newTestServer(t)
	made := ts.createFolder("Summer EP")

	res := ts.Do(http.MethodGet, folderPath(made.ID), nil)
	expectStatus(t, res, http.StatusOK)
	var got folder
	res.JSON(t, &got)
	if got != made {
		t.Errorf("folder = %+v, want %+v", got, made)
	}

	expectStatus(t, ts.Do(http.MethodGet, folderPath(made.ID+1), nil), http.StatusNotFound)
}

func TestSongsCanBeListedByFolder(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")
	demos := ts.createFolder("Demos")
	opener := ts.createSong("Opener")
	closer := ts.createSong("Closer")
	ts.createSong("Loose")
	sketch := ts.createSong("Sketch")
	expectStatus(t, ts.moveSong(opener.ID, &ep.ID), http.StatusNoContent)
	expectStatus(t, ts.moveSong(closer.ID, &ep.ID), http.StatusNoContent)
	expectStatus(t, ts.moveSong(sketch.ID, &demos.ID), http.StatusNoContent)

	cases := map[string][]string{
		fmt.Sprintf("folder=%d", ep.ID):    {"Closer", "Opener"},
		fmt.Sprintf("folder=%d", demos.ID): {"Sketch"},
		"folder=none":                      {"Loose"},
		"":                                 {"Sketch", "Loose", "Closer", "Opener"},
	}
	for query, want := range cases {
		if got := titles(ts.listSongs(query)); !reflect.DeepEqual(got, want) {
			t.Errorf("song list for %q = %v, want %v", query, got, want)
		}
	}
	for _, s := range ts.listSongs() {
		var want *int64
		switch s.ID {
		case opener.ID, closer.ID:
			want = &ep.ID
		case sketch.ID:
			want = &demos.ID
		}
		if !reflect.DeepEqual(s.FolderID, want) {
			t.Errorf("%s's folderId = %v, want %v", s.Title, s.FolderID, want)
		}
	}
	if got := folderSongs(ts.listFolders()); !reflect.DeepEqual(got, map[string]int{"Demos": 1, "Summer EP": 2}) {
		t.Errorf("songs per folder = %v", got)
	}
}

func folderSongs(list []folder) map[string]int {
	counts := map[string]int{}
	for _, f := range list {
		counts[f.Name] = f.Songs
	}
	return counts
}

func TestSongListRejectsAnUnknownFolder(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")

	expectStatus(t, ts.Do(http.MethodGet, "/api/songs?folder=ep", nil), http.StatusBadRequest)
	expectStatus(t, ts.Do(http.MethodGet, fmt.Sprintf("/api/songs?folder=%d", ep.ID+1), nil), http.StatusNotFound)
}

func TestSongCanBeMovedOutOfItsFolder(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")
	s := ts.createSong("Opener")
	expectStatus(t, ts.moveSong(s.ID, &ep.ID), http.StatusNoContent)

	expectStatus(t, ts.moveSong(s.ID, nil), http.StatusNoContent)

	if got := titles(ts.listSongs("folder=none")); !reflect.DeepEqual(got, []string{"Opener"}) {
		t.Errorf("songs in no folder = %v, want [Opener]", got)
	}
	if got := ts.listSongs(fmt.Sprintf("folder=%d", ep.ID)); len(got) != 0 {
		t.Errorf("songs in the folder = %v, want none", titles(got))
	}
}

func TestMovingASongLeavesItUnedited(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")
	s := ts.updateSong(ts.createSong("Done").ID, map[string]any{"status": "finished"})

	expectStatus(t, ts.moveSong(s.ID, &ep.ID), http.StatusNoContent)

	moved := ts.getSong(s.ID)
	if moved.Version != s.Version || moved.UpdatedAt != s.UpdatedAt {
		t.Errorf("after moving, version %d edited %s; want %d and %s as before",
			moved.Version, moved.UpdatedAt, s.Version, s.UpdatedAt)
	}
	if got := titles(ts.listSongs(fmt.Sprintf("folder=%d", ep.ID))); !reflect.DeepEqual(got, []string{"Done"}) {
		t.Errorf("songs in the folder = %v, want the Finished Song", got)
	}
}

func TestMovingASongRefusesAnUnknownFolderOrSong(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")
	s := ts.createSong("Opener")
	missing := ep.ID + 1

	expectError(t, ts.moveSong(s.ID, &missing), http.StatusBadRequest, "there's no such Folder")
	expectStatus(t, ts.moveSong(s.ID+1, &ep.ID), http.StatusNotFound)
}

func TestSongCreatedInAFolderLandsInIt(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")

	res := ts.Do(http.MethodPost, "/api/songs", map[string]any{"folderId": ep.ID})
	expectStatus(t, res, http.StatusCreated)
	res = ts.Do(http.MethodPost, "/api/songs/import", map[string]any{
		"title": "Pasted", "text": "[Verse]\nLa la la", "folderId": ep.ID,
	})
	expectStatus(t, res, http.StatusCreated)

	got := titles(ts.listSongs(fmt.Sprintf("folder=%d", ep.ID)))
	if want := []string{"Pasted", "Untitled Song"}; !reflect.DeepEqual(got, want) {
		t.Errorf("songs in the folder = %v, want %v", got, want)
	}
}

// Until Backups carry Folders, they leave them out, so a Song in a Folder
// can still be backed up, and comes back in none.
func TestABackupLeavesFoldersOut(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")
	s := ts.createSong("Opener")
	expectStatus(t, ts.moveSong(s.ID, &ep.ID), http.StatusNoContent)

	made := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	restored := ts.restore(made.ID, s.ID)

	if len(restored) != 1 {
		t.Fatalf("restored = %+v, want the one Song", restored)
	}
	if got := titles(ts.listSongs("folder=none")); !reflect.DeepEqual(got, []string{restored[0].Title}) {
		t.Errorf("songs in no folder = %v, want the restored Song", got)
	}
	if got := folderSongs(ts.listFolders()); !reflect.DeepEqual(got, map[string]int{"Summer EP": 1}) {
		t.Errorf("songs per folder = %v, want Summer EP holding only the Song backed up", got)
	}
}

func TestSongCreatedInAnUnknownFolderIsRefused(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodPost, "/api/songs", map[string]any{"folderId": 7})

	expectError(t, res, http.StatusBadRequest, "there's no such Folder")
	if got := ts.listSongs(); len(got) != 0 {
		t.Errorf("songs = %v, want none", titles(got))
	}
}
