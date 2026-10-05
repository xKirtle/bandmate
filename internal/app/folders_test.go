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

func TestSongCreatedInAnUnknownFolderIsRefused(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodPost, "/api/songs", map[string]any{"folderId": 7})

	expectError(t, res, http.StatusBadRequest, "there's no such Folder")
	if got := ts.listSongs(); len(got) != 0 {
		t.Errorf("songs = %v, want none", titles(got))
	}
}

// renameFolder gives a Folder a new name.
func (ts *testServer) renameFolder(id int64, name string) response {
	ts.t.Helper()
	return ts.Do(http.MethodPatch, folderPath(id), map[string]any{"name": name})
}

func TestFolderCanBeRenamed(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("EP")
	s := ts.createSong("Opener")
	expectStatus(t, ts.moveSong(s.ID, &ep.ID), http.StatusNoContent)

	res := ts.renameFolder(ep.ID, "  Summer EP  ")

	expectStatus(t, res, http.StatusOK)
	var renamed folder
	res.JSON(t, &renamed)
	if want := (folder{ID: ep.ID, Name: "Summer EP", Songs: 1}); renamed != want {
		t.Errorf("renamed folder = %+v, want %+v", renamed, want)
	}
	if got := folderSongs(ts.listFolders()); !reflect.DeepEqual(got, map[string]int{"Summer EP": 1}) {
		t.Errorf("songs per folder = %v, want Summer EP still holding its Song", got)
	}
}

func TestFolderCanBeRenamedToItsOwnNameInAnotherCase(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("summer ep")

	expectStatus(t, ts.renameFolder(ep.ID, "Summer EP"), http.StatusOK)

	if got := folderNames(ts.listFolders()); !reflect.DeepEqual(got, []string{"Summer EP"}) {
		t.Errorf("folders = %v, want [Summer EP]", got)
	}
}

func TestRenamingAFolderRefusesAnotherFoldersNameIgnoringCase(t *testing.T) {
	ts := newTestServer(t)
	ts.createFolder("Canção")
	demos := ts.createFolder("Demos")

	expectError(t, ts.renameFolder(demos.ID, "CANÇÃO"), http.StatusConflict, "there's already a Folder called “Canção”")
	expectError(t, ts.renameFolder(demos.ID, "  "), http.StatusBadRequest, "a Folder's name is required")
	expectStatus(t, ts.renameFolder(demos.ID+1, "Other"), http.StatusNotFound)

	if got := folderNames(ts.listFolders()); !reflect.DeepEqual(got, []string{"Canção", "Demos"}) {
		t.Errorf("folders = %v, want them as they were", got)
	}
}

func TestEmptyFolderCanBeDeleted(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")
	ts.createFolder("Demos")

	expectStatus(t, ts.Do(http.MethodDelete, folderPath(ep.ID), nil), http.StatusNoContent)

	if got := folderNames(ts.listFolders()); !reflect.DeepEqual(got, []string{"Demos"}) {
		t.Errorf("folders = %v, want [Demos]", got)
	}
	expectStatus(t, ts.Do(http.MethodGet, folderPath(ep.ID), nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodDelete, folderPath(ep.ID), nil), http.StatusNotFound)
}

func TestDeletedFolderKeepsItsSongsInNoFolder(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")
	opener := ts.updateSong(ts.createSong("Opener").ID, map[string]any{"status": "finished"})
	closer := ts.createSong("Closer")
	ts.createSong("Loose")
	expectStatus(t, ts.moveSong(opener.ID, &ep.ID), http.StatusNoContent)
	expectStatus(t, ts.moveSong(closer.ID, &ep.ID), http.StatusNoContent)

	expectStatus(t, ts.Do(http.MethodDelete, folderPath(ep.ID)+"?songs=keep", nil), http.StatusNoContent)

	if got := ts.listFolders(); len(got) != 0 {
		t.Errorf("folders = %v, want none", folderNames(got))
	}
	if got, want := titles(ts.listSongs("folder=none")), []string{"Loose", "Closer", "Opener"}; !reflect.DeepEqual(got, want) {
		t.Errorf("songs in no folder = %v, want %v", got, want)
	}
	if kept := ts.getSong(opener.ID); kept.Version != opener.Version || kept.UpdatedAt != opener.UpdatedAt {
		t.Errorf("kept Song at version %d edited %s; want %d and %s as before",
			kept.Version, kept.UpdatedAt, opener.Version, opener.UpdatedAt)
	}
}

func TestDeletedFolderCanDeleteItsSongsToo(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")
	ts.createFolder("Demos")
	gone := ts.songWithMasters()
	finished := ts.updateSong(ts.createSong("Done").ID, map[string]any{"status": "finished"})
	kept := ts.uploadMaster(ts.createSong("Kept").ID, fakeAudio("kept.wav"))
	expectStatus(t, ts.moveSong(gone.ID, &ep.ID), http.StatusNoContent)
	expectStatus(t, ts.moveSong(finished.ID, &ep.ID), http.StatusNoContent)

	expectStatus(t, ts.Do(http.MethodDelete, folderPath(ep.ID)+"?songs=delete", nil), http.StatusNoContent)

	if got := folderNames(ts.listFolders()); !reflect.DeepEqual(got, []string{"Demos"}) {
		t.Errorf("folders = %v, want [Demos]", got)
	}
	if got := titles(ts.listSongs()); !reflect.DeepEqual(got, []string{"Kept"}) {
		t.Errorf("songs = %v, want only the one in no Folder", got)
	}
	expectStatus(t, ts.Do(http.MethodGet, songPath(gone.ID), nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodGet, songPath(finished.ID), nil), http.StatusNotFound)
	if files := masterFiles(t, ts); !reflect.DeepEqual(files, []string{fmt.Sprint(kept.Masters[0].ID)}) {
		t.Errorf("master files on disk = %q, want only the kept Song's", files)
	}
}

// Asked to delete a Folder's Songs, counted as the user saw them, it deletes
// none if the Folder holds another number by then, e.g. one filed into it
// from another device.
func TestDeletingAFoldersSongsRefusesAnotherCount(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")
	for _, title := range []string{"Opener", "Closer"} {
		s := ts.createSong(title)
		expectStatus(t, ts.moveSong(s.ID, &ep.ID), http.StatusNoContent)
	}

	expectError(t, ts.Do(http.MethodDelete, folderPath(ep.ID)+"?songs=delete&count=1", nil),
		http.StatusConflict, "“Summer EP” now holds 2 Songs, not 1")
	expectError(t, ts.Do(http.MethodDelete, folderPath(ep.ID)+"?songs=delete&count=two", nil),
		http.StatusBadRequest, "count must be a whole number")

	if got := folderSongs(ts.listFolders()); !reflect.DeepEqual(got, map[string]int{"Summer EP": 2}) {
		t.Errorf("songs per folder = %v, want Summer EP still holding both", got)
	}

	expectStatus(t, ts.Do(http.MethodDelete, folderPath(ep.ID)+"?songs=delete&count=2", nil), http.StatusNoContent)
	if got := ts.listSongs(); len(got) != 0 {
		t.Errorf("songs = %v, want none", titles(got))
	}
}

func TestDeletingAFolderRefusesAnUnknownChoiceForItsSongs(t *testing.T) {
	ts := newTestServer(t)
	ep := ts.createFolder("Summer EP")

	expectError(t, ts.Do(http.MethodDelete, folderPath(ep.ID)+"?songs=archive", nil),
		http.StatusBadRequest, `songs must be "keep" or "delete"`)

	if got := len(ts.listFolders()); got != 1 {
		t.Errorf("folders = %d, want the one still there", got)
	}
}

// songsInFolders makes Songs spread across two Folders and none, for search
// and filters to look through: in Summer EP, "Night Drive" (drafting, with a
// Master) and "Daylight"; in Demos, "Night Sketch" (drafting); in none,
// "Night Owl" and "Loose" (drafting, with a Master).
func (ts *testServer) songsInFolders() (ep, demos folder) {
	ts.t.Helper()
	ep, demos = ts.createFolder("Summer EP"), ts.createFolder("Demos")
	file := func(title string, in *folder, drafting, mastered bool) {
		s := ts.createSong(title)
		if drafting {
			ts.updateSong(s.ID, map[string]any{"status": "drafting"})
		}
		if mastered {
			ts.uploadMaster(s.ID, fakeAudio(title+".wav"))
		}
		if in != nil {
			expectStatus(ts.t, ts.moveSong(s.ID, &in.ID), http.StatusNoContent)
		}
	}
	file("Night Drive", &ep, true, true)
	file("Daylight", &ep, false, false)
	file("Night Sketch", &demos, true, false)
	file("Night Owl", nil, false, false)
	file("Loose", nil, true, true)
	return ep, demos
}

// At the top level, a search or filter asks for every Song, whatever Folder
// it's in, and each says which Folder that is.
func TestSearchAndFiltersAtTheTopLevelLookInEveryFolder(t *testing.T) {
	ts := newTestServer(t)
	ep, demos := ts.songsInFolders()

	cases := map[string][]string{
		"q=night":                        {"Night Owl", "Night Sketch", "Night Drive"},
		"status=drafting":                {"Loose", "Night Sketch", "Night Drive"},
		"hasMaster=true":                 {"Loose", "Night Drive"},
		"q=night&status=drafting":        {"Night Sketch", "Night Drive"},
		"q=night&hasMaster=true":         {"Night Drive"},
		"q=nothing+like+it":              {},
		"status=finished&hasMaster=true": {},
	}
	for query, want := range cases {
		if got := titles(ts.listSongs(query)); !reflect.DeepEqual(got, want) {
			t.Errorf("song list for %q = %v, want %v", query, got, want)
		}
	}
	wantFolder := map[string]*int64{"Night Drive": &ep.ID, "Night Sketch": &demos.ID, "Night Owl": nil}
	for _, s := range ts.listSongs("q=night") {
		if !reflect.DeepEqual(s.FolderID, wantFolder[s.Title]) {
			t.Errorf("%s's folderId = %v, want %v", s.Title, s.FolderID, wantFolder[s.Title])
		}
	}
}

// Inside a Folder, or among the Songs in none, search and filters keep to
// those Songs.
func TestSearchAndFiltersInsideAFolderCoverOnlyIt(t *testing.T) {
	ts := newTestServer(t)
	ep, demos := ts.songsInFolders()
	inEP, inDemos := fmt.Sprintf("folder=%d", ep.ID), fmt.Sprintf("folder=%d", demos.ID)

	cases := map[string][]string{
		inEP + "&q=night":             {"Night Drive"},
		inEP + "&status=drafting":     {"Night Drive"},
		inEP + "&hasMaster=true":      {"Night Drive"},
		inEP + "&hasMaster=false":     {"Daylight"},
		inEP + "&q=sketch":            {},
		inDemos + "&q=night":          {"Night Sketch"},
		inDemos + "&hasMaster=true":   {},
		"folder=none&q=night":         {"Night Owl"},
		"folder=none&status=drafting": {"Loose"},
		"folder=none&q=drive":         {},
	}
	for query, want := range cases {
		if got := titles(ts.listSongs(query)); !reflect.DeepEqual(got, want) {
			t.Errorf("song list for %q = %v, want %v", query, got, want)
		}
	}
}
