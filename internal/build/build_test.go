package build_test

import (
	"runtime/debug"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/build"
)

// These go through the package, not the HTTP API: the build's stamps are
// fixed when the binary is built, so the API can't vary them.

const sha = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d"

const home = "https://github.com/xKirtle/bandmate"

const fork = "https://github.com/someone/fork"

// fromCheckout is the build info a plain go build in a Git checkout records.
func fromCheckout(revision string, modified bool) *debug.BuildInfo {
	m := "false"
	if modified {
		m = "true"
	}
	return &debug.BuildInfo{Settings: []debug.BuildSetting{
		{Key: "vcs", Value: "git"},
		{Key: "vcs.revision", Value: revision},
		{Key: "vcs.modified", Value: m},
	}}
}

func TestTheVersionShownAndItsLinksFollowWhatTheBuildKnows(t *testing.T) {
	cases := map[string]struct {
		stamps build.Stamps
		info   *debug.BuildInfo
		want   build.Info
	}{
		"a tagged release shows its tag and links to it": {
			stamps: build.Stamps{Version: "v0.4.0", Revision: sha, SourceURL: fork},
			want:   build.Info{Version: "v0.4.0", Revision: sha, SourceURL: fork + "/tree/v0.4.0", BugReportURL: fork + "/issues/new/choose", ReleasesURL: fork + "/releases"},
		},
		"an untagged image shows its short commit and links to the full one": {
			stamps: build.Stamps{Revision: sha, SourceURL: fork},
			want:   build.Info{Version: "1a2b3c4", Revision: sha, SourceURL: fork + "/tree/" + sha, BugReportURL: fork + "/issues/new/choose", ReleasesURL: fork + "/releases"},
		},
		"a source URL ending in a slash still makes clean links": {
			stamps: build.Stamps{Version: "v0.4.0", SourceURL: fork + "/"},
			want:   build.Info{Version: "v0.4.0", SourceURL: fork + "/tree/v0.4.0", BugReportURL: fork + "/issues/new/choose", ReleasesURL: fork + "/releases"},
		},
		"a plain go build takes the commit from Go's build info": {
			info: fromCheckout(sha, false),
			want: build.Info{Version: "1a2b3c4", Revision: sha, SourceURL: home + "/tree/" + sha, BugReportURL: home + "/issues/new/choose", ReleasesURL: home + "/releases"},
		},
		"a build from a modified tree is marked dirty": {
			info: fromCheckout(sha, true),
			want: build.Info{Version: "1a2b3c4-dirty", Revision: sha, SourceURL: home + "/tree/" + sha, BugReportURL: home + "/issues/new/choose", ReleasesURL: home + "/releases"},
		},
		"a stamped commit wins over Go's build info": {
			stamps: build.Stamps{Revision: sha},
			info:   fromCheckout("ffffffffffffffffffffffffffffffffffffffff", true),
			want:   build.Info{Version: "1a2b3c4", Revision: sha, SourceURL: home + "/tree/" + sha, BugReportURL: home + "/issues/new/choose", ReleasesURL: home + "/releases"},
		},
		"nothing known is dev, linking to the repository's home page": {
			info: &debug.BuildInfo{},
			want: build.Info{Version: "dev", SourceURL: home, BugReportURL: home + "/issues/new/choose", ReleasesURL: home + "/releases"},
		},
		"no build info at all is dev too": {
			want: build.Info{Version: "dev", SourceURL: home, BugReportURL: home + "/issues/new/choose", ReleasesURL: home + "/releases"},
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if got := build.Resolve(c.stamps, c.info); got != c.want {
				t.Errorf("Resolve() = %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestTheShortRevisionIsTheCommitAsGitAbbreviatesIt(t *testing.T) {
	if got := (build.Info{Version: "v0.4.0", Revision: sha}).ShortRevision(); got != "1a2b3c4" {
		t.Errorf("ShortRevision() = %q, want 1a2b3c4", got)
	}
	if got := (build.Info{Version: "dev"}).ShortRevision(); got != "" {
		t.Errorf("ShortRevision() with no commit = %q, want empty", got)
	}
}

func TestTheCommitDateComesFromGoBuildInfoWhenItIsForTheCommitShown(t *testing.T) {
	committed := time.Date(2026, 9, 29, 14, 3, 0, 0, time.UTC)
	withTime := fromCheckout(sha, false)
	withTime.Settings = append(withTime.Settings, debug.BuildSetting{Key: "vcs.time", Value: "2026-09-29T14:03:00Z"})

	cases := map[string]struct {
		stamps build.Stamps
		info   *debug.BuildInfo
		want   time.Time
	}{
		"a plain go build knows when its commit was made": {
			info: withTime,
			want: committed,
		},
		"a stamped commit that Go's build info agrees on keeps the date": {
			stamps: build.Stamps{Version: "v0.4.0", Revision: sha},
			info:   withTime,
			want:   committed,
		},
		"a stamped commit that Go's build info doesn't know has no date": {
			stamps: build.Stamps{Revision: "ffffffffffffffffffffffffffffffffffffffff"},
			info:   withTime,
		},
		"a build with no version control information has no date": {
			stamps: build.Stamps{Version: "v0.4.0", Revision: sha},
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if got := build.Resolve(c.stamps, c.info).CommitTime; !got.Equal(c.want) {
				t.Errorf("CommitTime = %v, want %v", got, c.want)
			}
		})
	}
}
