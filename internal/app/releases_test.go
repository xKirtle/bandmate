package app_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
	"github.com/xKirtle/bandmate/internal/build"
)

// ghRelease is a release as GitHub's releases API lists it.
type ghRelease struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	Draft       bool      `json:"draft"`
	Prerelease  bool      `json:"prerelease"`
	PublishedAt time.Time `json:"published_at"`
}

// fakeGitHub stands in for GitHub's API, serving one repository's releases
// and counting how often it's asked.
type fakeGitHub struct {
	srv      *httptest.Server
	calls    atomic.Int32
	releases []ghRelease
	// status, when set, is the error GitHub answers with instead.
	status int
}

func newFakeGitHub(t *testing.T, releases ...ghRelease) *fakeGitHub {
	t.Helper()
	gh := &fakeGitHub{releases: releases}
	gh.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gh.calls.Add(1)
		if r.URL.Path != "/repos/xKirtle/bandmate/releases" {
			http.NotFound(w, r)
			return
		}
		if gh.status != 0 {
			http.Error(w, `{"message":"API rate limit exceeded"}`, gh.status)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(gh.releases)
	}))
	t.Cleanup(gh.srv.Close)
	return gh
}

// release is a published release of xKirtle/bandmate.
func release(tag string, published time.Time, body string) ghRelease {
	return ghRelease{
		TagName: tag, Name: tag, Body: body, PublishedAt: published,
		HTMLURL: "https://github.com/xKirtle/bandmate/releases/tag/" + tag,
	}
}

// releasesReport is GET /api/about/releases's response.
type releasesReport struct {
	Check       string `json:"check"`
	ReleasesURL string `json:"releasesUrl"`
	Verdict     string `json:"verdict"`
	Latest      *struct {
		Tag string `json:"tag"`
		URL string `json:"url"`
	} `json:"latest"`
	Releases []struct {
		Tag         string    `json:"tag"`
		Name        string    `json:"name"`
		URL         string    `json:"url"`
		PublishedAt time.Time `json:"publishedAt"`
		Running     bool      `json:"running"`
		Notes       []note    `json:"notes"`
	} `json:"releases"`
}

// note is one row of a release's notes.
type note struct {
	Badge  string `json:"badge,omitempty"`
	Title  string `json:"title,omitempty"`
	URL    string `json:"url,omitempty"`
	Number int    `json:"number,omitempty"`
	Text   string `json:"text,omitempty"`
}

// clock is a time that tests move on.
type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

var day0 = time.Date(2026, 9, 30, 8, 0, 0, 0, time.UTC)

// tagged is a release build of xKirtle/bandmate.
func tagged(version string) build.Info {
	return build.Resolve(build.Stamps{Version: version, Revision: sha, SourceURL: "https://github.com/xKirtle/bandmate"}, nil)
}

// untagged is a build of a commit of xKirtle/bandmate.
var untagged = build.Resolve(build.Stamps{Revision: sha, SourceURL: "https://github.com/xKirtle/bandmate"}, nil)

// releasesServer starts Bandmate running b, asking gh for releases.
func releasesServer(t *testing.T, gh *fakeGitHub, b build.Info, configure ...func(*app.Config)) *testServer {
	t.Helper()
	return newTestServerWith(t, func(c *app.Config) {
		c.Build = b
		c.GitHubAPI = gh.srv.URL
		for _, f := range configure {
			f(c)
		}
	})
}

func getReleases(t *testing.T, ts *testServer) releasesReport {
	t.Helper()
	res := ts.Do(http.MethodGet, "/api/about/releases", nil)
	expectStatus(t, res, http.StatusOK)
	var r releasesReport
	res.JSON(t, &r)
	return r
}

func TestANewerReleaseIsOfferedToATaggedBuild(t *testing.T) {
	gh := newFakeGitHub(t,
		release("v0.4.0", day0.AddDate(0, 0, -20), ""),
		release("v0.5.0", day0.AddDate(0, 0, -1), ""),
	)
	got := getReleases(t, releasesServer(t, gh, tagged("v0.4.0")))

	if got.Check != "ok" || got.Verdict != "updateAvailable" {
		t.Errorf("check, verdict = %q, %q, want ok, updateAvailable", got.Check, got.Verdict)
	}
	if got.Latest == nil || got.Latest.Tag != "v0.5.0" || got.Latest.URL != "https://github.com/xKirtle/bandmate/releases/tag/v0.5.0" {
		t.Errorf("latest = %+v, want v0.5.0 and its page", got.Latest)
	}
}

// generated is a release's notes as GitHub generates them from
// .github/release.yml, after a hand-written summary.
const generated = `Record is here: sing over a Beat and keep the best Take.

<!-- Release notes generated using configuration in .github/release.yml at main -->

## What's Changed
### Features
* Record a Take over the Beat by @xKirtle in https://github.com/xKirtle/bandmate/pull/301
* Show the About page by @xKirtle in https://github.com/xKirtle/bandmate/pull/319
### Fixes
* Keep the playhead when a Take by @someone ends by @someone in https://github.com/xKirtle/bandmate/pull/305
### Docs
* Explain BANDMATE_DATA_DIR by @xKirtle in https://github.com/xKirtle/bandmate/pull/307
### Other
* Bump vite by @dependabot[bot] in https://github.com/xKirtle/bandmate/pull/309

## New Contributors
* @someone made their first contribution in https://github.com/xKirtle/bandmate/pull/305

**Full Changelog**: https://github.com/xKirtle/bandmate/compare/v0.3.0...v0.4.0`

func TestReleaseNotesAreReadIntoRows(t *testing.T) {
	gh := newFakeGitHub(t, release("v0.4.0", day0, generated))
	got := getReleases(t, releasesServer(t, gh, tagged("v0.4.0")))

	pr := "https://github.com/xKirtle/bandmate/pull/"
	want := []note{
		{Text: "Record is here: sing over a Beat and keep the best Take."},
		{Badge: "new", Title: "Record a Take over the Beat", URL: pr + "301", Number: 301},
		{Badge: "new", Title: "Show the About page", URL: pr + "319", Number: 319},
		{Badge: "fix", Title: "Keep the playhead when a Take by @someone ends", URL: pr + "305", Number: 305},
		{Badge: "docs", Title: "Explain BANDMATE_DATA_DIR", URL: pr + "307", Number: 307},
		{Title: "Bump vite", URL: pr + "309", Number: 309},
	}
	if len(got.Releases) != 1 || !slices.Equal(got.Releases[0].Notes, want) {
		t.Errorf("notes = %+v\nwant %+v", got.Releases, want)
	}
}

func TestReleaseNotesKeepWhatIsntGeneratedAsText(t *testing.T) {
	body := "## Highlights\r\n\r\n- Faster start\r\n* Not a pull request\r\n### Fixes\r\n* Fix it by @x in https://github.com/xKirtle/bandmate/pull/2"
	gh := newFakeGitHub(t, release("v0.4.0", day0, body), release("v0.3.0", day0.AddDate(0, 0, -1), ""))
	got := getReleases(t, releasesServer(t, gh, tagged("v0.4.0")))

	want := []note{
		{Text: "## Highlights"},
		{Text: "- Faster start"},
		{Text: "* Not a pull request"},
		{Badge: "fix", Title: "Fix it", URL: "https://github.com/xKirtle/bandmate/pull/2", Number: 2},
	}
	if !slices.Equal(got.Releases[0].Notes, want) {
		t.Errorf("notes = %+v\nwant %+v", got.Releases[0].Notes, want)
	}
	if got.Releases[1].Notes == nil || len(got.Releases[1].Notes) != 0 {
		t.Errorf("notes of a release without any = %+v, want []", got.Releases[1].Notes)
	}
}

func TestGitHubIsOnlyAskedWhenTheReleasesAreAskedFor(t *testing.T) {
	gh := newFakeGitHub(t, release("v0.4.0", day0, ""))
	ts := releasesServer(t, gh, tagged("v0.4.0"))
	ts.Do(http.MethodGet, "/api/about", nil)
	ts.Do(http.MethodGet, "/api/config", nil)
	if n := gh.calls.Load(); n != 0 {
		t.Fatalf("GitHub asked %d times before the releases were, want 0", n)
	}
	getReleases(t, ts)
	if n := gh.calls.Load(); n != 1 {
		t.Errorf("GitHub asked %d times, want 1", n)
	}
}

func TestAnAnswerFromGitHubIsKeptForAnHour(t *testing.T) {
	gh := newFakeGitHub(t, release("v0.4.0", day0, ""))
	c := &clock{now: day0}
	ts := releasesServer(t, gh, tagged("v0.4.0"), func(cfg *app.Config) { cfg.Now = c.Now })

	getReleases(t, ts)
	gh.releases = append(gh.releases, release("v0.5.0", day0.Add(time.Minute), ""))
	c.now = day0.Add(59 * time.Minute)
	if got := getReleases(t, ts); gh.calls.Load() != 1 || got.Latest.Tag != "v0.4.0" {
		t.Errorf("after 59 minutes: GitHub asked %d times, latest %s; want 1, v0.4.0", gh.calls.Load(), got.Latest.Tag)
	}
	c.now = day0.Add(time.Hour)
	if got := getReleases(t, ts); gh.calls.Load() != 2 || got.Latest.Tag != "v0.5.0" {
		t.Errorf("after an hour: GitHub asked %d times, latest %s; want 2, v0.5.0", gh.calls.Load(), got.Latest.Tag)
	}
}

func TestAFailedCheckIsSaidAndKeptForFiveMinutes(t *testing.T) {
	for _, status := range []int{http.StatusForbidden, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			gh := newFakeGitHub(t, release("v0.4.0", day0, ""))
			gh.status = status
			c := &clock{now: day0}
			ts := releasesServer(t, gh, tagged("v0.4.0"), func(cfg *app.Config) { cfg.Now = c.Now })

			got := getReleases(t, ts)
			if got.Check != "failed" || got.Verdict != "" || got.Latest != nil || len(got.Releases) != 0 {
				t.Errorf("report = %+v, want failed, with nothing else but the releases link", got)
			}
			if got.ReleasesURL != "https://github.com/xKirtle/bandmate/releases" {
				t.Errorf("releases link = %q, want the repository's releases page", got.ReleasesURL)
			}

			gh.status = 0
			c.now = day0.Add(4*time.Minute + 59*time.Second)
			if got := getReleases(t, ts); gh.calls.Load() != 1 || got.Check != "failed" {
				t.Errorf("after 4m59s: GitHub asked %d times, check %s; want 1, failed", gh.calls.Load(), got.Check)
			}
			c.now = day0.Add(5 * time.Minute)
			if got := getReleases(t, ts); gh.calls.Load() != 2 || got.Check != "ok" {
				t.Errorf("after 5m: GitHub asked %d times, check %s; want 2, ok", gh.calls.Load(), got.Check)
			}
		})
	}
}

func TestAnUnreachableGitHubIsAFailedCheck(t *testing.T) {
	gh := newFakeGitHub(t)
	gh.srv.Close()
	got := getReleases(t, releasesServer(t, gh, tagged("v0.4.0")))
	if got.Check != "failed" {
		t.Errorf("check = %q, want failed", got.Check)
	}
}

func TestOnlyARepositoryOnGitHubIsChecked(t *testing.T) {
	for name, source := range map[string]string{
		"another host":             "https://codeberg.org/xKirtle/bandmate",
		"a host that only ends so": "https://notgithub.com/xKirtle/bandmate",
		"plain HTTP":               "http://github.com/xKirtle/bandmate",
	} {
		t.Run(name, func(t *testing.T) {
			gh := newFakeGitHub(t, release("v0.4.0", day0, ""))
			b := build.Resolve(build.Stamps{Version: "v0.4.0", SourceURL: source}, nil)
			got := getReleases(t, releasesServer(t, gh, b))
			if got.Check != "off" || got.ReleasesURL != source+"/releases" || got.Latest != nil || len(got.Releases) != 0 {
				t.Errorf("report = %+v, want off, with only the link to %s/releases", got, source)
			}
			if n := gh.calls.Load(); n != 0 {
				t.Errorf("GitHub asked %d times, want 0", n)
			}
		})
	}
}

func TestTurningTheCheckOffNeverAsksGitHub(t *testing.T) {
	gh := newFakeGitHub(t, release("v0.5.0", day0, ""))
	got := getReleases(t, releasesServer(t, gh, tagged("v0.4.0"), func(c *app.Config) { c.UpdateCheckOff = true }))
	if got.Check != "off" || got.Verdict != "" || got.Latest != nil || len(got.Releases) != 0 {
		t.Errorf("report = %+v, want off, with nothing else but the releases link", got)
	}
	if got.ReleasesURL != "https://github.com/xKirtle/bandmate/releases" {
		t.Errorf("releases link = %q, want the repository's releases page", got.ReleasesURL)
	}
	if n := gh.calls.Load(); n != 0 {
		t.Errorf("GitHub asked %d times, want 0", n)
	}
}

func TestTheVerdictComparesTheRunningReleaseWithTheLatest(t *testing.T) {
	cases := map[string]struct {
		running build.Info
		verdict string
	}{
		"the latest release is up to date":                               {tagged("v0.10.0"), "upToDate"},
		"a release newer than the latest is up to date":                  {tagged("v0.11.0"), "upToDate"},
		"an older release, by number not by text, is offered the latest": {tagged("v0.9.0"), "updateAvailable"},
		"a pre-release of the latest is offered it":                      {tagged("v0.10.0-rc.1"), "updateAvailable"},
		"an untagged build gets no verdict":                              {untagged, ""},
		"a dev build gets no verdict":                                    {build.Info{Version: "dev", ReleasesURL: "https://github.com/xKirtle/bandmate/releases"}, ""},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			gh := newFakeGitHub(t, release("v0.10.0", day0, ""), release("v0.9.0", day0.AddDate(0, 0, -7), ""))
			got := getReleases(t, releasesServer(t, gh, c.running))
			if got.Check != "ok" || got.Verdict != c.verdict {
				t.Errorf("check, verdict = %q, %q, want ok, %q", got.Check, got.Verdict, c.verdict)
			}
			if got.Latest == nil || got.Latest.Tag != "v0.10.0" {
				t.Errorf("latest = %+v, want v0.10.0", got.Latest)
			}
		})
	}
}

func TestTheRecentReleasesAreListedNewestFirstWithoutDraftsOrPreReleases(t *testing.T) {
	var published []ghRelease
	// Twelve releases, v0.1.0 to v0.12.0, a week apart, listed oldest first.
	for i := 1; i <= 12; i++ {
		published = append(published, release(fmt.Sprintf("v0.%d.0", i), day0.AddDate(0, 0, 7*(i-12)), ""))
	}
	draft := release("v0.13.0", time.Time{}, "")
	draft.Draft = true
	candidate := release("v0.13.0-rc.1", day0.AddDate(0, 0, 1), "")
	candidate.Prerelease = true
	gh := newFakeGitHub(t, append(published, draft, candidate)...)

	got := getReleases(t, releasesServer(t, gh, tagged("v0.8.0")))

	var tags, running []string
	for _, r := range got.Releases {
		tags = append(tags, r.Tag)
		if r.Running {
			running = append(running, r.Tag)
		}
	}
	want := []string{"v0.12.0", "v0.11.0", "v0.10.0", "v0.9.0", "v0.8.0", "v0.7.0", "v0.6.0", "v0.5.0", "v0.4.0", "v0.3.0"}
	if !slices.Equal(tags, want) {
		t.Errorf("releases = %v, want %v", tags, want)
	}
	if !slices.Equal(running, []string{"v0.8.0"}) {
		t.Errorf("running = %v, want [v0.8.0]", running)
	}
	if got.Latest == nil || got.Latest.Tag != "v0.12.0" {
		t.Errorf("latest = %+v, want v0.12.0", got.Latest)
	}
	first := got.Releases[0]
	if first.URL != "https://github.com/xKirtle/bandmate/releases/tag/v0.12.0" || !first.PublishedAt.Equal(day0) {
		t.Errorf("first = %+v, want v0.12.0's page, published %v", first, day0)
	}
}
