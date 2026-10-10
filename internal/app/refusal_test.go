package app_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xKirtle/bandmate/internal/app"
	"github.com/xKirtle/bandmate/internal/db"
)

// newerData is a data directory whose database a newer Bandmate migrated:
// it's at the schema before migration, and records one this Bandmate doesn't
// know.
func newerData(t *testing.T, migration string) string {
	t.Helper()
	dir := t.TempDir()
	conn, err := db.OpenBefore(context.Background(), dir, migration)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	damage(t, dir, `INSERT INTO schema_migrations (name) VALUES ('9999_from_the_future')`)
	return dir
}

func TestBandmateRefusesADatabaseANewerBandmateMigrated(t *testing.T) {
	dir := newerData(t, "0040_clip_pitch")

	a, err := app.New(app.Config{DataDir: dir, SPA: testSPA})

	var refused *app.Refused
	if !errors.As(err, &refused) {
		if a != nil {
			a.Close()
		}
		t.Fatalf("New = %v, want a refusal", err)
	}
	if !strings.Contains(refused.Reason, "newer Bandmate") {
		t.Errorf("reason = %q, want it to say a newer Bandmate changed the database", refused.Reason)
	}
}

func TestADatabaseAnOlderBandmateMigratedStillStarts(t *testing.T) {
	dir := t.TempDir()
	old, err := db.OpenBefore(context.Background(), dir, "0040_clip_pitch")
	if err != nil {
		t.Fatal(err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}

	ts := startTestServer(t, dir)

	expectStatus(t, ts.Do(http.MethodGet, "/api/health", nil), http.StatusOK)
	ts.createSong("After the upgrade")
}

// refusedServer serves a refused Bandmate, as main does when New refuses.
func refusedServer(t *testing.T, reason string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(app.RefusalHandler(&app.Refused{Reason: reason}))
	t.Cleanup(srv.Close)
	return srv
}

func TestARefusedBandmateAnswersEveryPageWithTheReason(t *testing.T) {
	srv := refusedServer(t, "The database was changed by a newer Bandmate.")

	for _, path := range []string{"/", "/songs/4", "/api/songs", "/assets/app.js"} {
		res, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		page := readBody(t, res)
		if res.StatusCode != http.StatusServiceUnavailable {
			t.Errorf("%s: status = %d, want %d", path, res.StatusCode, http.StatusServiceUnavailable)
		}
		if got := res.Header.Get("Content-Type"); got != "text/html; charset=utf-8" {
			t.Errorf("%s: content type = %q, want an HTML page", path, got)
		}
		if !strings.Contains(page, "The database was changed by a newer Bandmate.") {
			t.Errorf("%s: page = %q, want the reason", path, page)
		}
		if !strings.Contains(page, `href="https://xkirtle.github.io/bandmate/self-hosting#upgrading-and-rolling-back"`) {
			t.Errorf("%s: page = %q, want a link to the upgrade guide", path, page)
		}
	}
}

func TestARefusedBandmateEscapesItsReason(t *testing.T) {
	srv := refusedServer(t, "<script>")

	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	if page := readBody(t, res); strings.Contains(page, "<script>") {
		t.Errorf("page = %q, want the reason escaped", page)
	}
}

func TestARefusedBandmateIsUnhealthy(t *testing.T) {
	srv := refusedServer(t, "The database was changed by a newer Bandmate.")

	res, err := http.Get(srv.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	readBody(t, res)
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("health status = %d, want %d", res.StatusCode, http.StatusServiceUnavailable)
	}
}

// readBody reads and closes a response's body.
func readBody(t *testing.T, res *http.Response) string {
	t.Helper()
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}
