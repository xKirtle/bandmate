package app_test

import (
	"context"
	"net/http"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/xKirtle/bandmate/internal/db"
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

// sungInPortugueseBefore is a data directory at the schema before
// Portuguese became Portuguese (Portugal), holding Saudade (id 4), sung in
// English then Portuguese, and Fado (id 5), in Portuguese then English.
func sungInPortugueseBefore(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old, err := db.OpenBefore(context.Background(), dir, "0048_portuguese_portugal")
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`INSERT INTO songs (id, title, status, version, languages, created_at, updated_at)
			VALUES (4, 'Saudade', 'drafting', 1, '["en","pt"]', '2025-01-02T03:04:05.000000000Z', '2025-01-02T03:04:05.000000000Z')`,
		`INSERT INTO songs (id, title, status, version, languages, created_at, updated_at)
			VALUES (5, 'Fado', 'drafting', 1, '["pt","en"]', '2025-01-02T03:04:05.000000000Z', '2025-01-02T03:04:05.000000000Z')`,
	} {
		if _, err := old.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestSongsSungInPortugueseAreSungInPortuguesePortugal(t *testing.T) {
	ts := startTestServer(t, sungInPortugueseBefore(t))

	if got := ts.getSong(4).Languages; !reflect.DeepEqual(got, []string{"en", "pt-PT"}) {
		t.Errorf("Saudade's languages = %q, want English, then Portuguese (Portugal)", got)
	}
	if got := ts.getSong(5).Languages; !reflect.DeepEqual(got, []string{"pt-PT", "en"}) {
		t.Errorf("Fado's languages = %q, want Portuguese (Portugal), then English", got)
	}
}

func TestABackupOfSongsSungInPortugueseRestoresThemInPortuguesePortugal(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Placeholder")
	made := ts.backUp(map[string]any{"allSongs": true})
	ts.replaceBackupFile(made.ID, packBackup(t, sungInPortugueseBefore(t)))

	restored := ts.restore(made.ID, 4, 5)

	if len(restored) != 2 {
		t.Fatalf("restored = %+v, want Saudade and Fado", restored)
	}
	got := map[string][]string{}
	for _, r := range restored {
		got[r.Title] = ts.getSong(r.ID).Languages
	}
	want := map[string][]string{"Saudade": {"en", "pt-PT"}, "Fado": {"pt-PT", "en"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("restored languages = %q, want %q", got, want)
	}
}
