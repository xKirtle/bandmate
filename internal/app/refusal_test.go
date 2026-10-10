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

// dataBefore is a data directory whose database an older Bandmate made: at
// the schema before migration.
func dataBefore(t *testing.T, migration string) string {
	t.Helper()
	dir := t.TempDir()
	conn, err := db.OpenBefore(context.Background(), dir, migration)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	return dir
}

// startRefused starts Bandmate on dataDir as main does, expecting New to
// refuse it, and serves the refusal in place of the app.
func startRefused(t *testing.T, dataDir string) *httptest.Server {
	t.Helper()
	a, err := app.New(app.Config{DataDir: dataDir, SPA: testSPA})
	var refused *app.Refused
	if !errors.As(err, &refused) {
		if a != nil {
			a.Close()
		}
		t.Fatalf("starting app = %v, want a refusal", err)
	}
	return refusedServer(t, refused)
}

// refusedServer serves a refused Bandmate, as main does when New refuses.
func refusedServer(t *testing.T, refused *app.Refused) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(app.RefusalHandler(refused))
	t.Cleanup(srv.Close)
	return srv
}

func TestBandmateRefusesADatabaseANewerBandmateMigrated(t *testing.T) {
	dir := dataBefore(t, "0040_clip_pitch")
	damage(t, dir, `INSERT INTO schema_migrations (name) VALUES ('9999_from_the_future')`)

	srv := startRefused(t, dir)

	res, err := http.Get(srv.URL + "/api/songs")
	if err != nil {
		t.Fatal(err)
	}
	page := readBody(t, res)
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusServiceUnavailable)
	}
	if !strings.Contains(page, "changed by a newer Bandmate") {
		t.Errorf("page = %q, want it to say a newer Bandmate changed the database", page)
	}
}

func TestADatabaseAnOlderBandmateMigratedStillStarts(t *testing.T) {
	ts := startTestServer(t, dataBefore(t, "0040_clip_pitch"))

	expectStatus(t, ts.Do(http.MethodGet, "/api/health", nil), http.StatusOK)
	ts.createSong("After the upgrade")
}

func TestARefusedBandmateAnswersEveryPageWithTheReason(t *testing.T) {
	srv := refusedServer(t, &app.Refused{Reason: "The database was changed by a newer Bandmate."})

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
	srv := refusedServer(t, &app.Refused{Reason: "<script>"})

	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	if page := readBody(t, res); strings.Contains(page, "<script>") {
		t.Errorf("page = %q, want the reason escaped", page)
	}
}

func TestARefusedBandmateIsUnhealthy(t *testing.T) {
	srv := refusedServer(t, &app.Refused{Reason: "The database was changed by a newer Bandmate."})

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
