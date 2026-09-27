package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

func TestCreatedSongAppearsInSongList(t *testing.T) {
	ts := newTestServer(t)

	created := ts.createSong("Midnight Drive")

	if created.Title != "Midnight Drive" {
		t.Errorf("title = %q, want %q", created.Title, "Midnight Drive")
	}
	if created.Status != "idea" {
		t.Errorf("status = %q, want new Songs to start as %q", created.Status, "idea")
	}
	if created.UpdatedAt == "" {
		t.Error("updatedAt is empty")
	}

	list := ts.listSongs()
	if len(list) != 1 {
		t.Fatalf("song list has %d songs, want 1: %+v", len(list), list)
	}
	got := list[0]
	if got.ID != created.ID || got.Title != "Midnight Drive" || got.Status != "idea" || got.UpdatedAt != created.UpdatedAt {
		t.Errorf("song list entry = %+v, want it to match created song %+v", got, created)
	}
}

func TestCreatedSongCanBeRead(t *testing.T) {
	ts := newTestServer(t)
	created := ts.createSong("Paper Planes")

	got := ts.getSong(created.ID)

	if !reflect.DeepEqual(got, created) {
		t.Errorf("read song = %+v, want %+v", got, created)
	}
}

func TestReadingUnknownSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodGet, "/api/songs/999", nil)

	expectStatus(t, res, http.StatusNotFound)
}

func TestCreatingSongWithoutTitleIsRejected(t *testing.T) {
	cases := map[string]any{
		"missing title": map[string]any{},
		"empty title":   map[string]any{"title": ""},
		"blank title":   map[string]any{"title": "   "},
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			res := ts.Do(http.MethodPost, "/api/songs", body)

			expectStatus(t, res, http.StatusBadRequest)
			var e struct{ Error string }
			res.JSON(t, &e)
			if e.Error != "title is required" {
				t.Errorf("error = %q, want %q", e.Error, "title is required")
			}
			if list := ts.listSongs(); len(list) != 0 {
				t.Errorf("song list = %+v, want no Song created", list)
			}
		})
	}
}

func TestSongsSurviveARestart(t *testing.T) {
	ts := newTestServer(t)
	created := ts.createSong("Still Here")
	ts.Stop()

	restarted := startTestServer(t, ts.DataDir)

	list := restarted.listSongs()
	if len(list) != 1 || list[0].ID != created.ID || list[0].Title != "Still Here" {
		t.Errorf("song list after restart = %+v, want the Song created before", list)
	}
}
