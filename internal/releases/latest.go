package releases

import (
	"context"
	"errors"
	"log"
	"strings"
	"sync"
	"time"
)

// Latest asks GitHub for one repository's latest stable release, e.g.
// yt-dlp's, which About checks the yt-dlp in use against. Like a Checker,
// it asks only when asked, and remembers the answer for a while.
type Latest struct {
	repo string
	off  bool
	api  string
	now  func() time.Time

	// mu is held while GitHub is asked, so visits at the same time ask once.
	mu     sync.Mutex
	cached latestAnswer
}

// latestAnswer is what GitHub said was the latest release, and until when
// it's kept. The zero answer has expired.
type latestAnswer struct {
	link  Link
	err   error
	until time.Time
}

// NewLatest makes a Latest for repo, "owner/repo" on github.com.
func NewLatest(repo string, o Options) *Latest {
	l := &Latest{repo: repo, off: o.Off, api: strings.TrimSuffix(o.API, "/"), now: o.Now}
	if l.api == "" {
		l.api = DefaultAPI
	}
	if l.now == nil {
		l.now = time.Now
	}
	return l
}

// Get is the repository's latest stable release, and how asking went:
// Off when the check is turned off, Failed when GitHub couldn't be asked.
func (l *Latest) Get(ctx context.Context) (Link, Check) {
	if l.off {
		return Link{}, Off
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.now().Before(l.cached.until) {
		link, err := l.ask(ctx)
		keep := keepSuccess
		if err != nil {
			log.Printf("checking %s's latest release on GitHub: %v", l.repo, err)
			keep = keepFailure
		}
		l.cached = latestAnswer{link: link, err: err, until: l.now().Add(keep)}
	}
	if l.cached.err != nil {
		return Link{}, Failed
	}
	return l.cached.link, Checked
}

// ask asks GitHub for the repository's latest release, which is never a
// draft or a pre-release.
func (l *Latest) ask(ctx context.Context) (Link, error) {
	var r ghRelease
	if err := askGitHub(ctx, l.api+"/repos/"+l.repo+"/releases/latest", &r); err != nil {
		return Link{}, err
	}
	if r.TagName == "" {
		return Link{}, errors.New("GitHub's latest release has no tag")
	}
	return Link{Tag: r.TagName, URL: r.HTMLURL}, nil
}
