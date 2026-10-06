package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

func TestSongListIsSortedByMostRecentlyEdited(t *testing.T) {
	ts := newTestServer(t)
	oldest := ts.createSong("Oldest")
	ts.createSong("Middle")
	ts.createSong("Newest")

	if got, want := titles(ts.listSongs()), []string{"Newest", "Middle", "Oldest"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("song list = %v, want %v", got, want)
	}

	edited := ts.updateSong(oldest.ID, map[string]any{"notes": "Picked it back up"})

	list := ts.listSongs()
	if got, want := titles(list), []string{"Oldest", "Newest", "Middle"}; !reflect.DeepEqual(got, want) {
		t.Errorf("song list after editing %q = %v, want %v", oldest.Title, got, want)
	}
	if list[0].UpdatedAt != edited.UpdatedAt {
		t.Errorf("list updatedAt = %s, want the edited Song's %s", list[0].UpdatedAt, edited.UpdatedAt)
	}
}

func TestSongListCanBeFilteredByStatus(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Just An Idea")
	ts.updateSong(ts.createSong("Half Written").ID, map[string]any{"status": "drafting"})
	ts.updateSong(ts.createSong("Also Drafting").ID, map[string]any{"status": "drafting"})
	ts.updateSong(ts.createSong("Done").ID, map[string]any{"status": "finished"})

	cases := map[string][]string{
		"status=idea":     {"Just An Idea"},
		"status=drafting": {"Also Drafting", "Half Written"},
		"status=finished": {"Done"},
		"status=":         {"Done", "Also Drafting", "Half Written", "Just An Idea"},
	}
	for query, want := range cases {
		if got := titles(ts.listSongs(query)); !reflect.DeepEqual(got, want) {
			t.Errorf("song list for %q = %v, want %v", query, got, want)
		}
	}
}

func TestSongListCanBeFilteredBySeveralStatuses(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Just An Idea")
	ts.updateSong(ts.createSong("Half Written").ID, map[string]any{"status": "drafting"})
	ts.updateSong(ts.createSong("Done").ID, map[string]any{"status": "finished"})

	cases := map[string][]string{
		"status=idea&status=drafting":                 {"Half Written", "Just An Idea"},
		"status=drafting&status=finished":             {"Done", "Half Written"},
		"status=idea&status=drafting&status=finished": {"Done", "Half Written", "Just An Idea"},
		"status=idea&status=idea":                     {"Just An Idea"},
		"status=finished&status=&q=d":                 {"Done"},
	}
	for query, want := range cases {
		if got := titles(ts.listSongs(query)); !reflect.DeepEqual(got, want) {
			t.Errorf("song list for %q = %v, want %v", query, got, want)
		}
	}
}

func TestSongListRejectsUnknownStatusFilter(t *testing.T) {
	ts := newTestServer(t)

	for _, query := range []string{"status=released", "status=idea&status=released"} {
		res := ts.Do(http.MethodGet, "/api/songs?"+query, nil)
		expectStatus(t, res, http.StatusBadRequest)
	}
}

func TestSongListCanBeSearchedByTitle(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Midnight Drive")
	ts.createSong("Paper Planes")
	ts.updateSong(ts.createSong("Drive-In Night").ID, map[string]any{"status": "finished"})
	ts.createSong("Canção do Mar")
	ts.createSong("100% Sure")

	cases := map[string][]string{
		"q=drive":                 {"Drive-In Night", "Midnight Drive"},
		"q=NIGHT":                 {"Drive-In Night", "Midnight Drive"},
		"q=+planes+":              {"Paper Planes"},
		"q=CAN%C3%87%C3%83O":      {"Canção do Mar"},
		"q=100%25":                {"100% Sure"},
		"q=_":                     {},
		"q=nothing+like+it":       {},
		"q=drive&status=finished": {"Drive-In Night"},
		"q=":                      {"100% Sure", "Canção do Mar", "Drive-In Night", "Paper Planes", "Midnight Drive"},
	}
	for query, want := range cases {
		if got := titles(ts.listSongs(query)); !reflect.DeepEqual(got, want) {
			t.Errorf("song list for %q = %v, want %v", query, got, want)
		}
	}
}

func TestSongListCanBeFilteredByHavingAMasterTogetherWithStatus(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("No Master")
	ts.uploadMaster(ts.createSong("Mastered Idea").ID, fakeAudio("a.wav"))
	done := ts.updateSong(ts.createSong("Mastered And Done").ID, map[string]any{"status": "finished"})
	ts.uploadMaster(done.ID, fakeAudio("b.wav"))
	ts.uploadMaster(done.ID, fakeAudio("c.wav"))
	ts.updateSong(ts.createSong("Done Without").ID, map[string]any{"status": "finished"})
	gone := ts.uploadMaster(ts.createSong("Master Deleted").ID, fakeAudio("d.wav"))
	ts.lyricSheetChange(http.MethodDelete, masterPath(gone.ID, gone.Masters[0].ID), nil)

	cases := map[string][]string{
		"hasMaster=true":                 {"Mastered And Done", "Mastered Idea"},
		"hasMaster=false":                {"Master Deleted", "Done Without", "No Master"},
		"hasMaster=true&status=finished": {"Mastered And Done"},
		"hasMaster=true&status=idea":     {"Mastered Idea"},
		"hasMaster=true&q=idea":          {"Mastered Idea"},
		"hasMaster=":                     {"Master Deleted", "Done Without", "Mastered And Done", "Mastered Idea", "No Master"},
	}
	for query, want := range cases {
		if got := titles(ts.listSongs(query)); !reflect.DeepEqual(got, want) {
			t.Errorf("song list for %q = %v, want %v", query, got, want)
		}
	}
}

func TestSongListRejectsAnUnknownMasterFilter(t *testing.T) {
	ts := newTestServer(t)

	expectError(t, ts.Do(http.MethodGet, "/api/songs?hasMaster=maybe", nil),
		http.StatusBadRequest, "hasMaster must be true or false")
}

func TestSongListShowsEachSongsKeyBPMAndWhetherItHasAMaster(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Bare")
	ts.updateSong(ts.createSong("Keyed").ID, map[string]any{"key": "Am", "bpm": 92, "status": "drafting"})
	ts.uploadMaster(ts.createSong("Mastered").ID, fakeAudio("a.wav"))
	gone := ts.uploadMaster(ts.createSong("Master Deleted").ID, fakeAudio("b.wav"))
	ts.lyricSheetChange(http.MethodDelete, masterPath(gone.ID, gone.Masters[0].ID), nil)

	type row struct {
		Title     string
		Key       string
		BPM       *int
		HasMaster bool
	}
	bpm := 92
	rows := func(list []songSummary) []row {
		out := []row{}
		for _, s := range list {
			out = append(out, row{s.Title, s.Key, s.BPM, s.HasMaster})
		}
		return out
	}

	want := []row{
		{"Master Deleted", "", nil, false},
		{"Mastered", "", nil, true},
		{"Keyed", "Am", &bpm, false},
		{"Bare", "", nil, false},
	}
	if got := rows(ts.listSongs()); !reflect.DeepEqual(got, want) {
		t.Errorf("song list = %+v, want %+v", got, want)
	}
	if got, want := rows(ts.listSongs("hasMaster=true")), want[1:2]; !reflect.DeepEqual(got, want) {
		t.Errorf("song list with a Master = %+v, want %+v", got, want)
	}
	if got, want := rows(ts.listSongs("status=drafting&q=key")), want[2:3]; !reflect.DeepEqual(got, want) {
		t.Errorf("drafting song list = %+v, want %+v", got, want)
	}
}
