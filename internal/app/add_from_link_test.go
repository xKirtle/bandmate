package app_test

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
)

// fetched is a link's audio waiting to be added, as the API returns it.
type fetched struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Producer    string `json:"producer"`
	SourceLink  string `json:"sourceLink"`
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

// fetchLink fetches a link's audio, expecting it to work.
func (ts *testServer) fetchLink(link string) fetched {
	ts.t.Helper()
	res := ts.Do(http.MethodPost, "/api/fetches", map[string]string{"link": link})
	expectStatus(ts.t, res, http.StatusCreated)
	var f fetched
	res.JSON(ts.t, &f)
	return f
}

func TestFetchingALinkKeepsItsAudioWaitingWithTheDetailsTheLinkGives(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp)

	// A video's link from inside a playlist, as shared.
	f := ts.fetchLink("https://video.test/watch?v=night&list=PL1&si=abc")

	want := fetched{
		ID:          f.ID,
		Title:       "[FREE] Night (prod. Kofi) 140 BPM",
		Producer:    "Kofi Beats",
		SourceLink:  "https://video.test/watch?v=night",
		FileName:    "[FREE] Night (prod. Kofi) 140 BPM.m4a",
		ContentType: "audio/mp4",
		Size:        int64(len(fakeFetchedAudio)),
	}
	if f != want || f.ID == "" {
		t.Errorf("fetched = %+v, want %+v", f, want)
	}
	res := ts.Do(http.MethodGet, "/api/fetches/"+f.ID+"/audio", nil)
	expectStatus(t, res, http.StatusOK)
	if string(res.Body) != fakeFetchedAudio || res.Header.Get("Content-Type") != "audio/mp4" {
		t.Errorf("waiting audio = %q (%s), want %q (audio/mp4)", res.Body, res.Header.Get("Content-Type"), fakeFetchedAudio)
	}
}

func TestALinkWithoutATitleOrChannelFallsBackToItsUploader(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp)

	f := ts.fetchLink("https://video.test/untitled")

	if f.Title != "" || f.Producer != "Somebody" || f.FileName != "audio.m4a" {
		t.Errorf("fetched = %+v, want no title, Somebody as producer, and audio.m4a", f)
	}
}

func TestAddingAWaitingFileKeepsItAsTheBeat(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp)
	f := ts.fetchLink("https://video.test/watch?v=night")

	res := ts.Do(http.MethodPost, "/api/fetches/"+f.ID+"/beat", map[string]any{
		"title": "Night", "producer": "Kofi", "sourceLink": f.SourceLink, "bpm": 140, "key": "Am", "notes": "",
		"duration": 2.5, "peaks": []float64{0.1, 0.5},
	})

	expectStatus(t, res, http.StatusCreated)
	var created beat
	res.JSON(t, &created)
	want := beat{
		ID: created.ID, Title: "Night", Producer: "Kofi", SourceLink: "https://video.test/watch?v=night",
		BPM: intPtr(140), Key: "Am", FileName: f.FileName, ContentType: "audio/mp4", Size: f.Size,
		Duration: 2.5, Peaks: []float64{0.1, 0.5}, Songs: []songTitle{},
		CreatedAt: created.CreatedAt, UpdatedAt: created.UpdatedAt,
	}
	if !reflect.DeepEqual(created, want) {
		t.Errorf("added beat = %+v, want %+v", created, want)
	}
	audio := ts.Do(http.MethodGet, beatPath(created.ID)+"/audio", nil)
	if string(audio.Body) != fakeFetchedAudio {
		t.Errorf("beat audio = %q, want %q", audio.Body, fakeFetchedAudio)
	}
	// It's no longer waiting, so it can't be added twice.
	expectStatus(t, ts.Do(http.MethodGet, "/api/fetches/"+f.ID+"/audio", nil), http.StatusNotFound)
	again := ts.Do(http.MethodPost, "/api/fetches/"+f.ID+"/beat", map[string]any{"title": "Night", "duration": 2.5, "peaks": []float64{0.1}})
	expectError(t, again, http.StatusNotFound, fetchGone)
}

// fetchGone is the answer for a waiting file that isn't there (any more).
const fetchGone = "That fetched audio is gone: it waits an hour, or until Bandmate restarts. Fetch the link again."

func TestAWaitingFileTheBeatLibraryRefusesStaysWaiting(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp)
	f := ts.fetchLink("https://video.test/watch?v=night")

	refused := ts.Do(http.MethodPost, "/api/fetches/"+f.ID+"/beat", map[string]any{"title": " ", "duration": 2.5, "peaks": []float64{0.1}})
	expectError(t, refused, http.StatusBadRequest, "title is required")

	res := ts.Do(http.MethodPost, "/api/fetches/"+f.ID+"/beat", map[string]any{"title": "Night", "duration": 2.5, "peaks": []float64{0.1}})
	expectStatus(t, res, http.StatusCreated)
}

func TestDiscardingAWaitingFileRemovesIt(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp)
	f := ts.fetchLink("https://video.test/watch?v=night")

	expectStatus(t, ts.Do(http.MethodDelete, "/api/fetches/"+f.ID, nil), http.StatusNoContent)

	expectStatus(t, ts.Do(http.MethodGet, "/api/fetches/"+f.ID+"/audio", nil), http.StatusNotFound)
}

func TestAWaitingFileNobodyAddsIsDeletedAfterAnHour(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)}
	ts := newTestServerWith(t, withFakeYtDlp, func(c *app.Config) { c.Now = clock.Now })
	f := ts.fetchLink("https://video.test/watch?v=night")

	clock.Advance(59 * time.Minute)
	expectStatus(t, ts.Do(http.MethodGet, "/api/fetches/"+f.ID+"/audio", nil), http.StatusOK)

	clock.Advance(time.Minute)
	res := ts.Do(http.MethodPost, "/api/fetches/"+f.ID+"/beat", map[string]any{"title": "Night", "duration": 2.5, "peaks": []float64{0.1}})
	expectError(t, res, http.StatusNotFound, fetchGone)
	ts.expectNothingWaiting()
}

func TestWaitingFilesAreDeletedOnRestart(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp)
	f := ts.fetchLink("https://video.test/watch?v=night")

	ts.Stop()
	ts = startTestServer(t, ts.DataDir, withFakeYtDlp)

	expectError(t, ts.Do(http.MethodGet, "/api/fetches/"+f.ID+"/audio", nil), http.StatusNotFound, fetchGone)
	ts.expectNothingWaiting()
}

// testClock is a clock the test moves on, read by the server as it serves.
type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func TestConfigSaysWhetherAddingFromALinkIsOn(t *testing.T) {
	for _, off := range []bool{false, true} {
		ts := newTestServerWith(t, func(c *app.Config) { c.AddFromLinkOff = off })
		var config struct {
			AddFromLink *bool `json:"addFromLink"`
		}
		ts.Do(http.MethodGet, "/api/config", nil).JSON(t, &config)
		if config.AddFromLink == nil || *config.AddFromLink == off {
			t.Errorf("with AddFromLinkOff %v, config addFromLink = %v", off, config.AddFromLink)
		}
	}
}

func TestTurnedOffAddingFromALinkRefusesAFetch(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp, func(c *app.Config) { c.AddFromLinkOff = true })

	res := ts.Do(http.MethodPost, "/api/fetches", map[string]string{"link": "https://video.test/watch?v=night"})

	expectError(t, res, http.StatusForbidden, "Adding a Beat from a link is turned off on this Bandmate.")
}

func TestFetchingRefusesWhatIsntASingleFinishedVideoAndSaysWhy(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp)
	notALink := "That isn't a link. Paste a web address, starting with https://."
	notOne := "That link isn't a single video. Paste the link to one video, not a playlist or a channel."
	cases := []struct {
		link   string
		status int
		msg    string
	}{
		{"not a link", http.StatusBadRequest, notALink},
		{"ftp://video.test/watch", http.StatusBadRequest, notALink},
		{"https://video.test/playlist?list=PL1", http.StatusUnprocessableEntity, notOne},
		{"https://video.test/@kofi", http.StatusUnprocessableEntity, notOne},
		{"https://video.test/live", http.StatusUnprocessableEntity, "That's a live stream. Only a video that's finished can be added."},
		{"https://video.test/upcoming", http.StatusUnprocessableEntity, "That video hasn't started yet. Only a video that's finished can be added."},
		{"https://video.test/private", http.StatusUnprocessableEntity, "That video is private."},
		{"https://video.test/gone", http.StatusUnprocessableEntity, "That video isn't available. It may have been removed."},
		{"https://video.test/members", http.StatusUnprocessableEntity, "That video can only be watched signed in, so Bandmate can't fetch it."},
		{"https://elsewhere.test/page", http.StatusUnprocessableEntity, "Bandmate can't fetch from that site, or the link isn't to a video."},
		{"https://video.test/broken", http.StatusBadGateway, "Couldn't fetch that link. Try again, and if it keeps failing, Bandmate's log says why."},
	}
	for _, c := range cases {
		t.Run(c.link, func(t *testing.T) {
			res := ts.Do(http.MethodPost, "/api/fetches", map[string]string{"link": c.link})
			expectError(t, res, c.status, c.msg)
		})
	}
	ts.expectNothingWaiting()
}

func TestFetchingWithoutYtDlpSaysItsMissing(t *testing.T) {
	ts := newTestServerWith(t, func(c *app.Config) { c.YtDlp = filepath.Join(t.TempDir(), "no-yt-dlp") })

	res := ts.Do(http.MethodPost, "/api/fetches", map[string]string{"link": "https://video.test/watch?v=night"})

	expectError(t, res, http.StatusServiceUnavailable, "Adding from a link needs yt-dlp, which this Bandmate can't find.")
}

func TestAFetchLargerThanTheUploadLimitIsStopped(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp, func(c *app.Config) { c.MaxUploadBytes = 1 << 20 })

	// One says its size up front, the other only grows past the limit.
	for _, link := range []string{"https://video.test/huge", "https://video.test/growing"} {
		res := ts.Do(http.MethodPost, "/api/fetches", map[string]string{"link": link})
		expectError(t, res, http.StatusRequestEntityTooLarge, "That video's audio is larger than the upload limit of 1 MB.")
	}
	ts.expectNothingWaiting()
}

func TestAFetchTakingTooLongIsStopped(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp, func(c *app.Config) { c.FetchTimeout = 300 * time.Millisecond })
	pidFile := filepath.Join(t.TempDir(), "pid")

	res := ts.Do(http.MethodPost, "/api/fetches", map[string]string{"link": "https://video.test/slow?pidfile=" + pidFile})

	expectError(t, res, http.StatusGatewayTimeout, "Fetching took longer than 300ms, so it was stopped.")
	expectStopped(t, pidFile)
	ts.expectNothingWaiting()
}

func TestCancellingAFetchStopsItAndDeletesWhatItFetched(t *testing.T) {
	ts := newTestServerWith(t, withFakeYtDlp)
	pidFile := filepath.Join(t.TempDir(), "pid")
	ctx, cancel := context.WithCancel(context.Background())
	body := strings.NewReader(`{"link": "https://video.test/slow?pidfile=` + pidFile + `"}`)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ts.srv.URL+"/api/fetches", body)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		res, err := ts.srv.Client().Do(req)
		if err == nil {
			res.Body.Close()
		}
		done <- err
	}()

	waitFor(t, "the fetch to start", func() bool { _, err := os.Stat(pidFile); return err == nil })
	cancel()

	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Errorf("request ended with %v, want it cancelled", err)
	}
	expectStopped(t, pidFile)
	ts.expectNothingWaiting()
}

// expectNothingWaiting fails the test unless every fetch's files are gone
// from the data directory.
func (ts *testServer) expectNothingWaiting() {
	ts.t.Helper()
	waitFor(ts.t, "the fetches' files to go", func() bool {
		entries, err := os.ReadDir(filepath.Join(ts.DataDir, "audio", "waiting"))
		return err == nil && len(entries) == 0
	})
}

// expectStopped fails the test unless the stand-in yt-dlp whose process id
// is in pidFile has stopped.
func expectStopped(t *testing.T, pidFile string) {
	t.Helper()
	text, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatalf("the stand-in yt-dlp never started: %v", err)
	}
	pid, _ := strconv.Atoi(string(text))
	waitFor(t, "yt-dlp to stop", func() bool { return syscall.Kill(pid, 0) != nil })
}

// waitFor waits up to 5 seconds for ok to hold.
func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !ok(); {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
