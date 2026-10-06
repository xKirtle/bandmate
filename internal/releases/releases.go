// Package releases tells the About page whether a newer Bandmate has been
// released, and what the recent releases changed, from GitHub's releases API
// for the repository the build came from.
//
// It's asked only when the About page is opened, never in the background,
// and only for a repository on github.com. The answer is remembered for a while, so opening
// the page again doesn't ask again.
package releases

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/xKirtle/bandmate/internal/build"
)

// DefaultAPI is GitHub's REST API.
const DefaultAPI = "https://api.github.com"

// shown is how many of the recent releases a Report lists.
const shown = 10

// How long an answer from GitHub is remembered: a success for long enough
// not to ask on every visit, a failure (offline, rate-limited, down) for
// long enough not to hammer GitHub but short enough to recover soon.
const (
	keepSuccess = time.Hour
	keepFailure = 5 * time.Minute
)

// askTimeout caps how long GitHub is waited for.
const askTimeout = 10 * time.Second

// Check says whether GitHub was asked, and how that went.
type Check string

const (
	// Checked: GitHub answered.
	Checked Check = "ok"
	// Off: GitHub wasn't asked, because the check is turned off or the build's
	// repository isn't on github.com.
	Off Check = "off"
	// Failed: GitHub couldn't be asked, or didn't answer.
	Failed Check = "failed"
)

// Verdict compares the running build with the latest release.
type Verdict string

const (
	// UpToDate: the running release is the latest, or newer.
	UpToDate Verdict = "upToDate"
	// UpdateAvailable: a newer release than the running one exists.
	UpdateAvailable Verdict = "updateAvailable"
	// NoVerdict: the build isn't a release (a commit, or dev), so there's
	// nothing to compare, only the latest release to name.
	NoVerdict Verdict = ""
)

// Report is what the About page shows about releases.
type Report struct {
	Check Check `json:"check"`
	// ReleasesURL is the repository's releases page, which the page links to
	// whatever the Check.
	ReleasesURL string  `json:"releasesUrl"`
	Verdict     Verdict `json:"verdict,omitempty"`
	// Latest is the highest release, when checked and there is one.
	Latest *Link `json:"latest,omitempty"`
	// Releases are the recent releases, newest first, at most shown of them.
	Releases []Release `json:"releases"`
}

// Link names a release and links to its page.
type Link struct {
	Tag string `json:"tag"`
	URL string `json:"url"`
}

// Release is a published release, with its notes.
type Release struct {
	Tag         string    `json:"tag"`
	Name        string    `json:"name"`
	URL         string    `json:"url"`
	PublishedAt time.Time `json:"publishedAt"`
	// Running tells whether it's the running build's release.
	Running bool   `json:"running"`
	Notes   []Note `json:"notes"`
}

// Options configure a Checker.
type Options struct {
	// Off turns the check off: GitHub is never asked.
	Off bool
	// API is GitHub's REST API base URL. Empty means DefaultAPI.
	API string
	// Now tells the time, for how long answers are kept. Nil means time.Now.
	Now func() time.Time
}

// Checker asks GitHub for releases, remembering its answer for a while.
type Checker struct {
	off bool
	api string
	now func() time.Time

	// mu is held while GitHub is asked, so visits at the same time ask once.
	mu sync.Mutex
	// cached is GitHub's last answer. The build, and so its repository, is
	// fixed, so there's only ever one.
	cached answer
}

// answer is what GitHub said about the repository's releases, and until
// when it's kept. The zero answer has expired.
type answer struct {
	releases []ghRelease
	err      error
	until    time.Time
}

// New makes a Checker.
func New(o Options) *Checker {
	c := &Checker{off: o.Off, api: strings.TrimSuffix(o.API, "/"), now: o.Now}
	if c.api == "" {
		c.api = DefaultAPI
	}
	if c.now == nil {
		c.now = time.Now
	}
	return c
}

// Report tells how the running build b stands against its repository's
// releases, asking GitHub unless it recently has.
func (c *Checker) Report(ctx context.Context, b build.Info) Report {
	r := Report{Check: Off, ReleasesURL: b.ReleasesURL, Releases: []Release{}}
	repo, ok := githubRepo(b.ReleasesURL)
	if c.off || !ok {
		return r
	}
	published, err := c.releases(ctx, repo)
	if err != nil {
		r.Check = Failed
		return r
	}
	r.Check = Checked
	for i, gr := range published {
		if i == shown {
			break
		}
		r.Releases = append(r.Releases, Release{
			Tag: gr.TagName, Name: gr.Name, URL: gr.HTMLURL, PublishedAt: gr.PublishedAt,
			Running: gr.TagName == b.Version, Notes: parse(gr.Body),
		})
	}
	if latest, ok := highest(published); ok {
		r.Latest = &Link{Tag: latest.TagName, URL: latest.HTMLURL}
		r.Verdict = verdict(b.Version, latest.TagName)
	}
	return r
}

// highest is the release with the highest version, which isn't always the
// newest: a fix to an older line may be published after a newer release.
// published is newest first, so when no tag is a version, the newest is.
func highest(published []ghRelease) (ghRelease, bool) {
	if len(published) == 0 {
		return ghRelease{}, false
	}
	best := published[0]
	bestVersion, bestIsVersion := parseVersion(best.TagName)
	for _, r := range published[1:] {
		v, ok := parseVersion(r.TagName)
		if ok && (!bestIsVersion || compareVersions(v, bestVersion) > 0) {
			best, bestVersion, bestIsVersion = r, v, true
		}
	}
	return best, true
}

// verdict compares the running version with the latest release's tag. Only
// a running version that's a release tag gets one, and only against a latest
// release that's one too.
func verdict(running, latest string) Verdict {
	ours, ok := parseVersion(running)
	if !ok {
		return NoVerdict
	}
	theirs, ok := parseVersion(latest)
	switch {
	case !ok:
		return NoVerdict
	case compareVersions(theirs, ours) > 0:
		return UpdateAvailable
	}
	return UpToDate
}

// githubRepo is "owner/repo" from a releases page on github.com, e.g.
// https://github.com/xKirtle/bandmate/releases. ok is false for any other
// host.
func githubRepo(releasesURL string) (repo string, ok bool) {
	u, err := url.Parse(releasesURL)
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Host, "github.com") {
		return "", false
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] != "releases" {
		return "", false
	}
	return parts[0] + "/" + parts[1], true
}

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

// releases are repo's published releases, newest first, without drafts or
// pre-releases: remembered, or else asked of GitHub.
func (c *Checker) releases(ctx context.Context, repo string) ([]ghRelease, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.now().Before(c.cached.until) {
		return c.cached.releases, c.cached.err
	}
	// A visitor leaving the page mustn't make the failure be remembered.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), askTimeout)
	defer cancel()
	published, err := c.ask(ctx, repo)
	keep := keepSuccess
	if err != nil {
		log.Printf("checking %s's releases on GitHub: %v", repo, err)
		keep = keepFailure
	}
	c.cached = answer{releases: published, err: err, until: c.now().Add(keep)}
	return published, err
}

// ask asks GitHub for repo's releases.
func (c *Checker) ask(ctx context.Context, repo string) ([]ghRelease, error) {
	// Enough to find Shown releases among drafts and pre-releases.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.api+"/repos/"+repo+"/releases?per_page=30", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Bandmate")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub answered %s", res.Status)
	}
	var all []ghRelease
	if err := json.NewDecoder(res.Body).Decode(&all); err != nil {
		return nil, fmt.Errorf("reading GitHub's releases: %w", err)
	}
	published := slices.DeleteFunc(all, func(r ghRelease) bool { return r.Draft || r.Prerelease })
	slices.SortStableFunc(published, func(a, b ghRelease) int { return b.PublishedAt.Compare(a.PublishedAt) })
	return published, nil
}
