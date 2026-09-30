// Package build says which Bandmate is running and where its source is, as
// the About page shows it. AGPL-3.0 §13 asks anyone running a modified
// Bandmate over a network to offer its users that version's source, so the
// link points at exactly the running version.
//
// The release build stamps the variables below with -ldflags -X (see the
// Dockerfile):
//
//	-X github.com/xKirtle/bandmate/internal/build.version=v0.4.0
//	-X github.com/xKirtle/bandmate/internal/build.revision=<full commit>
//	-X github.com/xKirtle/bandmate/internal/build.sourceURL=https://github.com/<owner>/<repo>
package build

import (
	"runtime/debug"
	"strings"
)

// Stamped at build time; empty when not.
var (
	version   string
	revision  string
	sourceURL string
)

// DefaultSourceURL is where the source is when the build didn't say.
const DefaultSourceURL = "https://github.com/xKirtle/bandmate"

// Stamps are what the build stamped into the binary, each empty when unset.
type Stamps struct {
	// Version is the release tag, e.g. v0.4.0. Only tagged builds have one.
	Version string
	// Revision is the full commit the build came from.
	Revision string
	// SourceURL is the repository the build came from.
	SourceURL string
}

// Info is the running build, as shown to the user.
type Info struct {
	// Version is the release tag, else the short commit (with -dirty if built
	// from a modified tree), else "dev".
	Version string `json:"version"`
	// Revision is the full commit, or empty when unknown.
	Revision string `json:"revision"`
	// SourceURL links to exactly this version's source: the tag's tree, else
	// the commit's, else the repository's home page.
	SourceURL string `json:"sourceUrl"`
	// BugReportURL is where to report a bug: the new-issue page of the
	// repository the build came from.
	BugReportURL string `json:"bugReportUrl"`
}

// Current is the running binary's build.
func Current() Info {
	bi, _ := debug.ReadBuildInfo()
	return Resolve(Stamps{Version: version, Revision: revision, SourceURL: sourceURL}, bi)
}

// Resolve works out the build from its stamps, falling back to the commit in
// Go's build info (which a plain go build in a checkout records), then to
// "dev". bi may be nil.
func Resolve(s Stamps, bi *debug.BuildInfo) Info {
	source := s.SourceURL
	if source == "" {
		source = DefaultSourceURL
	}
	source = strings.TrimSuffix(source, "/")

	commit, dirty := s.Revision, false
	if commit == "" {
		commit, dirty = vcsRevision(bi)
	}

	info := Info{Version: s.Version, Revision: commit, SourceURL: source, BugReportURL: source + "/issues/new/choose"}
	switch {
	case s.Version != "":
		info.SourceURL = source + "/tree/" + s.Version
	case commit != "":
		info.Version = short(commit)
		if dirty {
			info.Version += "-dirty"
		}
		info.SourceURL = source + "/tree/" + commit
	default:
		info.Version = "dev"
	}
	return info
}

// ShortRevision is the commit abbreviated as Git shows it, or empty when
// unknown.
func (i Info) ShortRevision() string { return short(i.Revision) }

func short(commit string) string {
	if len(commit) > 7 {
		return commit[:7]
	}
	return commit
}

// vcsRevision is the commit Go recorded in the build info, and whether the
// tree it was built from had changes.
func vcsRevision(bi *debug.BuildInfo) (commit string, modified bool) {
	if bi == nil {
		return "", false
	}
	for _, s := range bi.Settings {
		switch s.Key {
		case "vcs.revision":
			commit = s.Value
		case "vcs.modified":
			modified = s.Value == "true"
		}
	}
	return commit, modified
}
