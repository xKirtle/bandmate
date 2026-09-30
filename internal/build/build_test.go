package build_test

import (
	"runtime/debug"
	"testing"

	"github.com/xKirtle/bandmate/internal/build"
)

const sha = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d"

const home = "https://github.com/xKirtle/bandmate"

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

func TestResolve(t *testing.T) {
	cases := []struct {
		name   string
		stamps build.Stamps
		info   *debug.BuildInfo
		want   build.Info
	}{
		{
			name:   "a tagged release shows its tag and links to it",
			stamps: build.Stamps{Version: "v0.4.0", Revision: sha, SourceURL: "https://github.com/someone/fork"},
			want:   build.Info{Version: "v0.4.0", Revision: sha, SourceURL: "https://github.com/someone/fork/tree/v0.4.0"},
		},
		{
			name:   "an untagged image shows its short commit and links to the full one",
			stamps: build.Stamps{Revision: sha, SourceURL: "https://github.com/someone/fork"},
			want:   build.Info{Version: "1a2b3c4", Revision: sha, SourceURL: "https://github.com/someone/fork/tree/" + sha},
		},
		{
			name: "a plain go build takes the commit from Go's build info",
			info: fromCheckout(sha, false),
			want: build.Info{Version: "1a2b3c4", Revision: sha, SourceURL: home + "/tree/" + sha},
		},
		{
			name: "a build from a modified tree is marked dirty",
			info: fromCheckout(sha, true),
			want: build.Info{Version: "1a2b3c4-dirty", Revision: sha, SourceURL: home + "/tree/" + sha},
		},
		{
			name:   "a stamped commit wins over Go's build info",
			stamps: build.Stamps{Revision: sha},
			info:   fromCheckout("ffffffffffffffffffffffffffffffffffffffff", true),
			want:   build.Info{Version: "1a2b3c4", Revision: sha, SourceURL: home + "/tree/" + sha},
		},
		{
			name: "nothing known is dev, linking to the repository's home page",
			info: &debug.BuildInfo{},
			want: build.Info{Version: "dev", SourceURL: home},
		},
		{
			name: "no build info at all is dev too",
			want: build.Info{Version: "dev", SourceURL: home},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := build.Resolve(c.stamps, c.info); got != c.want {
				t.Errorf("Resolve() = %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestShortRevision(t *testing.T) {
	if got := (build.Info{Version: "v0.4.0", Revision: sha}).ShortRevision(); got != "1a2b3c4" {
		t.Errorf("ShortRevision() = %q, want 1a2b3c4", got)
	}
	if got := (build.Info{Version: "dev"}).ShortRevision(); got != "" {
		t.Errorf("ShortRevision() with no commit = %q, want empty", got)
	}
}
