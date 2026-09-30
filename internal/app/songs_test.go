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

func TestSongCreatedWithoutTitleIsUntitledSong(t *testing.T) {
	cases := map[string]any{
		"missing title": map[string]any{},
		"empty title":   map[string]any{"title": ""},
		"blank title":   map[string]any{"title": "   "},
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			res := ts.Do(http.MethodPost, "/api/songs", body)

			expectStatus(t, res, http.StatusCreated)
			var created song
			res.JSON(t, &created)
			if created.Title != "Untitled Song" {
				t.Errorf("title = %q, want %q", created.Title, "Untitled Song")
			}
			if created.Status != "idea" {
				t.Errorf("status = %q, want %q", created.Status, "idea")
			}
			if got := ts.getSong(created.ID); got.Title != "Untitled Song" {
				t.Errorf("read title = %q, want %q", got.Title, "Untitled Song")
			}
		})
	}
}

func TestSeveralSongsCanBeUntitledSong(t *testing.T) {
	ts := newTestServer(t)

	first := ts.createSong("")
	second := ts.createSong("")

	if first.ID == second.ID {
		t.Fatalf("both creates returned Song %d, want two Songs", first.ID)
	}
	list := ts.listSongs()
	if len(list) != 2 {
		t.Fatalf("song list has %d songs, want 2: %+v", len(list), list)
	}
	for _, s := range list {
		if s.Title != "Untitled Song" {
			t.Errorf("song %d title = %q, want %q", s.ID, s.Title, "Untitled Song")
		}
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
