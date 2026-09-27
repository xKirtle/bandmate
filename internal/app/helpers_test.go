package app_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/xKirtle/bandmate/internal/app"
)

// testSPA stands in for the built Svelte app, so API tests don't depend on a
// frontend build.
var testSPA fs.FS = fstest.MapFS{
	"index.html":    {Data: []byte("<!doctype html><title>Bandmate</title>")},
	"assets/app.js": {Data: []byte("console.log('bandmate')")},
}

// testServer is the real HTTP handler running in-process against a SQLite
// database in a temporary data directory.
type testServer struct {
	t       *testing.T
	DataDir string
	app     *app.App
	srv     *httptest.Server
}

// newTestServer starts a server with a fresh, empty data directory.
func newTestServer(t *testing.T) *testServer {
	t.Helper()
	return startTestServer(t, t.TempDir())
}

// startTestServer starts a server on an existing data directory, e.g. to
// simulate a restart.
func startTestServer(t *testing.T, dataDir string) *testServer {
	t.Helper()
	a, err := app.New(app.Config{DataDir: dataDir, SPA: testSPA})
	if err != nil {
		t.Fatalf("starting app: %v", err)
	}
	srv := httptest.NewServer(a.Handler())
	ts := &testServer{t: t, DataDir: dataDir, app: a, srv: srv}
	t.Cleanup(func() { ts.Stop() })
	return ts
}

// Stop shuts the server down and releases the database. It is safe to call
// more than once.
func (ts *testServer) Stop() {
	if ts.srv == nil {
		return
	}
	ts.srv.Close()
	ts.srv = nil
	if err := ts.app.Close(); err != nil {
		ts.t.Errorf("closing app: %v", err)
	}
}

// response is an HTTP response with its body already read.
type response struct {
	Status int
	Header http.Header
	Body   []byte
}

// JSON decodes the response body into v, failing the test if it can't.
func (r response) JSON(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		t.Fatalf("decoding response body %q: %v", r.Body, err)
	}
}

// Do sends a request with an optional JSON body and returns the response.
func (ts *testServer) Do(method, path string, body any) response {
	ts.t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			ts.t.Fatalf("encoding request body: %v", err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, ts.srv.URL+path, reader)
	if err != nil {
		ts.t.Fatalf("building request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := ts.srv.Client().Do(req)
	if err != nil {
		ts.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		ts.t.Fatalf("reading response body: %v", err)
	}
	return response{Status: res.StatusCode, Header: res.Header, Body: b}
}

// expectStatus fails the test unless the response has the given status.
func expectStatus(t *testing.T, r response, want int) {
	t.Helper()
	if r.Status != want {
		t.Fatalf("status = %d, want %d; body: %s", r.Status, want, r.Body)
	}
}

// song is the Song aggregate as the API returns it. Later tickets extend it.
type song struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	Key       string `json:"key"`
	BPM       *int   `json:"bpm"`
	Capo      *int   `json:"capo"`
	Tuning    string `json:"tuning"`
	Notes     string `json:"notes"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// songSummary is one entry of the Song list.
type songSummary struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	UpdatedAt string `json:"updatedAt"`
}

// createSong creates a Song with the given title and returns its aggregate.
func (ts *testServer) createSong(title string) song {
	ts.t.Helper()
	res := ts.Do(http.MethodPost, "/api/songs", map[string]any{"title": title})
	expectStatus(ts.t, res, http.StatusCreated)
	var s song
	res.JSON(ts.t, &s)
	return s
}

// getSong reads a Song's aggregate.
func (ts *testServer) getSong(id int64) song {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, fmt.Sprintf("/api/songs/%d", id), nil)
	expectStatus(ts.t, res, http.StatusOK)
	var s song
	res.JSON(ts.t, &s)
	return s
}

// listSongs reads the Song list, with an optional query string such as
// "status=idea&q=night".
func (ts *testServer) listSongs(query ...string) []songSummary {
	ts.t.Helper()
	path := "/api/songs"
	if len(query) > 0 {
		path += "?" + query[0]
	}
	res := ts.Do(http.MethodGet, path, nil)
	expectStatus(ts.t, res, http.StatusOK)
	var list []songSummary
	res.JSON(ts.t, &list)
	return list
}

// updateSong applies changes to a Song and returns its aggregate.
func (ts *testServer) updateSong(id int64, changes map[string]any) song {
	ts.t.Helper()
	res := ts.Do(http.MethodPatch, fmt.Sprintf("/api/songs/%d", id), changes)
	expectStatus(ts.t, res, http.StatusOK)
	var s song
	res.JSON(ts.t, &s)
	return s
}
