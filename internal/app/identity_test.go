package app_test

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"testing"

	"github.com/xKirtle/bandmate/internal/db"
)

// identityOf reads the identity of a Song or Beat (table "songs" or
// "beats") straight from the database, as the API doesn't show it: only a
// Restore uses it, to tell the same Song or Beat from one with its title.
func (ts *testServer) identityOf(table string, id int64) string {
	ts.t.Helper()
	conn, err := db.Open(context.Background(), ts.DataDir)
	if err != nil {
		ts.t.Fatalf("opening database: %v", err)
	}
	defer conn.Close()
	var identity sql.NullString
	if err := conn.QueryRow(`SELECT identity FROM `+table+` WHERE id = ?`, id).Scan(&identity); err != nil {
		ts.t.Fatalf("reading the identity of %s %d: %v", table, id, err)
	}
	return identity.String
}

// expectDistinctIdentities checks each identity is 32 hex digits and none
// is shared.
func expectDistinctIdentities(t *testing.T, what string, identities ...string) {
	t.Helper()
	seen := map[string]bool{}
	for _, id := range identities {
		if len(id) != 32 || strings.Trim(id, "0123456789abcdef") != "" {
			t.Errorf("%s identity = %q, want 32 hex digits", what, id)
		}
		if seen[id] {
			t.Errorf("%s identity %q is shared", what, id)
		}
		seen[id] = true
	}
}

func TestEachNewSongGetsItsOwnIdentityEvenWithTheSameTitle(t *testing.T) {
	ts := newTestServer(t)
	first := ts.createSong("Midnight")
	second := ts.createSong("Midnight")
	res := ts.importSong("Midnight", "[Verse]\nCity lights")
	expectStatus(t, res, http.StatusCreated)
	var imported song
	res.JSON(t, &imported)

	expectDistinctIdentities(t, "Song",
		ts.identityOf("songs", first.ID), ts.identityOf("songs", second.ID), ts.identityOf("songs", imported.ID))
}

func TestEachNewBeatGetsItsOwnIdentityEvenWithTheSameTitle(t *testing.T) {
	ts := newTestServer(t)
	upload := fakeAudio("dark_trap.mp3").with(map[string]any{"title": "Dark Trap"})
	first := ts.uploadBeat(upload)
	second := ts.uploadBeat(upload)

	expectDistinctIdentities(t, "Beat", ts.identityOf("beats", first.ID), ts.identityOf("beats", second.ID))
}
