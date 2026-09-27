package app_test

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/xKirtle/bandmate/internal/app"
)

func TestUploadedBeatAppearsInBeatLibrary(t *testing.T) {
	ts := newTestServer(t)
	upload := fakeAudio("dark_trap_140bpm_Am.mp3").with(map[string]any{
		"title":      "Dark Trap",
		"producer":   "Nightfall",
		"sourceLink": "https://example.com/beats/dark-trap",
		"bpm":        140,
		"key":        "Am",
		"notes":      "Free for non-profit",
	})

	created := ts.uploadBeat(upload)

	want := beat{
		ID:          created.ID,
		Title:       "Dark Trap",
		Producer:    "Nightfall",
		SourceLink:  "https://example.com/beats/dark-trap",
		BPM:         intPtr(140),
		Key:         "Am",
		Notes:       "Free for non-profit",
		FileName:    "dark_trap_140bpm_Am.mp3",
		ContentType: "audio/mpeg",
		Size:        int64(len(upload.Data)),
		Duration:    2.5,
		Peaks:       []float64{0.1, 0.5, 1, 0.25},
		Songs:       []songTitle{},
		CreatedAt:   created.CreatedAt,
		UpdatedAt:   created.UpdatedAt,
	}
	if !reflect.DeepEqual(created, want) {
		t.Errorf("created beat = %+v, want %+v", created, want)
	}
	if created.CreatedAt == "" || created.UpdatedAt == "" {
		t.Error("createdAt or updatedAt is empty")
	}
	if got := ts.getBeat(created.ID); !reflect.DeepEqual(got, want) {
		t.Errorf("read beat = %+v, want %+v", got, want)
	}

	// The list leaves out the peaks, which only a player needs.
	listed := want
	listed.Peaks = nil
	if list := ts.listBeats(); !reflect.DeepEqual(list, []beat{listed}) {
		t.Errorf("beat library = %+v, want %+v", list, []beat{listed})
	}
}

func intPtr(n int) *int { return &n }

func TestBeatLibraryListsNewestFirstAndSearchesTitlesAndProducers(t *testing.T) {
	ts := newTestServer(t)
	ts.uploadBeat(fakeAudio("a.mp3").with(map[string]any{"title": "Late Night", "producer": "Kairo"}))
	ts.uploadBeat(fakeAudio("b.mp3").with(map[string]any{"title": "Sunrise", "producer": "Nightfall"}))
	ts.uploadBeat(fakeAudio("c.mp3").with(map[string]any{"title": "Canção", "producer": ""}))

	cases := map[string][]string{
		"":            {"Canção", "Sunrise", "Late Night"},
		"q=night":     {"Sunrise", "Late Night"},
		"q=KAIRO":     {"Late Night"},
		"q=CANÇÃO":    {"Canção"},
		"q=nothing":   {},
		"q=%20sun%20": {"Sunrise"},
	}
	for query, want := range cases {
		if got := beatTitles(ts.listBeats(query)); !reflect.DeepEqual(got, want) {
			t.Errorf("beats for %q = %q, want %q", query, got, want)
		}
	}
}

func TestUploadingABeatNeedsATitleAndAFileTheBrowserDecoded(t *testing.T) {
	cases := map[string]struct {
		upload audioUpload
		msg    string
	}{
		"no title":         {fakeAudio("a.mp3"), "title is required"},
		"blank title":      {fakeAudio("a.mp3").with(map[string]any{"title": "  "}), "title is required"},
		"bpm out of range": {fakeAudio("a.mp3").with(map[string]any{"title": "A", "bpm": 0}), "bpm must be between 1 and 999"},
		"source link not a web address": {
			fakeAudio("a.mp3").with(map[string]any{"title": "A", "sourceLink": "javascript:alert(1)"}),
			"source link must be a web address starting with http:// or https://",
		},
		"no duration": {
			fakeAudio("a.mp3").with(map[string]any{"title": "A", "duration": 0}),
			"duration must be more than 0 seconds",
		},
		"no peaks": {
			fakeAudio("a.mp3").with(map[string]any{"title": "A", "peaks": []float64{}}),
			"peaks are required",
		},
		"peaks out of range": {
			fakeAudio("a.mp3").with(map[string]any{"title": "A", "peaks": []float64{0.5, 1.5}}),
			"peaks must be between 0 and 1",
		},
		"unknown detail": {
			fakeAudio("a.mp3").with(map[string]any{"title": "A", "genre": "trap"}),
			"details must be valid JSON with known fields",
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			expectError(t, ts.SendUpload(http.MethodPost, "/api/beats", c.upload), http.StatusBadRequest, c.msg)

			if list := ts.listBeats(); len(list) != 0 {
				t.Errorf("beat library = %+v, want nothing added", list)
			}
		})
	}
}

func TestBeatDetailsCanBeEdited(t *testing.T) {
	ts := newTestServer(t)
	created := ts.uploadBeat(fakeAudio("a.mp3").with(map[string]any{
		"title": "Untitled", "producer": "Kairo", "bpm": 90, "key": "C",
	}))

	res := ts.Do(http.MethodPatch, beatPath(created.ID), map[string]any{
		"title":      "  Slow Burn ",
		"sourceLink": "https://example.com/slow-burn",
		"bpm":        nil,
		"notes":      "Lease bought 2026",
	})

	expectStatus(t, res, http.StatusOK)
	var got beat
	res.JSON(t, &got)
	want := created
	want.Title, want.SourceLink, want.BPM, want.Notes = "Slow Burn", "https://example.com/slow-burn", nil, "Lease bought 2026"
	want.UpdatedAt = got.UpdatedAt
	if !reflect.DeepEqual(got, want) {
		t.Errorf("edited beat = %+v, want %+v", got, want)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, created.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want it after %s", got.UpdatedAt, created.UpdatedAt)
	}
	if read := ts.getBeat(created.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read beat = %+v, want %+v", read, got)
	}
}

func TestARejectedBeatEditChangesNothing(t *testing.T) {
	ts := newTestServer(t)
	created := ts.uploadBeat(fakeAudio("a.mp3").with(map[string]any{"title": "Keep Me"}))

	res := ts.Do(http.MethodPatch, beatPath(created.ID), map[string]any{"producer": "Someone", "title": ""})

	expectError(t, res, http.StatusBadRequest, "title is required")
	if read := ts.getBeat(created.ID); !reflect.DeepEqual(read, created) {
		t.Errorf("beat = %+v, want it unchanged: %+v", read, created)
	}
}

func TestUnknownBeatIsNotFound(t *testing.T) {
	ts := newTestServer(t)

	for _, r := range []response{
		ts.Do(http.MethodGet, beatPath(999), nil),
		ts.Do(http.MethodPatch, beatPath(999), map[string]any{"title": "X"}),
		ts.Do(http.MethodDelete, beatPath(999), nil),
		ts.Do(http.MethodGet, beatPath(999)+"/audio", nil),
		ts.SendUpload(http.MethodPut, beatPath(999)+"/file", fakeAudio("a.mp3")),
	} {
		expectStatus(t, r, http.StatusNotFound)
	}
}

func TestBeatAudioIsServedAsUploadedWithRangeSupport(t *testing.T) {
	ts := newTestServer(t)
	upload := fakeAudio("a.mp3").with(map[string]any{"title": "A"})
	created := ts.uploadBeat(upload)
	path := beatPath(created.ID) + "/audio"

	whole := ts.Do(http.MethodGet, path, nil)
	expectStatus(t, whole, http.StatusOK)
	if !bytes.Equal(whole.Body, upload.Data) {
		t.Errorf("audio = %q, want the file as uploaded: %q", whole.Body, upload.Data)
	}
	if got := whole.Header.Get("Content-Type"); got != "audio/mpeg" {
		t.Errorf("Content-Type = %q, want audio/mpeg", got)
	}
	if got := whole.Header.Get("Accept-Ranges"); got != "bytes" {
		t.Errorf("Accept-Ranges = %q, want bytes", got)
	}

	part := ts.DoRaw(http.MethodGet, path, http.Header{"Range": {"bytes=4-9"}}, nil)
	expectStatus(t, part, http.StatusPartialContent)
	if want := upload.Data[4:10]; !bytes.Equal(part.Body, want) {
		t.Errorf("range = %q, want %q", part.Body, want)
	}
	if got, want := part.Header.Get("Content-Range"), fmt.Sprintf("bytes 4-9/%d", len(upload.Data)); got != want {
		t.Errorf("Content-Range = %q, want %q", got, want)
	}
}

func TestBeatWithoutADeclaredAudioTypeIsServedByItsExtension(t *testing.T) {
	cases := map[string]struct{ fileName, declared, want string }{
		"flac with no type":   {"take.flac", "", "audio/flac"},
		"m4a as octet-stream": {"take.m4a", "application/octet-stream", "audio/mp4"},
		"html is never html":  {"page.html", "text/html", "application/octet-stream"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)
			upload := fakeAudio(c.fileName).with(map[string]any{"title": "A"})
			upload.ContentType = c.declared

			created := ts.uploadBeat(upload)

			if created.ContentType != c.want {
				t.Errorf("contentType = %q, want %q", created.ContentType, c.want)
			}
			res := ts.Do(http.MethodGet, beatPath(created.ID)+"/audio", nil)
			if got := res.Header.Get("Content-Type"); got != c.want {
				t.Errorf("served Content-Type = %q, want %q", got, c.want)
			}
		})
	}
}

func TestUploadsOverTheSizeCapAreRejected(t *testing.T) {
	ts := newTestServerWith(t, func(c *app.Config) { c.MaxUploadBytes = 1 << 20 })

	var config struct{ MaxUploadBytes int64 }
	ts.Do(http.MethodGet, "/api/config", nil).JSON(t, &config)
	if config.MaxUploadBytes != 1<<20 {
		t.Errorf("maxUploadBytes = %d, want %d", config.MaxUploadBytes, 1<<20)
	}

	atCap := fakeAudio("fits.wav").with(map[string]any{"title": "Fits"})
	atCap.Data = bytes.Repeat([]byte{1}, 1<<20)
	ts.uploadBeat(atCap)

	overCap := fakeAudio("big.wav").with(map[string]any{"title": "Too Big"})
	overCap.Data = bytes.Repeat([]byte{1}, 1<<20+1)
	expectError(t, ts.SendUpload(http.MethodPost, "/api/beats", overCap),
		http.StatusRequestEntityTooLarge, "the file is larger than the upload limit of 1 MB")

	if got := beatTitles(ts.listBeats()); !reflect.DeepEqual(got, []string{"Fits"}) {
		t.Errorf("beat library = %q, want only the file that fits", got)
	}
}

func TestTheUploadCapDefaultsTo500MB(t *testing.T) {
	ts := newTestServer(t)

	var config struct{ MaxUploadBytes int64 }
	ts.Do(http.MethodGet, "/api/config", nil).JSON(t, &config)

	if config.MaxUploadBytes != 500<<20 {
		t.Errorf("maxUploadBytes = %d, want 500 MB", config.MaxUploadBytes)
	}
}

func TestDeletingAnUnusedBeatRemovesItAndItsFile(t *testing.T) {
	ts := newTestServer(t)
	kept := ts.uploadBeat(fakeAudio("a.mp3").with(map[string]any{"title": "Kept"}))
	gone := ts.uploadBeat(fakeAudio("b.mp3").with(map[string]any{"title": "Gone"}))

	expectStatus(t, ts.Do(http.MethodDelete, beatPath(gone.ID), nil), http.StatusNoContent)

	if got := beatTitles(ts.listBeats()); !reflect.DeepEqual(got, []string{"Kept"}) {
		t.Errorf("beat library = %q, want only %q", got, "Kept")
	}
	expectStatus(t, ts.Do(http.MethodGet, beatPath(gone.ID)+"/audio", nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodGet, beatPath(kept.ID)+"/audio", nil), http.StatusOK)
	// The API can't tell a file left behind on disk, so look there: only
	// the kept Beat's file remains.
	if files := audioFiles(t, ts); len(files) != 1 {
		t.Errorf("audio files on disk = %q, want only the kept Beat's", files)
	}
}

func TestAnUnusedBeatsFileCanBeReplaced(t *testing.T) {
	ts := newTestServer(t)
	created := ts.uploadBeat(fakeAudio("demo.mp3").with(map[string]any{"title": "Slow Burn", "producer": "Kairo"}))
	replacement := audioUpload{
		FileName:    "slow_burn_final.wav",
		ContentType: "audio/wav",
		Data:        []byte("RIFF the final version"),
		Details:     map[string]any{"duration": 3.25, "peaks": []float64{0.2, 0.9}},
	}

	res := ts.SendUpload(http.MethodPut, beatPath(created.ID)+"/file", replacement)

	expectStatus(t, res, http.StatusOK)
	var got beat
	res.JSON(t, &got)
	want := created
	want.FileName, want.ContentType, want.Size = "slow_burn_final.wav", "audio/wav", int64(len(replacement.Data))
	want.Duration, want.Peaks = 3.25, []float64{0.2, 0.9}
	want.UpdatedAt = got.UpdatedAt
	if !reflect.DeepEqual(got, want) {
		t.Errorf("beat = %+v, want %+v", got, want)
	}
	served := ts.Do(http.MethodGet, beatPath(created.ID)+"/audio", nil)
	if !bytes.Equal(served.Body, replacement.Data) {
		t.Errorf("audio = %q, want the replacement %q", served.Body, replacement.Data)
	}
	if files := audioFiles(t, ts); len(files) != 1 {
		t.Errorf("audio files on disk = %q, want just the replacement", files)
	}
}

func TestARejectedReplacementKeepsTheOldFile(t *testing.T) {
	ts := newTestServer(t)
	upload := fakeAudio("a.mp3").with(map[string]any{"title": "A"})
	created := ts.uploadBeat(upload)
	broken := fakeAudio("b.mp3")
	broken.Details = map[string]any{"duration": 0, "peaks": []float64{0.5}}

	res := ts.SendUpload(http.MethodPut, beatPath(created.ID)+"/file", broken)

	expectError(t, res, http.StatusBadRequest, "duration must be more than 0 seconds")
	if read := ts.getBeat(created.ID); !reflect.DeepEqual(read, created) {
		t.Errorf("beat = %+v, want it unchanged: %+v", read, created)
	}
	if served := ts.Do(http.MethodGet, beatPath(created.ID)+"/audio", nil); !bytes.Equal(served.Body, upload.Data) {
		t.Errorf("audio = %q, want the original %q", served.Body, upload.Data)
	}
	if files := audioFiles(t, ts); len(files) != 1 {
		t.Errorf("audio files on disk = %q, want only the original", files)
	}
}

func TestBeatsSurviveARestart(t *testing.T) {
	ts := newTestServer(t)
	upload := fakeAudio("a.mp3").with(map[string]any{"title": "Still Here"})
	created := ts.uploadBeat(upload)
	ts.Stop()

	restarted := startTestServer(t, ts.DataDir)

	if read := restarted.getBeat(created.ID); !reflect.DeepEqual(read, created) {
		t.Errorf("beat after restart = %+v, want %+v", read, created)
	}
	if served := restarted.Do(http.MethodGet, beatPath(created.ID)+"/audio", nil); !bytes.Equal(served.Body, upload.Data) {
		t.Errorf("audio after restart = %q, want %q", served.Body, upload.Data)
	}
}

// audioFiles lists the files stored for Beats in the data directory.
func audioFiles(t *testing.T, ts *testServer) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(ts.DataDir, "audio", "beats"))
	if err != nil {
		t.Fatalf("reading audio directory: %v", err)
	}
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}
