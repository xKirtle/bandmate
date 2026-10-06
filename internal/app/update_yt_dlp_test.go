package app_test

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/xKirtle/bandmate/internal/app"
)

// The stand-in yt-dlp's release, which a script around the test binary
// sets, so a copy of it carries its version, as a copy of yt-dlp does, and
// its self-update rewrites the copy, as yt-dlp's does.
const (
	ytDlpVersion = "BANDMATE_TEST_YT_DLP_VERSION"
	// ytDlpLatest is the release its self-update finds: "unreachable"
	// when it can't reach GitHub, and "broken" for one that won't run.
	ytDlpLatest = "BANDMATE_TEST_YT_DLP_LATEST"
	// ytDlpNoexec is a folder it can't run from, as a data folder mounted
	// noexec can't run programs.
	ytDlpNoexec = "BANDMATE_TEST_YT_DLP_NOEXEC"
	// ytDlpSelf is the script's own path, which the self-update rewrites.
	ytDlpSelf = "BANDMATE_TEST_YT_DLP_SELF"
)

// defaultFakeYtDlpVersion is the stand-in's version when no script sets it.
const defaultFakeYtDlpVersion = "2026.08.19"

// bundledYtDlp has the app bundle a stand-in yt-dlp at version, whose
// self-update finds latest. A data folder it's told can't run programs is
// noexec.
type bundledYtDlp struct {
	version, latest string
	noexec          bool
}

// with returns the configuration that bundles it into the app.
func (b bundledYtDlp) with(t *testing.T) func(*app.Config) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in yt-dlp is a shell script")
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "yt-dlp")
	return func(c *app.Config) {
		noexec := ""
		if b.noexec {
			noexec = c.DataDir
		}
		script := fmt.Sprintf("#!/bin/sh\n%s=%s\nexport %s\nexport %s=%q %s=%q\nexport %s=\"$0\"\nexec %q \"$@\"\n",
			ytDlpVersion, b.version, ytDlpVersion, ytDlpLatest, b.latest, ytDlpNoexec, noexec, ytDlpSelf, exe)
		if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
		c.YtDlp = path
	}
}

// ytDlpInUse is the yt-dlp fetches use, as the API returns it.
type ytDlpInUse struct {
	Version string `json:"version"`
	Source  string `json:"source"`
}

func (ts *testServer) ytDlpInUse() ytDlpInUse {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, "/api/yt-dlp", nil)
	expectStatus(ts.t, res, http.StatusOK)
	var y ytDlpInUse
	res.JSON(ts.t, &y)
	return y
}

// ytDlpUpdate is the outcome of updating yt-dlp, with the one then in use.
type ytDlpUpdate struct {
	Outcome string `json:"outcome"`
	Version string `json:"version"`
	Source  string `json:"source"`
}

func (ts *testServer) updateYtDlp() ytDlpUpdate {
	ts.t.Helper()
	res := ts.Do(http.MethodPost, "/api/yt-dlp/update", nil)
	expectStatus(ts.t, res, http.StatusOK)
	var u ytDlpUpdate
	res.JSON(ts.t, &u)
	return u
}

// fetchedBy fetches a link whose title the stand-in sets to its own
// version, to tell which yt-dlp fetched it.
func (ts *testServer) fetchedBy() string {
	ts.t.Helper()
	return ts.fetchLink("https://video.test/version").Title
}

// expectNoUpdatedYtDlp fails the test if a copy of yt-dlp was left in the
// data folder.
func (ts *testServer) expectNoUpdatedYtDlp() {
	ts.t.Helper()
	entries, _ := os.ReadDir(filepath.Join(ts.DataDir, "programs"))
	if len(entries) > 0 {
		ts.t.Errorf("the data folder's programs = %v, want none", entries)
	}
}

func TestAboutShowsTheBundledYtDlp(t *testing.T) {
	ts := newTestServerWith(t, bundledYtDlp{version: "2026.08.19", latest: "2026.08.19"}.with(t))

	got := ts.ytDlpInUse()

	if want := (ytDlpInUse{Version: "2026.08.19", Source: "bundled"}); got != want {
		t.Errorf("yt-dlp in use = %+v, want %+v", got, want)
	}
	if by := ts.fetchedBy(); by != "2026.08.19" {
		t.Errorf("fetched by yt-dlp %s, want 2026.08.19", by)
	}
}

func TestUpdatingYtDlpKeepsANewerCopyInTheDataFolderAndFetchesUseIt(t *testing.T) {
	ts := newTestServerWith(t, bundledYtDlp{version: "2026.08.19", latest: "2026.09.12"}.with(t))

	got := ts.updateYtDlp()

	if want := (ytDlpUpdate{Outcome: "updated", Version: "2026.09.12", Source: "updated"}); got != want {
		t.Errorf("update = %+v, want %+v", got, want)
	}
	if got, want := ts.ytDlpInUse(), (ytDlpInUse{Version: "2026.09.12", Source: "updated"}); got != want {
		t.Errorf("yt-dlp in use = %+v, want %+v", got, want)
	}
	if by := ts.fetchedBy(); by != "2026.09.12" {
		t.Errorf("fetched by yt-dlp %s, want the updated 2026.09.12", by)
	}

	// Updating again finds nothing newer.
	if got, want := ts.updateYtDlp(), (ytDlpUpdate{Outcome: "upToDate", Version: "2026.09.12", Source: "updated"}); got != want {
		t.Errorf("second update = %+v, want %+v", got, want)
	}
}

func TestUpdatingAnUpToDateYtDlpKeepsTheBundledOne(t *testing.T) {
	ts := newTestServerWith(t, bundledYtDlp{version: "2026.08.19", latest: "2026.08.19"}.with(t))

	got := ts.updateYtDlp()

	if want := (ytDlpUpdate{Outcome: "upToDate", Version: "2026.08.19", Source: "bundled"}); got != want {
		t.Errorf("update = %+v, want %+v", got, want)
	}
	ts.expectNoUpdatedYtDlp()
}

func TestTheNewerOfTheBundledAndUpdatedYtDlpIsUsed(t *testing.T) {
	ts := newTestServerWith(t, bundledYtDlp{version: "2026.08.19", latest: "2026.09.12"}.with(t))
	ts.updateYtDlp()

	// Bandmate is upgraded, bundling a newer yt-dlp than the update.
	ts.Stop()
	ts = startTestServer(t, ts.DataDir, bundledYtDlp{version: "2026.10.01", latest: "2026.10.01"}.with(t))
	if got, want := ts.ytDlpInUse(), (ytDlpInUse{Version: "2026.10.01", Source: "bundled"}); got != want {
		t.Errorf("after upgrading, yt-dlp in use = %+v, want %+v", got, want)
	}
	if by := ts.fetchedBy(); by != "2026.10.01" {
		t.Errorf("after upgrading, fetched by yt-dlp %s, want the bundled 2026.10.01", by)
	}

	// Rolled back, bundling an older one than the update again.
	ts.Stop()
	ts = startTestServer(t, ts.DataDir, bundledYtDlp{version: "2026.08.19", latest: "2026.10.01"}.with(t))
	if got, want := ts.ytDlpInUse(), (ytDlpInUse{Version: "2026.09.12", Source: "updated"}); got != want {
		t.Errorf("after rolling back, yt-dlp in use = %+v, want %+v", got, want)
	}
}

func TestAnUpdatedYtDlpThatWontRunFromTheDataFolderIsNotUsed(t *testing.T) {
	ts := newTestServerWith(t, bundledYtDlp{version: "2026.08.19", latest: "2026.09.12", noexec: true}.with(t))

	got := ts.updateYtDlp()

	if want := (ytDlpUpdate{Outcome: "cantRun", Version: "2026.08.19", Source: "bundled"}); got != want {
		t.Errorf("update = %+v, want %+v", got, want)
	}
	if got, want := ts.ytDlpInUse(), (ytDlpInUse{Version: "2026.08.19", Source: "bundled"}); got != want {
		t.Errorf("yt-dlp in use = %+v, want %+v", got, want)
	}
	if by := ts.fetchedBy(); by != "2026.08.19" {
		t.Errorf("fetched by yt-dlp %s, want the bundled 2026.08.19", by)
	}
	ts.expectNoUpdatedYtDlp()
}

func TestAYtDlpUpdateThatFailsSaysSo(t *testing.T) {
	ts := newTestServerWith(t, bundledYtDlp{version: "2026.08.19", latest: "unreachable"}.with(t))

	res := ts.Do(http.MethodPost, "/api/yt-dlp/update", nil)

	expectError(t, res, http.StatusBadGateway, "Couldn't update yt-dlp. Try again, and if it keeps failing, Bandmate's log says why.")
	if got, want := ts.ytDlpInUse(), (ytDlpInUse{Version: "2026.08.19", Source: "bundled"}); got != want {
		t.Errorf("yt-dlp in use = %+v, want %+v", got, want)
	}
	ts.expectNoUpdatedYtDlp()
}

func TestAYtDlpUpdateThatLeavesACopyThatWontRunIsNotUsed(t *testing.T) {
	ts := newTestServerWith(t, bundledYtDlp{version: "2026.08.19", latest: "broken"}.with(t))

	res := ts.Do(http.MethodPost, "/api/yt-dlp/update", nil)

	expectError(t, res, http.StatusBadGateway, "Couldn't update yt-dlp. Try again, and if it keeps failing, Bandmate's log says why.")
	if by := ts.fetchedBy(); by != "2026.08.19" {
		t.Errorf("fetched by yt-dlp %s, want the bundled 2026.08.19", by)
	}
	ts.expectNoUpdatedYtDlp()
}

func TestWithoutYtDlpThereIsNoneToShowOrUpdate(t *testing.T) {
	ts := newTestServerWith(t, func(c *app.Config) { c.YtDlp = filepath.Join(t.TempDir(), "no-yt-dlp") })
	missing := "Adding from a link needs yt-dlp, which this Bandmate can't find."

	expectError(t, ts.Do(http.MethodGet, "/api/yt-dlp", nil), http.StatusServiceUnavailable, missing)
	expectError(t, ts.Do(http.MethodPost, "/api/yt-dlp/update", nil), http.StatusServiceUnavailable, missing)
}

func TestTurnedOffAddingFromALinkHasNoYtDlpToShowOrUpdate(t *testing.T) {
	ts := newTestServerWith(t, bundledYtDlp{version: "2026.08.19", latest: "2026.09.12"}.with(t),
		func(c *app.Config) { c.AddFromLinkOff = true })
	off := "Adding a Beat from a link is turned off on this Bandmate."

	expectError(t, ts.Do(http.MethodGet, "/api/yt-dlp", nil), http.StatusForbidden, off)
	expectError(t, ts.Do(http.MethodPost, "/api/yt-dlp/update", nil), http.StatusForbidden, off)
	ts.expectNoUpdatedYtDlp()
}

// fakeYtDlpRelease stands in for yt-dlp's --version and self-update (-U),
// answering ok when args ask for either.
func fakeYtDlpRelease(args []string) (code int, ok bool) {
	self := os.Getenv(ytDlpSelf)
	if noexec := os.Getenv(ytDlpNoexec); noexec != "" && strings.HasPrefix(self, noexec+string(filepath.Separator)) {
		fmt.Fprintf(os.Stderr, "%s: Permission denied\n", self)
		return 126, true
	}
	version := os.Getenv(ytDlpVersion)
	if version == "" {
		version = defaultFakeYtDlpVersion
	}
	switch {
	case len(args) == 1 && args[0] == "--version":
		fmt.Println(version)
		return 0, true
	case len(args) > 0 && args[len(args)-1] == "-U":
		latest := os.Getenv(ytDlpLatest)
		switch {
		case latest == "unreachable":
			fmt.Fprintln(os.Stderr, "ERROR: Unable to obtain version info (<urlopen error [Errno -3] Temporary failure in name resolution>)")
			return 1, true
		case latest <= version:
			fmt.Printf("yt-dlp is up to date (stable@%s from yt-dlp/yt-dlp)\n", version)
			return 0, true
		}
		script, err := os.ReadFile(self)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1, true
		}
		updated := strings.Replace(string(script), ytDlpVersion+"="+version+"\n", ytDlpVersion+"="+latest+"\n", 1)
		if latest == "broken" {
			updated = "#!/bin/sh\nexit 1\n"
		}
		if err := os.WriteFile(self+".new", []byte(updated), 0o755); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1, true
		}
		if err := os.Rename(self+".new", self); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1, true
		}
		fmt.Printf("Updated yt-dlp to stable@%s from yt-dlp/yt-dlp\n", latest)
		return 0, true
	}
	return 0, false
}
