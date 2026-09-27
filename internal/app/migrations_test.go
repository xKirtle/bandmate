package app_test

import (
	"net/http"
	"path/filepath"
	"testing"
)

func TestMigrationsApplyToEmptyDatabase(t *testing.T) {
	// A data directory that doesn't exist yet: nothing on disk at all.
	ts := startTestServer(t, filepath.Join(t.TempDir(), "fresh", "data"))

	expectStatus(t, ts.Do(http.MethodGet, "/api/health", nil), http.StatusOK)
	created := ts.createSong("First Song")
	if list := ts.listSongs(); len(list) != 1 || list[0].ID != created.ID {
		t.Errorf("song list = %+v, want the Song just created", list)
	}
}

func TestMigrationsAreNotReappliedOnRestart(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Before")
	ts.Stop()

	// Re-running a migration would fail (tables already exist) or wipe data.
	restarted := startTestServer(t, ts.DataDir)

	expectStatus(t, restarted.Do(http.MethodGet, "/api/health", nil), http.StatusOK)
	restarted.createSong("After")
	if list := restarted.listSongs(); len(list) != 2 {
		t.Errorf("song list = %+v, want both Songs", list)
	}
}
