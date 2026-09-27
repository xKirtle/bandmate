package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// titles lists the Song titles in order.
func titles(list []songSummary) []string {
	out := []string{}
	for _, s := range list {
		out = append(out, s.Title)
	}
	return out
}

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

func TestSongListRejectsUnknownStatusFilter(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodGet, "/api/songs?status=released", nil)

	expectStatus(t, res, http.StatusBadRequest)
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
