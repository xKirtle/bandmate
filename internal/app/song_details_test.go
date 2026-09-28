package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

func TestSongStatusCanChangeBetweenAnyStatuses(t *testing.T) {
	ts := newTestServer(t)
	created := ts.createSong("Midnight Drive")

	for _, status := range []string{"finished", "idea", "drafting", "finished", "drafting", "idea"} {
		got := ts.updateSong(created.ID, map[string]any{"status": status})

		if got.Status != status {
			t.Fatalf("status after change = %q, want %q", got.Status, status)
		}
		if read := ts.getSong(created.ID); read.Status != status {
			t.Fatalf("status read back = %q, want %q", read.Status, status)
		}
	}
}

func TestUnknownStatusIsRejected(t *testing.T) {
	ts := newTestServer(t)
	created := ts.updateSong(ts.createSong("Midnight Drive").ID, map[string]any{"status": "drafting"})

	res := ts.patchSong(created.ID, map[string]any{"status": "released", "title": "Renamed"})

	expectError(t, res, http.StatusBadRequest, "status must be idea, drafting or finished")
	if got := ts.getSong(created.ID); !reflect.DeepEqual(got, created) {
		t.Errorf("song after rejected change = %+v, want it unchanged %+v", got, created)
	}
}

func TestSongCanBeRenamed(t *testing.T) {
	ts := newTestServer(t)
	created := ts.createSong("Working Title")

	got := ts.updateSong(created.ID, map[string]any{"title": "  Paper Planes  "})

	if got.Title != "Paper Planes" {
		t.Errorf("title = %q, want %q", got.Title, "Paper Planes")
	}
	if list := ts.listSongs(); list[0].Title != "Paper Planes" {
		t.Errorf("song list title = %q, want the new title", list[0].Title)
	}
}

func TestRenamingToBlankTitleIsRejected(t *testing.T) {
	ts := newTestServer(t)
	created := ts.createSong("Keep Me")

	res := ts.patchSong(created.ID, map[string]any{"title": "  "})

	expectError(t, res, http.StatusBadRequest, "title is required")
	if got := ts.getSong(created.ID); !reflect.DeepEqual(got, created) {
		t.Errorf("song after rejected rename = %+v, want it unchanged %+v", got, created)
	}
}

func TestEveryChangeUpdatesTheUpdatedTime(t *testing.T) {
	changes := map[string]map[string]any{
		"rename":   {"title": "New Title"},
		"status":   {"status": "drafting"},
		"metadata": {"notes": "Try it slower."},
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)
			created := ts.createSong("Old Title")

			got := ts.updateSong(created.ID, change)

			if !parseTime(t, got.UpdatedAt).After(parseTime(t, created.UpdatedAt)) {
				t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, created.UpdatedAt)
			}
			if got.CreatedAt != created.CreatedAt {
				t.Errorf("createdAt = %s, want it unchanged %s", got.CreatedAt, created.CreatedAt)
			}
		})
	}
}

func TestChangingUnknownSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)

	res := ts.patchSong(999, map[string]any{"title": "Ghost"})

	expectStatus(t, res, http.StatusNotFound)
}

func TestNewSongHasNoMetadata(t *testing.T) {
	ts := newTestServer(t)

	got := ts.createSong("Bare")

	want := song{ID: got.ID, Version: got.Version, Title: "Bare", Status: "idea", ShowChords: true, CreatedAt: got.CreatedAt, UpdatedAt: got.UpdatedAt,
		Arrangement: []occurrence{}, Sections: []section{}, Scrapbook: []int64{}, Masters: []master{}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("new song = %+v, want no key, BPM, capo, tuning, notes, Sections or Masters", got)
	}
}

func TestSongMetadataCanBeSetAndCleared(t *testing.T) {
	ts := newTestServer(t)
	created := ts.createSong("Midnight Drive")

	got := ts.updateSong(created.ID, map[string]any{
		"key":    " F#m ",
		"bpm":    92,
		"capo":   2,
		"tuning": "Drop D",
		"notes":  "Slow down in the bridge.\nTry a falsetto hook.",
	})

	two, ninetyTwo := 2, 92
	want := created
	want.Key, want.BPM, want.Capo, want.Tuning = "F#m", &ninetyTwo, &two, "Drop D"
	want.Notes = "Slow down in the bridge.\nTry a falsetto hook."
	want.Version, want.UpdatedAt = got.Version, got.UpdatedAt
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("song after setting metadata = %+v, want %+v", got, want)
	}
	if read := ts.getSong(created.ID); !reflect.DeepEqual(read, want) {
		t.Fatalf("song read back = %+v, want %+v", read, want)
	}

	// Only the fields sent change; null or "" clears a field.
	got = ts.updateSong(created.ID, map[string]any{"bpm": nil, "tuning": ""})

	want.BPM, want.Tuning, want.Version, want.UpdatedAt = nil, "", got.Version, got.UpdatedAt
	if !reflect.DeepEqual(got, want) {
		t.Errorf("song after clearing BPM and tuning = %+v, want %+v", got, want)
	}
}

func TestInvalidMetadataIsRejected(t *testing.T) {
	cases := map[string]struct {
		change map[string]any
		error  string
	}{
		"zero BPM":         {map[string]any{"bpm": 0}, "bpm must be between 1 and 999"},
		"huge BPM":         {map[string]any{"bpm": 1000}, "bpm must be between 1 and 999"},
		"negative capo":    {map[string]any{"capo": -1}, "capo must be between 0 and 24"},
		"capo off neck":    {map[string]any{"capo": 25}, "capo must be between 0 and 24"},
		"fractional BPM":   {map[string]any{"bpm": 92.5}, "request body must be valid JSON"},
		"BPM as a string":  {map[string]any{"bpm": "fast"}, "request body must be valid JSON"},
		"misspelt field":   {map[string]any{"stauts": "finished"}, `unknown field "stauts"`},
		"dropped showCues": {map[string]any{"showCues": false}, `unknown field "showCues"`},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)
			created := ts.createSong("Midnight Drive")

			res := ts.patchSong(created.ID, c.change)

			expectError(t, res, http.StatusBadRequest, c.error)
			if got := ts.getSong(created.ID); !reflect.DeepEqual(got, created) {
				t.Errorf("song after rejected change = %+v, want it unchanged %+v", got, created)
			}
		})
	}
}

func TestDeletedSongIsGone(t *testing.T) {
	ts := newTestServer(t)
	kept := ts.createSong("Keeper")
	doomed := ts.createSong("Scrap This")
	ts.updateSong(doomed.ID, map[string]any{"notes": "Owned by the Song", "bpm": 120})
	withVerse := ts.addSection(doomed.ID, map[string]any{"label": "Verse"})
	ts.setText(doomed.ID, withVerse.Sections[0].Alternates[0].ID, "Owned by the Song too")

	res := ts.Do(http.MethodDelete, fmt.Sprintf("/api/songs/%d", doomed.ID), nil)

	expectStatus(t, res, http.StatusNoContent)
	expectStatus(t, ts.Do(http.MethodGet, fmt.Sprintf("/api/songs/%d", doomed.ID), nil), http.StatusNotFound)
	if list := ts.listSongs(); len(list) != 1 || list[0].ID != kept.ID {
		t.Errorf("song list after delete = %+v, want only %q", list, kept.Title)
	}
}

func TestDeletingUnknownSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodDelete, "/api/songs/999", nil)

	expectStatus(t, res, http.StatusNotFound)
}
