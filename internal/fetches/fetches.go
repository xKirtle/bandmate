// Package fetches fetches a Beat's audio from a link with yt-dlp (ADR 0016),
// into a waiting file: the browser reads it once, to work out its duration
// and waveform and to preview it, and adding it keeps it as the Beat. A
// waiting file nobody adds is deleted after an hour, and on restart.
package fetches

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultTimeout is how long a fetch may take before it's stopped.
const DefaultTimeout = 10 * time.Minute

// Kept is how long a waiting file waits to be added.
const Kept = time.Hour

// ContentType is the type of every waiting file: an m4a.
const ContentType = "audio/mp4"

// ErrNotFound means there's no such waiting file, or no longer.
var ErrNotFound = errors.New("no such waiting file")

// Reason is why a fetch was refused or failed.
type Reason int

const (
	// NotALink: what was pasted isn't a web address.
	NotALink Reason = iota
	// NotOneVideo: a playlist or a channel.
	NotOneVideo
	// Live: a live stream, or one yet to start.
	Live
	Private
	// SignIn: only someone signed in can watch it.
	SignIn
	Unavailable
	Unsupported
	TooLarge
	TimedOut
	// Missing: yt-dlp isn't installed.
	Missing
	// Failed: anything else.
	Failed
)

// RefusedError is a fetch that was refused or failed. Its message is safe to
// show the user.
type RefusedError struct {
	Reason Reason
	Msg    string
}

func (e *RefusedError) Error() string { return e.Msg }

func refused(reason Reason, msg string) error { return &RefusedError{Reason: reason, Msg: msg} }

// Fetched is a link's audio, waiting to be added, with the details the link
// gave.
type Fetched struct {
	ID string `json:"id"`
	// Title is the video's title, and Producer its channel.
	Title    string `json:"title"`
	Producer string `json:"producer"`
	// SourceLink is the video's own link, as yt-dlp reports it: without
	// the playlist or tracking it was pasted with.
	SourceLink  string `json:"sourceLink"`
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

// Options configure a Store.
type Options struct {
	// Dir holds the waiting files. Whatever is in it when opened is deleted.
	Dir string
	// YtDlp is the yt-dlp to run. Empty means the one on the PATH.
	YtDlp string
	// MaxBytes caps a fetch's size, as uploads are capped.
	MaxBytes int64
	// Timeout stops a fetch that takes longer. Zero means DefaultTimeout.
	Timeout time.Duration
	// Now tells the time, for when waiting files expire. Nil means time.Now.
	Now func() time.Time
}

// Store fetches links into waiting files and keeps them until they're
// added, discarded or expire.
type Store struct {
	opts    Options
	mu      sync.Mutex
	waiting map[string]*waiting
	stop    chan struct{}
	stopped sync.Once
}

type waiting struct {
	Fetched
	path    string
	expires time.Time
}

// Open empties dir of any waiting files left from before and returns a
// Store keeping them there. It deletes expired ones as they expire until
// closed.
func Open(opts Options) (*Store, error) {
	if opts.YtDlp == "" {
		opts.YtDlp = "yt-dlp"
	}
	if opts.Timeout <= 0 {
		opts.Timeout = DefaultTimeout
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if err := os.RemoveAll(opts.Dir); err != nil {
		return nil, fmt.Errorf("deleting waiting files: %w", err)
	}
	if err := os.MkdirAll(opts.Dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating the waiting files' directory: %w", err)
	}
	s := &Store{opts: opts, waiting: map[string]*waiting{}, stop: make(chan struct{})}
	go s.sweepEvery(time.Minute)
	return s, nil
}

// Close stops deleting expired waiting files.
func (s *Store) Close() {
	s.stopped.Do(func() { close(s.stop) })
}

func (s *Store) sweepEvery(interval time.Duration) {
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-tick.C:
			s.mu.Lock()
			s.sweep()
			s.mu.Unlock()
		}
	}
}

// sweep deletes the expired waiting files. s.mu is held.
func (s *Store) sweep() {
	now := s.opts.Now()
	for id, w := range s.waiting {
		if !now.Before(w.expires) {
			s.remove(id)
		}
	}
}

// remove deletes a waiting file. s.mu is held.
func (s *Store) remove(id string) {
	if w, ok := s.waiting[id]; ok {
		os.Remove(w.path)
		delete(s.waiting, id)
	}
}

// find returns a waiting file that hasn't expired. s.mu is held.
func (s *Store) find(id string) (*waiting, error) {
	s.sweep()
	w, ok := s.waiting[id]
	if !ok {
		return nil, ErrNotFound
	}
	return w, nil
}

// Serve answers a request for a waiting file's audio.
func (s *Store) Serve(w http.ResponseWriter, r *http.Request, id string) error {
	s.mu.Lock()
	found, err := s.find(id)
	var file *os.File
	if err == nil {
		file, err = os.Open(found.path)
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", ContentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", info.ModTime(), file)
	return nil
}

// Discard deletes a waiting file, if it's there.
func (s *Store) Discard(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.remove(id)
}

// Keep hands a waiting file to keep, e.g. to add it as a Beat, and deletes
// it once keep succeeds. keep is given the file's path, and must leave the
// file there: if keep fails, it stays waiting, to be tried again.
func (s *Store) Keep(id string, keep func(path string, f Fetched) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, err := s.find(id)
	if err != nil {
		return err
	}
	if err := keep(w.path, w.Fetched); err != nil {
		return err
	}
	s.remove(id)
	return nil
}

// Fetch fetches the audio of the single video link points at into a
// waiting file, as an m4a. It's stopped, deleting what it fetched, when ctx
// is cancelled, when it takes longer than the timeout, or when it grows
// larger than the size cap.
func (s *Store) Fetch(ctx context.Context, link string) (Fetched, error) {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return Fetched{}, refused(NotALink, "That isn't a link. Paste a web address, starting with https://.")
	}
	id, err := newID()
	if err != nil {
		return Fetched{}, err
	}
	work := filepath.Join(s.opts.Dir, id+".work")
	if err := os.Mkdir(work, 0o755); err != nil {
		return Fetched{}, fmt.Errorf("making a fetch's directory: %w", err)
	}
	defer os.RemoveAll(work)

	ctx, cancel := context.WithTimeout(ctx, s.opts.Timeout)
	defer cancel()
	info, err := s.info(ctx, u.String(), work)
	if err != nil {
		return Fetched{}, s.failure(ctx, err)
	}
	audio, err := s.download(ctx, work)
	if err != nil {
		return Fetched{}, s.failure(ctx, err)
	}
	size, err := fileSize(audio)
	if err != nil {
		return Fetched{}, err
	}
	if size > s.opts.MaxBytes {
		return Fetched{}, s.tooLarge()
	}
	path := filepath.Join(s.opts.Dir, id)
	if err := os.Rename(audio, path); err != nil {
		return Fetched{}, fmt.Errorf("keeping a fetch: %w", err)
	}
	f := Fetched{
		ID:          id,
		Title:       strings.TrimSpace(info.Title),
		Producer:    strings.TrimSpace(info.producer()),
		SourceLink:  info.WebpageURL,
		FileName:    fileName(info.Title),
		ContentType: ContentType,
		Size:        size,
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep()
	s.waiting[id] = &waiting{Fetched: f, path: path, expires: s.opts.Now().Add(Kept)}
	return f, nil
}

// info is what yt-dlp says about a link.
type info struct {
	Type       string `json:"_type"`
	Title      string `json:"title"`
	Channel    string `json:"channel"`
	Uploader   string `json:"uploader"`
	WebpageURL string `json:"webpage_url"`
	IsLive     bool   `json:"is_live"`
	LiveStatus string `json:"live_status"`
	// The size of the audio it would fetch, when it's known before.
	Filesize       float64 `json:"filesize"`
	FilesizeApprox float64 `json:"filesize_approx"`
}

func (i info) producer() string {
	if i.Channel != "" {
		return i.Channel
	}
	return i.Uploader
}

// format prefers audio already in AAC, which goes into the m4a as it is,
// then the best audio there is, and then a video's, from sites with nothing
// else.
const format = "bestaudio[acodec^=mp4a]/bestaudio/best"

// common are the options every run of yt-dlp takes: none of the user's
// yt-dlp configuration, one video even from a link inside a playlist, and
// the bundled QuickJS for YouTube's challenges.
var common = []string{"--ignore-config", "--no-playlist", "--js-runtimes", "quickjs", "--no-progress", "-f", format}

func withCommon(args ...string) []string { return append(slices.Clip(common), args...) }

// info asks yt-dlp about the link without fetching anything, refusing
// anything but a single video that isn't live, and keeps what it says in
// work for the download.
func (s *Store) info(ctx context.Context, link, work string) (info, error) {
	// A playlist or channel is listed, not resolved video by video.
	out, err := s.run(ctx, withCommon("--flat-playlist", "-J", "--", link)...)
	if err != nil {
		return info{}, err
	}
	var i info
	if err := json.Unmarshal(out, &i); err != nil {
		return info{}, fmt.Errorf("reading what yt-dlp says about %s: %w", link, err)
	}
	if i.Type != "" && i.Type != "video" {
		return info{}, refused(NotOneVideo, "That link isn't a single video. Paste the link to one video, not a playlist or a channel.")
	}
	switch {
	case i.IsLive, i.LiveStatus == "is_live", i.LiveStatus == "post_live":
		return info{}, refused(Live, "That's a live stream. Only a video that's finished can be added.")
	case i.LiveStatus == "is_upcoming":
		return info{}, refused(Live, "That video hasn't started yet. Only a video that's finished can be added.")
	}
	if size := max(i.Filesize, i.FilesizeApprox); size > float64(s.opts.MaxBytes) {
		return info{}, s.tooLarge()
	}
	if err := os.WriteFile(filepath.Join(work, "info.json"), out, 0o644); err != nil {
		return info{}, fmt.Errorf("keeping what yt-dlp says: %w", err)
	}
	return i, nil
}

// download fetches the audio yt-dlp found, into work, returning its path.
// yt-dlp fetches it itself, as the bundled ffmpeg can't reach the web, and
// has ffmpeg keep it as an m4a: copied when it's AAC, converted otherwise.
func (s *Store) download(ctx context.Context, work string) (string, error) {
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	go s.watchSize(ctx, work, cancel)
	out, err := s.run(ctx, withCommon(
		"--downloader", "native", "-x", "--audio-format", "m4a",
		"--max-filesize", strconv.FormatInt(s.opts.MaxBytes, 10),
		"-o", filepath.Join(work, "audio.%(ext)s"),
		"--load-info-json", filepath.Join(work, "info.json"))...)
	if cause := context.Cause(ctx); errors.Is(cause, errTooLarge) {
		return "", s.tooLarge()
	}
	if err != nil {
		return "", err
	}
	audio := filepath.Join(work, "audio.m4a")
	if _, err := os.Stat(audio); err != nil {
		// yt-dlp skips a file it finds is over --max-filesize, and says so.
		if strings.Contains(string(out), "max-filesize") {
			return "", s.tooLarge()
		}
		return "", fmt.Errorf("yt-dlp left no audio: %s", lastLines(out))
	}
	return audio, nil
}

var errTooLarge = errors.New("fetch too large")

// watchSize stops a download as soon as any file it writes grows past the
// size cap, which yt-dlp's --max-filesize doesn't catch for every kind of
// download.
func (s *Store) watchSize(ctx context.Context, work string, stop context.CancelCauseFunc) {
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		filepath.WalkDir(work, func(_ string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			if info, err := d.Info(); err == nil && info.Size() > s.opts.MaxBytes {
				stop(errTooLarge)
				return filepath.SkipAll
			}
			return nil
		})
	}
}

// ytDlpError is yt-dlp failing, with what it said.
type ytDlpError struct {
	err    error
	stderr string
}

func (e *ytDlpError) Error() string {
	return fmt.Sprintf("yt-dlp: %v: %s", e.err, lastLines([]byte(e.stderr)))
}

func (e *ytDlpError) Unwrap() error { return e.err }

// run runs yt-dlp, returning what it printed. It's stopped, with anything it
// started, when ctx is done.
func (s *Store) run(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, s.opts.YtDlp, args...)
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

func (s *Store) tooLarge() error {
	return refused(TooLarge, fmt.Sprintf("That video's audio is larger than the upload limit of %s.", formatSize(s.opts.MaxBytes)))
}

// failure says why a fetch failed, in words for the user, logging what
// yt-dlp said when it isn't plain. A cancelled fetch is passed on as is.
func (s *Store) failure(ctx context.Context, err error) error {
	var r *RefusedError
	if errors.As(err, &r) {
		return err
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return refused(TimedOut, fmt.Sprintf("Fetching took longer than %s, so it was stopped.", formatDuration(s.opts.Timeout)))
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, fs.ErrNotExist) {
		log.Printf("fetching a link: %v", err)
		return refused(Missing, "Adding from a link needs yt-dlp, which this Bandmate can't find.")
	}
	var y *ytDlpError
	if errors.As(err, &y) {
		if r := explain(y.stderr); r != nil {
			return r
		}
	}
	log.Printf("fetching a link: %v", err)
	return refused(Failed, "Couldn't fetch that link. Try again, and if it keeps failing, Bandmate's log says why.")
}

// explanations are what yt-dlp's errors mean, in the order they're checked.
var explanations = []struct {
	says   []string
	reason Reason
	msg    string
}{
	{[]string{"private video"}, Private, "That video is private."},
	{[]string{"live event will begin", "premieres in", "is live"}, Live, "That's a live stream. Only a video that's finished can be added."},
	{[]string{"members-only", "join this channel", "sign in", "login required", "log in"}, SignIn, "That video can only be watched signed in, so Bandmate can't fetch it."},
	{[]string{"unsupported url"}, Unsupported, "Bandmate can't fetch from that site, or the link isn't to a video."},
	{[]string{"unavailable", "not available", "has been removed", "no longer available", "does not exist", "http error 404", "http error 410"}, Unavailable, "That video isn't available. It may have been removed."},
}

// explain says what yt-dlp's error means, or nil when it isn't plain.
func explain(stderr string) error {
	var said []string
	for _, line := range strings.Split(stderr, "\n") {
		if strings.HasPrefix(line, "ERROR:") {
			said = append(said, strings.ToLower(line))
		}
	}
	text := strings.Join(said, "\n")
	for _, e := range explanations {
		for _, s := range e.says {
			if strings.Contains(text, s) {
				return refused(e.reason, e.msg)
			}
		}
	}
	return nil
}

// fileName names a fetch's file after its video, as yt-dlp would save it.
func fileName(title string) string {
	name := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r < ' ' {
			return '_'
		}
		return r
	}, strings.TrimSpace(title))
	if name == "" {
		name = "audio"
	}
	return name + ".m4a"
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func fileSize(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

// lastLines is the end of what a program printed, for the log.
func lastLines(out []byte) string {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	return strings.Join(lines[max(0, len(lines)-3):], " / ")
}

// formatSize writes a byte count for people, e.g. "500 MB".
func formatSize(bytes int64) string {
	const mb = 1 << 20
	if bytes >= mb && bytes%mb == 0 {
		return fmt.Sprintf("%d MB", bytes/mb)
	}
	if bytes >= mb {
		return fmt.Sprintf("%.1f MB", float64(bytes)/mb)
	}
	return fmt.Sprintf("%d bytes", bytes)
}

// formatDuration writes a timeout for people, e.g. "10 minutes".
func formatDuration(d time.Duration) string {
	if d >= time.Minute && d%time.Minute == 0 {
		if d == time.Minute {
			return "a minute"
		}
		return fmt.Sprintf("%d minutes", d/time.Minute)
	}
	return d.String()
}
