package app_test

import (
	"net/http"
	"os"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
	"github.com/xKirtle/bandmate/internal/build"
)

// about is GET /api/about's response.
type about struct {
	Version       string    `json:"version"`
	Revision      string    `json:"revision"`
	CommitTime    time.Time `json:"commitTime"`
	SourceURL     string    `json:"sourceUrl"`
	BugReportURL  string    `json:"bugReportUrl"`
	ReleasesURL   string    `json:"releasesUrl"`
	GoVersion     string    `json:"goVersion"`
	OS            string    `json:"os"`
	Arch          string    `json:"arch"`
	SQLiteVersion string    `json:"sqliteVersion"`
	Schema        struct {
		Migration string    `json:"migration"`
		AppliedAt time.Time `json:"appliedAt"`
	} `json:"schema"`
	StartedAt time.Time `json:"startedAt"`
	Details   string    `json:"details"`
}

func getAbout(t *testing.T, configure func(*app.Config)) about {
	t.Helper()
	res := newTestServerWith(t, configure).Do(http.MethodGet, "/api/about", nil)
	expectStatus(t, res, http.StatusOK)
	var a about
	res.JSON(t, &a)
	return a
}

// latestMigration is the name of the last migration file, which a fresh
// database is migrated up to.
func latestMigration(t *testing.T) string {
	t.Helper()
	entries, err := os.ReadDir("../db/migrations")
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSuffix(entries[len(entries)-1].Name(), ".sql")
}

const sha = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d"

func TestAboutTellsTheBuildTheSystemAndTheSchema(t *testing.T) {
	release := build.Info{
		Version:      "v0.4.0",
		Revision:     sha,
		SourceURL:    "https://github.com/xKirtle/bandmate/tree/v0.4.0",
		BugReportURL: "https://github.com/xKirtle/bandmate/issues/new/choose",
		ReleasesURL:  "https://github.com/xKirtle/bandmate/releases",
		CommitTime:   time.Date(2026, 9, 29, 14, 3, 0, 0, time.UTC),
	}
	started := time.Date(2026, 9, 30, 8, 0, 0, 0, time.UTC)
	before := time.Now().Add(-time.Second)
	got := getAbout(t, func(c *app.Config) {
		c.Build = release
		c.Now = func() time.Time { return started }
	})

	gotBuild := build.Info{
		Version: got.Version, Revision: got.Revision, SourceURL: got.SourceURL,
		BugReportURL: got.BugReportURL, ReleasesURL: got.ReleasesURL, CommitTime: got.CommitTime,
	}
	if gotBuild != release {
		t.Errorf("build = %+v, want %+v", gotBuild, release)
	}
	if want := strings.TrimPrefix(runtime.Version(), "go"); got.GoVersion != want {
		t.Errorf("Go version = %q, want %q", got.GoVersion, want)
	}
	if got.OS != runtime.GOOS || got.Arch != runtime.GOARCH {
		t.Errorf("platform = %s/%s, want %s/%s", got.OS, got.Arch, runtime.GOOS, runtime.GOARCH)
	}
	if !regexp.MustCompile(`^3\.\d+\.\d+$`).MatchString(got.SQLiteVersion) {
		t.Errorf("SQLite version = %q, want 3.x.y", got.SQLiteVersion)
	}
	if want := latestMigration(t); got.Schema.Migration != want {
		t.Errorf("schema = %q, want %q", got.Schema.Migration, want)
	}
	if got.Schema.AppliedAt.Before(before) || got.Schema.AppliedAt.After(time.Now()) {
		t.Errorf("schema applied at %v, want during this test", got.Schema.AppliedAt)
	}
	if !got.StartedAt.Equal(started) {
		t.Errorf("started at %v, want %v", got.StartedAt, started)
	}
}

func TestAboutLeavesOutACommitDateItDoesntKnow(t *testing.T) {
	res := newTestServerWith(t, func(c *app.Config) {
		c.Build = build.Info{Version: "dev"}
	}).Do(http.MethodGet, "/api/about", nil)
	if strings.Contains(string(res.Body), "commitTime") {
		t.Errorf("about = %s, want no commitTime", res.Body)
	}
}

func TestTheAboutDetailsAreTheBlockABugReportAsksFor(t *testing.T) {
	committed := time.Date(2026, 9, 29, 23, 30, 0, 0, time.UTC)
	cases := map[string]struct {
		build     build.Info
		firstLine string
	}{
		"a tagged release names its tag, commit and commit date": {
			build:     build.Info{Version: "v0.4.0", Revision: sha, CommitTime: committed},
			firstLine: "Bandmate v0.4.0 (1a2b3c4, 2026-09-29)",
		},
		"an untagged build doesn't repeat its commit": {
			build:     build.Info{Version: "1a2b3c4-dirty", Revision: sha, CommitTime: committed},
			firstLine: "Bandmate 1a2b3c4-dirty (2026-09-29)",
		},
		"a tagged release without its commit date still names its commit": {
			build:     build.Info{Version: "v0.4.0", Revision: sha},
			firstLine: "Bandmate v0.4.0 (1a2b3c4)",
		},
		"an untagged build without its commit date has nothing to add": {
			build:     build.Info{Version: "1a2b3c4", Revision: sha},
			firstLine: "Bandmate 1a2b3c4",
		},
		"a build that knows nothing is dev": {
			build:     build.Info{Version: "dev"},
			firstLine: "Bandmate dev",
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			got := getAbout(t, func(cfg *app.Config) { cfg.Build = c.build })

			want := c.firstLine + "\n" +
				"Go " + got.GoVersion + " " + got.OS + "/" + got.Arch +
				" · SQLite " + got.SQLiteVersion + " · schema " + latestMigration(t)
			if got.Details != want {
				t.Errorf("details =\n%s\nwant\n%s", got.Details, want)
			}
		})
	}
}

func TestConfigStillTellsOnlyItsOwnFields(t *testing.T) {
	res := newTestServerWith(t, func(c *app.Config) {
		c.Build = build.Info{Version: "v0.4.0", ReleasesURL: "https://example.com/releases", CommitTime: time.Now()}
	}).Do(http.MethodGet, "/api/config", nil)
	for _, field := range []string{"releasesUrl", "commitTime"} {
		if strings.Contains(string(res.Body), field) {
			t.Errorf("config = %s, want no %s", res.Body, field)
		}
	}
}
