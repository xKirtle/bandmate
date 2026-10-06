package fetches

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Source is where the yt-dlp in use comes from.
type Source string

const (
	// Bundled is the image's own yt-dlp, or one mounted over it.
	Bundled Source = "bundled"
	// Updated is the copy in the data folder that Update brought up to date.
	Updated Source = "updated"
)

// InUse is the yt-dlp fetches run.
type InUse struct {
	Version string `json:"version"`
	Source  Source `json:"source"`
	path    string
}

// Outcome is what updating yt-dlp did.
type Outcome string

const (
	// UpToDate: there's no newer yt-dlp than the one in use.
	UpToDate Outcome = "upToDate"
	// UpdatedTo: a newer yt-dlp is in use, in the data folder.
	UpdatedTo Outcome = "updated"
	// CantRun: the data folder can't run programs, e.g. it's mounted
	// noexec, so the yt-dlp in use is kept.
	CantRun Outcome = "cantRun"
)

// Update is what updating yt-dlp did, and the yt-dlp in use after it.
type Update struct {
	Outcome Outcome `json:"outcome"`
	InUse
}

// updateTimeout stops a self-update that takes longer: it's one download
// from GitHub.
const updateTimeout = 5 * time.Minute

// versionTimeout stops yt-dlp taking longer to say its version.
const versionTimeout = 30 * time.Second

// YtDlp is the yt-dlp fetches run: of the bundled one (or one mounted over
// it) and the copy Update keeps in the data folder, whichever runs and is
// newer, so an old update never shadows a fresher bundled one after
// Bandmate is upgraded.
type YtDlp struct {
	bundled string
	// dir holds the updated copy. Empty means there's none.
	dir string
	// updating lets one update run at a time.
	updating sync.Mutex
	mu       sync.Mutex
	// inUse is the yt-dlp in use, once found.
	inUse *InUse
}

// NewYtDlp picks between bundled, a path or a name on the PATH ("" for
// "yt-dlp"), and an updated copy in dir.
func NewYtDlp(bundled, dir string) *YtDlp {
	if bundled == "" {
		bundled = "yt-dlp"
	}
	return &YtDlp{bundled: bundled, dir: dir}
}

func (y *YtDlp) updated() string { return filepath.Join(y.dir, "yt-dlp") }

// InUse says which yt-dlp fetches run, finding it the first time: of the
// bundled one and the updated copy, whichever runs and is newer, the
// bundled one when they're the same. It refuses with Missing when neither
// runs.
func (y *YtDlp) InUse(ctx context.Context) (InUse, error) {
	y.mu.Lock()
	defer y.mu.Unlock()
	if y.inUse != nil {
		return *y.inUse, nil
	}
	type candidate struct {
		path   string
		source Source
	}
	candidates := []candidate{{y.bundled, Bundled}}
	if y.dir != "" {
		candidates = append(candidates, candidate{y.updated(), Updated})
	}
	var found *InUse
	for _, c := range candidates {
		path, err := exec.LookPath(c.path)
		if err != nil {
			continue
		}
		v, err := version(ctx, path)
		if err != nil {
			log.Printf("asking yt-dlp %s its version: %v", path, err)
			continue
		}
		if found == nil || newer(v, found.Version) {
			found = &InUse{Version: v, Source: c.source, path: path}
		}
	}
	if found == nil {
		return InUse{}, refused(Missing, missingYtDlp)
	}
	y.inUse = found
	return *found, nil
}

const missingYtDlp = "Adding from a link needs yt-dlp, which this Bandmate can't find."

// path is the yt-dlp to run: the one in use, or the bundled one when none
// runs, for running it to say why.
func (y *YtDlp) path(ctx context.Context) string {
	if in, err := y.InUse(ctx); err == nil {
		return in.path
	}
	return y.bundled
}

// Update runs yt-dlp's own self-update on a copy of the one in use, in the
// data folder, and uses the copy from then on if it's newer and runs. A copy
// that can't run there keeps the one in use, saying so with CantRun.
func (y *YtDlp) Update(ctx context.Context) (Update, error) {
	y.updating.Lock()
	defer y.updating.Unlock()
	current, err := y.InUse(ctx)
	if err != nil {
		return Update{}, err
	}
	if y.dir == "" {
		return Update{}, errors.New("no folder to keep an updated yt-dlp in")
	}
	ctx, cancel := context.WithTimeout(ctx, updateTimeout)
	defer cancel()
	if err := os.MkdirAll(y.dir, 0o755); err != nil {
		return Update{}, fmt.Errorf("making the updated yt-dlp's folder: %w", err)
	}
	next := y.updated() + ".next"
	defer os.Remove(next)
	if err := copyProgram(current.path, next); err != nil {
		return Update{}, fmt.Errorf("copying yt-dlp to update it: %w", err)
	}
	if _, err := version(ctx, next); err != nil {
		log.Printf("running yt-dlp from the data folder: %v", err)
		return Update{Outcome: CantRun, InUse: current}, nil
	}
	if _, err := runProgram(ctx, next, "--ignore-config", "-U"); err != nil {
		if ctx.Err() != nil {
			return Update{}, ctx.Err()
		}
		log.Printf("updating yt-dlp: %v", err)
		return Update{}, refused(Failed, "Couldn't update yt-dlp. Try again, and if it keeps failing, Bandmate's log says why.")
	}
	// The update is used only once it's seen to run.
	v, err := version(ctx, next)
	if err != nil {
		log.Printf("running the updated yt-dlp from the data folder: %v", err)
		return Update{Outcome: CantRun, InUse: current}, nil
	}
	if !newer(v, current.Version) {
		return Update{Outcome: UpToDate, InUse: current}, nil
	}
	if err := os.Rename(next, y.updated()); err != nil {
		return Update{}, fmt.Errorf("keeping the updated yt-dlp: %w", err)
	}
	in := InUse{Version: v, Source: Updated, path: y.updated()}
	y.mu.Lock()
	y.inUse = &in
	y.mu.Unlock()
	return Update{Outcome: UpdatedTo, InUse: in}, nil
}

// version asks the yt-dlp at path its version, e.g. 2026.08.19.
func version(ctx context.Context, path string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, versionTimeout)
	defer cancel()
	out, err := runProgram(ctx, path, "--version")
	if err != nil {
		return "", err
	}
	v := strings.TrimSpace(string(out))
	if v == "" {
		return "", errors.New("yt-dlp gave no version")
	}
	return v, nil
}

// newer says whether yt-dlp version a is newer than b. Its versions are
// dates, e.g. 2026.08.19, with a nightly's time after, e.g.
// 2026.08.19.233512, so they compare part by part, as numbers.
func newer(a, b string) bool {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := range max(len(as), len(bs)) {
		x, y := part(as, i), part(bs, i)
		if x != y {
			return x > y
		}
	}
	return false
}

// part is a version's ith part as a number, 0 when it's missing or isn't
// one.
func part(parts []string, i int) int {
	if i >= len(parts) {
		return 0
	}
	n, _ := strconv.Atoi(parts[i])
	return n
}

// copyProgram copies the program at from to to, runnable.
func copyProgram(from, to string) error {
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(to, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	if err := dst.Close(); err != nil {
		return err
	}
	return os.Chmod(to, 0o755)
}

// runProgram runs a program, returning what it printed. It's stopped, with
// anything it started, when ctx is done.
func runProgram(ctx context.Context, path string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, path, args...)
	stopTogether(cmd)
	cmd.WaitDelay = 5 * time.Second
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return out, &ytDlpError{err: err, stderr: stderr.String()}
	}
	return out, nil
}
