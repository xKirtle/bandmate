package app_test

import (
	"context"
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
	"github.com/xKirtle/bandmate/internal/build"
	"github.com/xKirtle/bandmate/internal/db"
)

// upgradedOn is when the tests' upgrades happen.
var upgradedOn = time.Date(2026, 10, 10, 14, 30, 5, 0, time.UTC)

// olderInstall is a data directory an older Bandmate ran on: its database
// at the schema before migration, holding the Song Night Drive.
func olderInstall(t *testing.T, migration string) string {
	t.Helper()
	dir := t.TempDir()
	old, err := db.OpenBefore(context.Background(), dir, migration)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Exec(`INSERT INTO songs (id, title, status, version, created_at, updated_at)
		VALUES (4, 'Night Drive', 'drafting', 1, '2025-01-02T03:04:05.000000000Z', '2025-01-02T03:04:05.000000000Z')`); err != nil {
		t.Fatal(err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	return dir
}

// upgradeTo starts Bandmate version on dataDir at upgradedOn, then stops it.
func upgradeTo(t *testing.T, dataDir, version string) {
	t.Helper()
	startTestServer(t, dataDir, func(c *app.Config) {
		c.Build = build.Info{Version: version}
		c.Now = func() time.Time { return upgradedOn }
	}).Stop()
}

// laterReleaseBrings0040 makes dataDir's database as a release before
// 0040_clip_pitch left it, so that the next start migrates it again: as if
// the release last run on it were older than the one started next.
func laterReleaseBrings0040(t *testing.T, dataDir string) {
	t.Helper()
	damage(t, dataDir, `ALTER TABLE clips DROP COLUMN pitch`)
	damage(t, dataDir, `DELETE FROM schema_migrations WHERE name = '0040_clip_pitch'`)
}

// upgradeCopies lists the Upgrade copies in dataDir, by name.
func upgradeCopies(t *testing.T, dataDir string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(dataDir, "upgrade-copies"))
	if os.IsNotExist(err) {
		return []string{}
	}
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names
}

// openAsIs opens the database file at path without migrating it.
func openAsIs(t *testing.T, path string) *sql.DB {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	conn, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

// schemaOf is the latest migration applied to the database at path.
func schemaOf(t *testing.T, path string) string {
	t.Helper()
	d, err := db.Describe(context.Background(), openAsIs(t, path))
	if err != nil {
		t.Fatal(err)
	}
	return d.Schema.Migration
}

// songTitlesIn lists the titles of the Songs in the database at path.
func songTitlesIn(t *testing.T, path string) []string {
	t.Helper()
	rows, err := openAsIs(t, path).Query(`SELECT title FROM songs ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	titles := []string{}
	for rows.Next() {
		var title string
		if err := rows.Scan(&title); err != nil {
			t.Fatal(err)
		}
		titles = append(titles, title)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return titles
}

func TestUpgradingLeavesACopyOfTheDatabaseAsItWasBeforeMigrating(t *testing.T) {
	dir := olderInstall(t, "0040_clip_pitch")

	upgradeTo(t, dir, "v0.15.0")

	copies := upgradeCopies(t, dir)
	if len(copies) != 1 {
		t.Fatalf("upgrade copies = %v, want one", copies)
	}
	copied := filepath.Join(dir, "upgrade-copies", copies[0])
	if got := schemaOf(t, copied); got != "0039_clip_tempo" {
		t.Errorf("copy's schema = %s, want 0039_clip_tempo, as before migrating", got)
	}
	if got := songTitlesIn(t, copied); !reflect.DeepEqual(got, []string{"Night Drive"}) {
		t.Errorf("copy's songs = %v, want Night Drive", got)
	}
	if got := schemaOf(t, filepath.Join(dir, db.FileName)); got != "0040_clip_pitch" {
		t.Errorf("database's schema = %s, want it migrated to 0040_clip_pitch", got)
	}
}

func TestAnUpgradeCopyIsNamedAfterTheReleaseLastRunOnTheDatabase(t *testing.T) {
	dir := olderInstall(t, "0040_clip_pitch")
	upgradeTo(t, dir, "v0.14.2")
	laterReleaseBrings0040(t, dir)

	upgradeTo(t, dir, "v0.15.0")

	want := []string{"before-0.14.2.db", "before-2026-10-10.db"}
	if got := upgradeCopies(t, dir); !reflect.DeepEqual(got, want) {
		t.Errorf("upgrade copies = %v, want %v", got, want)
	}
}

func TestAnUpgradeCopyIsNamedByDateWhenNoReleaseRanBefore(t *testing.T) {
	t.Run("none recorded", func(t *testing.T) {
		dir := olderInstall(t, "0040_clip_pitch")

		upgradeTo(t, dir, "v0.15.0")

		if got := upgradeCopies(t, dir); !reflect.DeepEqual(got, []string{"before-2026-10-10.db"}) {
			t.Errorf("upgrade copies = %v, want before-2026-10-10.db", got)
		}
	})
	for _, ran := range []string{"dev", "1a2b3c4", "1a2b3c4-dirty"} {
		t.Run(ran+" ran", func(t *testing.T) {
			dir := olderInstall(t, "0040_clip_pitch")
			upgradeTo(t, dir, ran)
			if err := os.RemoveAll(filepath.Join(dir, "upgrade-copies")); err != nil {
				t.Fatal(err)
			}
			laterReleaseBrings0040(t, dir)

			upgradeTo(t, dir, "v0.15.0")

			if got := upgradeCopies(t, dir); !reflect.DeepEqual(got, []string{"before-2026-10-10.db"}) {
				t.Errorf("upgrade copies = %v, want before-2026-10-10.db", got)
			}
		})
	}
}

func TestAnUpgradeCopyWhoseNameIsTakenAddsTheTime(t *testing.T) {
	t.Run("by date", func(t *testing.T) {
		dir := olderInstall(t, "0040_clip_pitch")
		upgradeTo(t, dir, "dev")
		laterReleaseBrings0040(t, dir)

		upgradeTo(t, dir, "dev")

		want := []string{"before-2026-10-10-143005.db", "before-2026-10-10.db"}
		if got := upgradeCopies(t, dir); !reflect.DeepEqual(got, want) {
			t.Errorf("upgrade copies = %v, want %v", got, want)
		}
	})
	t.Run("by release", func(t *testing.T) {
		dir := olderInstall(t, "0040_clip_pitch")
		upgradeTo(t, dir, "v0.14.2")
		laterReleaseBrings0040(t, dir)
		upgradeTo(t, dir, "v0.14.2")
		laterReleaseBrings0040(t, dir)

		upgradeTo(t, dir, "v0.15.0")

		want := []string{"before-0.14.2-2026-10-10-143005.db", "before-0.14.2.db", "before-2026-10-10.db"}
		if got := upgradeCopies(t, dir); !reflect.DeepEqual(got, want) {
			t.Errorf("upgrade copies = %v, want %v", got, want)
		}
	})
}

func TestAFreshInstallTakesNoUpgradeCopy(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")

	upgradeTo(t, dir, "v0.15.0")

	if got := upgradeCopies(t, dir); len(got) != 0 {
		t.Errorf("upgrade copies = %v, want none", got)
	}
}

func TestAStartWithNothingToMigrateTakesNoUpgradeCopy(t *testing.T) {
	dir := olderInstall(t, "0040_clip_pitch")
	upgradeTo(t, dir, "v0.15.0")

	upgradeTo(t, dir, "v0.15.1")

	if got := upgradeCopies(t, dir); !reflect.DeepEqual(got, []string{"before-2026-10-10.db"}) {
		t.Errorf("upgrade copies = %v, want only the first upgrade's", got)
	}
}

func TestOnlyTheNewestThreeUpgradeCopiesAreKept(t *testing.T) {
	dir := olderInstall(t, "0040_clip_pitch")
	for _, release := range []string{"v0.13.0", "v0.14.0", "v0.14.1"} {
		upgradeTo(t, dir, release)
		laterReleaseBrings0040(t, dir)
	}

	upgradeTo(t, dir, "v0.15.0")

	want := []string{"before-0.13.0.db", "before-0.14.0.db", "before-0.14.1.db"}
	if got := upgradeCopies(t, dir); !reflect.DeepEqual(got, want) {
		t.Errorf("upgrade copies = %v, want %v, without the oldest, before-2026-10-10.db", got, want)
	}
}

func TestAnUpgradeCopyThatCantBeTakenRefusesTheUpgrade(t *testing.T) {
	dir := olderInstall(t, "0040_clip_pitch")
	// A file where the folder of Upgrade copies goes.
	if err := os.WriteFile(filepath.Join(dir, "upgrade-copies"), nil, 0o644); err != nil {
		t.Fatal(err)
	}

	srv := startRefused(t, dir)

	if got := schemaOf(t, filepath.Join(dir, db.FileName)); got != "0039_clip_tempo" {
		t.Errorf("database's schema = %s, want 0039_clip_tempo, unmigrated", got)
	}
	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	page := readBody(t, res)
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusServiceUnavailable)
	}
	if !strings.Contains(page, "couldn&#39;t copy the database before upgrading it") {
		t.Errorf("page = %q, want it to say the database couldn't be copied", page)
	}
}

func TestAnUpgradeCopyRollsBack(t *testing.T) {
	dir := olderInstall(t, "0040_clip_pitch")
	upgradeTo(t, dir, "v0.15.0")
	copies := upgradeCopies(t, dir)
	if len(copies) != 1 {
		t.Fatalf("upgrade copies = %v, want one", copies)
	}

	// Rolling back: the copy in place of the database, run by the older
	// Bandmate, which knows no migration from 0040_clip_pitch on.
	older := t.TempDir()
	copied, err := os.ReadFile(filepath.Join(dir, "upgrade-copies", copies[0]))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(older, db.FileName), copied, 0o644); err != nil {
		t.Fatal(err)
	}
	conn, err := db.OpenBefore(context.Background(), older, "0040_clip_pitch")
	if err != nil {
		t.Fatalf("opening the copy as the older Bandmate: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}

	if got := schemaOf(t, filepath.Join(older, db.FileName)); got != "0039_clip_tempo" {
		t.Errorf("rolled back schema = %s, want 0039_clip_tempo", got)
	}
	if got := songTitlesIn(t, filepath.Join(older, db.FileName)); !reflect.DeepEqual(got, []string{"Night Drive"}) {
		t.Errorf("rolled back songs = %v, want Night Drive", got)
	}
}
