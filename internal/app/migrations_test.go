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

// nudgedTakesBefore is a data directory at the schema before a Nudge became
// the Clip's, holding one Song (id 7) whose Clip of Takes (id 1) plays Take
// 2 of two, nudged 0.4 s later, while Take 1 is nudged 0.1 s earlier. Each
// Take's stored position holds the Nudge it was moved by, as it did then.
func nudgedTakesBefore(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old, err := db.OpenBefore(context.Background(), dir, "0049_clip_nudge")
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`INSERT INTO songs (id, title, status, version, created_at, updated_at)
			VALUES (7, 'Night Drive', 'drafting', 1, '2025-01-02T03:04:05.000000000Z', '2025-01-02T03:04:05.000000000Z')`,
		`INSERT INTO tracks (id, song_id, name, position) VALUES (3, 7, 'Lead vox', 0)`,
		// The Takes go in before the Clip that plays one of them, and join
		// it once it's there.
		`INSERT INTO takes (id, song_id, number, size, duration, sample_rate, peaks,
				latency_offset, position, nudge, recorded_at)
			VALUES (1, 7, 1, 100, 4, 48000, '[]', 0, 1.9, -0.1, '2025-01-02T03:04:05.000000000Z')`,
		`INSERT INTO takes (id, song_id, number, size, duration, sample_rate, peaks,
				latency_offset, position, nudge, recorded_at)
			VALUES (2, 7, 2, 100, 4, 48000, '[]', 0, 2.4, 0.4, '2025-01-02T03:04:05.000000000Z')`,
		`INSERT INTO clips (id, track_id, active_take_id, start, source_offset, length)
			VALUES (1, 3, 2, 10, 0, 8)`,
		`UPDATE takes SET clip_id = 1 WHERE song_id = 7`,
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

// A Clip takes its active Take's Nudge, and each Take's position gives up
// the Nudge it had baked in, so the active Take's audio doesn't move. A
// Take that had a different Nudge shifts by the difference, which is silent
// until that Take is chosen (ADR 0028).
func TestAClipTakesItsActiveTakesNudgeOnUpgrade(t *testing.T) {
	ts := startTestServer(t, nudgedTakesBefore(t))

	c := ts.getTimeline(7).Tracks[0].Clips[0]

	if !near(c.Nudge, 0.4) {
		t.Errorf("clip's Nudge = %v, want its active Take's 0.4", c.Nudge)
	}
	if c.Start != 10 || c.Offset != 0 || c.Length != 8 {
		t.Errorf("clip = %+v, want its window untouched: 0:10, offset 0, 8 s long", c)
	}
	// Take 2's audio is where it was: 2.4 into the span, now 2 plus the
	// Clip's 0.4. Take 1's was at 1.9 and is now at 2.4 as well, half a
	// second later: the difference between the two Nudges.
	want := []float64{2, 2}
	got := []float64{c.Takes[0].Position, c.Takes[1].Position}
	for i := range want {
		if !near(got[i], want[i]) {
			t.Errorf("takes start at %v in the span, want %v, each as recorded", got, want)
			break
		}
	}
}
