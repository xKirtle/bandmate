package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// expectStale fails the test unless the response rejects a write based on an
// outdated version of the Song.
func expectStale(t *testing.T, r response) {
	t.Helper()
	expectStatus(t, r, http.StatusConflict)
	var e struct{ Error, Code string }
	r.JSON(t, &e)
	if e.Code != "stale" || e.Error == "" {
		t.Errorf("error = %+v, want code stale with a message", e)
	}
}

// versionedWrite is one kind of change to a Song, sent based on a version.
type versionedWrite struct {
	name string
	send func(ts *testServer, s song, version int64) response
}

// versionedWrites covers each kind of change: metadata, Status, Lyric Sheet
// structure, Alternate text and Cues. Each is sent to versionedSong.
var versionedWrites = []versionedWrite{
	{"metadata", func(ts *testServer, s song, v int64) response {
		return ts.DoAt(v, http.MethodPatch, songPath(s.ID), map[string]any{"key": "Am", "bpm": 92})
	}},
	{"status", func(ts *testServer, s song, v int64) response {
		return ts.DoAt(v, http.MethodPatch, songPath(s.ID), map[string]any{"status": "drafting"})
	}},
	{"lyric sheet structure", func(ts *testServer, s song, v int64) response {
		return ts.DoAt(v, http.MethodPost, songPath(s.ID)+"/sections", map[string]any{"label": "Bridge"})
	}},
	{"alternate text", func(ts *testServer, s song, v int64) response {
		return ts.DoAt(v, http.MethodPut, alternatePath(s.ID, s.Sections[0].Alternates[0].ID)+"/text",
			map[string]any{"text": "New words"})
	}},
	{"line cue", func(ts *testServer, s song, v int64) response {
		return ts.DoAt(v, http.MethodPut,
			lineCuePath(s.ID, s.Arrangement[0].ID, s.Sections[0].Alternates[0].Lines[0].ID), map[string]any{"cue": 3})
	}},
}

// versionedSong returns a Song with one Section holding one Line, for
// versionedWrites.
func (ts *testServer) versionedSong() song {
	ts.t.Helper()
	s := ts.songWithSections("Verse")
	return ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "Old words")
}

func TestEveryChangeToASongChangesItsVersion(t *testing.T) {
	for _, w := range versionedWrites {
		t.Run(w.name, func(t *testing.T) {
			ts := newTestServer(t)
			before := ts.versionedSong()

			res := w.send(ts, before, before.Version)

			expectStatus(t, res, http.StatusOK)
			var got song
			res.JSON(t, &got)
			if got.Version == before.Version {
				t.Errorf("version = %d, want it changed", got.Version)
			}
			if read := ts.getSong(before.ID); read.Version != got.Version {
				t.Errorf("version read back = %d, want %d", read.Version, got.Version)
			}
		})
	}
}

func TestAWriteBasedOnAnOldVersionIsRejectedAndChangesNothing(t *testing.T) {
	for _, w := range versionedWrites {
		t.Run(w.name, func(t *testing.T) {
			ts := newTestServer(t)
			old := ts.versionedSong()
			// Another tab changes the Song.
			current := ts.setLabel(old.ID, old.Sections[0].ID, "Verse 1")

			expectStale(t, w.send(ts, old, old.Version))

			if read := ts.getSong(old.ID); !reflect.DeepEqual(read, current) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, current)
			}
		})
	}
}

func TestAWriteBasedOnTheCurrentVersionSucceedsAfterOtherChanges(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithSections("Verse")
	s = ts.setLabel(s.ID, s.Sections[0].ID, "Verse 1")

	res := ts.DoAt(s.Version, http.MethodPatch, songPath(s.ID), map[string]any{"title": "Renamed"})

	expectStatus(t, res, http.StatusOK)
	var got song
	res.JSON(t, &got)
	if got.Title != "Renamed" {
		t.Errorf("title = %q, want Renamed", got.Title)
	}
}

func TestAnEmptyUpdateBasedOnAnOldVersionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	old := ts.createSong("Night Drive")
	ts.updateSong(old.ID, map[string]any{"notes": "slow"})

	expectStale(t, ts.DoAt(old.Version, http.MethodPatch, songPath(old.ID), map[string]any{}))
}

func TestAnEmptyUpdateKeepsTheVersion(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	got := ts.updateSong(s.ID, map[string]any{})

	if got.Version != s.Version {
		t.Errorf("version = %d, want %d", got.Version, s.Version)
	}
}

func TestDeletingASongBasedOnAnOldVersionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	old := ts.createSong("Night Drive")
	ts.updateSong(old.ID, map[string]any{"notes": "slow"})

	expectStale(t, ts.DoAt(old.Version, http.MethodDelete, songPath(old.ID), nil))

	current := ts.getSong(old.ID)
	expectStatus(t, ts.DoAt(current.Version, http.MethodDelete, songPath(old.ID), nil), http.StatusNoContent)
}

func TestAStaleWriteToAMissingSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)

	res := ts.DoAt(1, http.MethodPost, songPath(999)+"/sections", map[string]any{})

	expectError(t, res, http.StatusNotFound, "not found")
}

func TestAWriteWithoutAVersionIsApplied(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	ts.updateSong(s.ID, map[string]any{"notes": "slow"})

	got := ts.updateSong(s.ID, map[string]any{"title": "Renamed"})

	if got.Title != "Renamed" {
		t.Errorf("title = %q, want Renamed", got.Title)
	}
}

func TestAMalformedVersionIsRejected(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	for _, value := range []string{"3", `"three"`, `W/"3"`} {
		res := ts.do(http.MethodPatch, songPath(s.ID), http.Header{"If-Match": {value}}, map[string]any{"title": "X"})

		expectError(t, res, http.StatusBadRequest, `If-Match must be a Song version, like "3"`)
	}
	if got := ts.getSong(s.ID); got.Title != "Night Drive" {
		t.Errorf("title = %q, want it unchanged", got.Title)
	}
}
