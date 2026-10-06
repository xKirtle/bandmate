package app_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
)

// ytDlpRelease is a stable release of yt-dlp, as GitHub names it.
func ytDlpRelease(tag string) *ghRelease {
	return &ghRelease{TagName: tag, Name: "yt-dlp " + tag, HTMLURL: "https://github.com/yt-dlp/yt-dlp/releases/tag/" + tag}
}

// ytDlpCheck is GET /api/yt-dlp/latest's response.
type ytDlpCheck struct {
	Check   string `json:"check"`
	Verdict string `json:"verdict"`
	Latest  *struct {
		Tag string `json:"tag"`
		URL string `json:"url"`
	} `json:"latest"`
}

// ytDlpServer starts Bandmate bundling a stand-in yt-dlp at version, asking
// gh for yt-dlp's latest release.
func ytDlpServer(t *testing.T, gh *fakeGitHub, version string, configure ...func(*app.Config)) *testServer {
	t.Helper()
	bundle := bundledYtDlp{version: version, latest: version}.with(t)
	return newTestServerWith(t, bundle, func(c *app.Config) {
		c.GitHubAPI = gh.srv.URL
		for _, f := range configure {
			f(c)
		}
	})
}

func (ts *testServer) ytDlpCheck() ytDlpCheck {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, "/api/yt-dlp/latest", nil)
	expectStatus(ts.t, res, http.StatusOK)
	var c ytDlpCheck
	res.JSON(ts.t, &c)
	return c
}

func TestAnOlderYtDlpHearsOfTheNewerRelease(t *testing.T) {
	gh := newFakeGitHub(t)
	gh.ytDlp = ytDlpRelease("2026.10.01")
	ts := ytDlpServer(t, gh, "2026.09.12")

	got := ts.ytDlpCheck()

	if got.Check != "ok" || got.Verdict != "updateAvailable" {
		t.Errorf("check = %q, verdict = %q, want ok, updateAvailable", got.Check, got.Verdict)
	}
	if got.Latest == nil || got.Latest.Tag != "2026.10.01" || got.Latest.URL != "https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.01" {
		t.Errorf("latest = %+v, want 2026.10.01 and its page", got.Latest)
	}
}

func TestTheLatestYtDlpIsUpToDate(t *testing.T) {
	gh := newFakeGitHub(t)
	gh.ytDlp = ytDlpRelease("2026.09.12")
	ts := ytDlpServer(t, gh, "2026.09.12")

	got := ts.ytDlpCheck()

	if got.Check != "ok" || got.Verdict != "upToDate" {
		t.Errorf("check = %q, verdict = %q, want ok, upToDate", got.Check, got.Verdict)
	}
}

func TestAYtDlpNewerThanTheLatestReleaseIsUpToDate(t *testing.T) {
	gh := newFakeGitHub(t)
	gh.ytDlp = ytDlpRelease("2026.09.12")
	// A nightly, mounted over the bundled one.
	ts := ytDlpServer(t, gh, "2026.09.12.233512")

	got := ts.ytDlpCheck()

	if got.Verdict != "upToDate" {
		t.Errorf("verdict = %q, want upToDate", got.Verdict)
	}
}

func TestTurnedOffUpdateCheckDoesntAskGitHubForYtDlp(t *testing.T) {
	gh := newFakeGitHub(t)
	gh.ytDlp = ytDlpRelease("2026.10.01")
	ts := ytDlpServer(t, gh, "2026.09.12", func(c *app.Config) { c.UpdateCheckOff = true })

	got := ts.ytDlpCheck()

	if got.Check != "off" || got.Verdict != "" || got.Latest != nil {
		t.Errorf("check = %+v, want off with no verdict or latest", got)
	}
	if n := gh.calls.Load(); n != 0 {
		t.Errorf("GitHub was asked %d times, want 0", n)
	}
}

func TestAYtDlpCheckGitHubCantAnswerSaysItFailed(t *testing.T) {
	gh := newFakeGitHub(t)
	gh.ytDlp = ytDlpRelease("2026.10.01")
	gh.status = http.StatusForbidden
	ts := ytDlpServer(t, gh, "2026.09.12")

	got := ts.ytDlpCheck()

	if got.Check != "failed" || got.Verdict != "" || got.Latest != nil {
		t.Errorf("check = %+v, want failed with no verdict or latest", got)
	}
}

func TestYtDlpsLatestReleaseIsRememberedForAWhile(t *testing.T) {
	gh := newFakeGitHub(t)
	gh.ytDlp = ytDlpRelease("2026.10.01")
	clk := &clock{now: day0}
	ts := ytDlpServer(t, gh, "2026.09.12", func(c *app.Config) { c.Now = clk.Now })

	ts.ytDlpCheck()
	ts.ytDlpCheck()
	if n := gh.calls.Load(); n != 1 {
		t.Fatalf("GitHub was asked %d times for two visits, want 1", n)
	}
	clk.now = clk.now.Add(2 * time.Hour)
	ts.ytDlpCheck()
	if n := gh.calls.Load(); n != 2 {
		t.Errorf("GitHub was asked %d times after two hours, want 2", n)
	}
}

func TestTurnedOffAddingFromALinkHasNoYtDlpToCheck(t *testing.T) {
	gh := newFakeGitHub(t)
	ts := ytDlpServer(t, gh, "2026.09.12", func(c *app.Config) { c.AddFromLinkOff = true })

	res := ts.Do(http.MethodGet, "/api/yt-dlp/latest", nil)

	expectError(t, res, http.StatusForbidden, "Adding a Beat from a link is turned off on this Bandmate.")
	if n := gh.calls.Load(); n != 0 {
		t.Errorf("GitHub was asked %d times, want 0", n)
	}
}
