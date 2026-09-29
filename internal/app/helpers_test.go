package app_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"testing"
	"testing/fstest"
	"time"

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

// newTestServerWith starts a server with a fresh data directory and the
// configuration changed by configure, e.g. to lower the upload cap.
func newTestServerWith(t *testing.T, configure func(*app.Config)) *testServer {
	t.Helper()
	return startTestServer(t, t.TempDir(), configure)
}

// startTestServer starts a server on an existing data directory, e.g. to
// simulate a restart.
func startTestServer(t *testing.T, dataDir string, configure ...func(*app.Config)) *testServer {
	t.Helper()
	cfg := app.Config{DataDir: dataDir, SPA: testSPA}
	for _, c := range configure {
		c(&cfg)
	}
	a, err := app.New(cfg)
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
	return ts.do(method, path, nil, body)
}

// DoAt sends a write based on a given version of the Song, as the SPA does.
func (ts *testServer) DoAt(version int64, method, path string, body any) response {
	ts.t.Helper()
	return ts.do(method, path, http.Header{"If-Match": {fmt.Sprintf("%q", fmt.Sprint(version))}}, body)
}

func (ts *testServer) do(method, path string, header http.Header, body any) response {
	ts.t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			ts.t.Fatalf("encoding request body: %v", err)
		}
		reader = bytes.NewReader(b)
		header = header.Clone()
		if header == nil {
			header = http.Header{}
		}
		header.Set("Content-Type", "application/json")
	}
	return ts.DoRaw(method, path, header, reader)
}

// DoRaw sends a request with the given headers and body as is, e.g. an
// upload or a Range request.
func (ts *testServer) DoRaw(method, path string, header http.Header, body io.Reader) response {
	ts.t.Helper()
	req, err := http.NewRequest(method, ts.srv.URL+path, body)
	if err != nil {
		ts.t.Fatalf("building request: %v", err)
	}
	for name, values := range header {
		req.Header[name] = values
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

// expectError fails the test unless the response has the given status and
// error message.
func expectError(t *testing.T, r response, status int, msg string) {
	t.Helper()
	expectStatus(t, r, status)
	var e struct{ Error string }
	r.JSON(t, &e)
	if e.Error != msg {
		t.Errorf("error = %q, want %q", e.Error, msg)
	}
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
	ID          int64     `json:"id"`
	Version     int64     `json:"version"`
	Title       string    `json:"title"`
	Status      string    `json:"status"`
	Key         string    `json:"key"`
	BPM         *int      `json:"bpm"`
	Capo        *int      `json:"capo"`
	Tuning      string    `json:"tuning"`
	Notes       string    `json:"notes"`
	ShowChords  bool      `json:"showChords"`
	CreatedAt   string    `json:"createdAt"`
	UpdatedAt   string    `json:"updatedAt"`
	Arrangement []int64   `json:"arrangement"`
	Sections    []section `json:"sections"`
	Scrapbook   []int64   `json:"scrapbook"`
	Masters     []master  `json:"masters"`
	Cover       *cover    `json:"cover"`
}

// section is a Section with all its Alternates.
type section struct {
	ID         int64       `json:"id"`
	Label      string      `json:"label"`
	Alternates []alternate `json:"alternates"`
}

// alternate is one version of a Section's Lines.
type alternate struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
	Lines  []line `json:"lines"`
}

// line is one Line, as raw ChordPro text and parsed into lyrics and Chords.
type line struct {
	ID        int64   `json:"id"`
	Text      string  `json:"text"`
	Lyrics    string  `json:"lyrics"`
	Chords    []chord `json:"chords"`
	ChordLine bool    `json:"chordLine"`
	// Cue is when the Line is sung, in seconds; nil means none.
	Cue *float64 `json:"cue"`
}

// chord is a Chord anchored at a character offset into a Line's lyrics.
type chord struct {
	Offset int    `json:"offset"`
	Name   string `json:"name"`
}

// cuesOf maps the ids of a Section's cued Lines, in every Alternate, to
// their Cues.
func cuesOf(sec section) map[int64]float64 {
	cues := map[int64]float64{}
	for _, a := range sec.Alternates {
		for _, l := range a.Lines {
			if l.Cue != nil {
				cues[l.ID] = *l.Cue
			}
		}
	}
	return cues
}

// lineCues lists the Cues of each Section in the Arrangement, in order, by
// Line id, dormant ones included.
func lineCues(s song) []map[int64]float64 {
	sections := sectionsByID(s)
	out := []map[int64]float64{}
	for _, id := range s.Arrangement {
		out = append(out, cuesOf(sections[id]))
	}
	return out
}

// songCues maps the ids of all a Song's cued Lines, wherever they are, to
// their Cues.
func songCues(s song) map[int64]float64 {
	cues := map[int64]float64{}
	for _, sec := range s.Sections {
		for id, cue := range cuesOf(sec) {
			cues[id] = cue
		}
	}
	return cues
}

// songSummary is one entry of the Song list.
type songSummary struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	Key       string `json:"key"`
	BPM       *int   `json:"bpm"`
	HasMaster bool   `json:"hasMaster"`
	CoverID   *int64 `json:"coverId"`
	UpdatedAt string `json:"updatedAt"`
}

// songPath is where a Song lives.
func songPath(id int64) string {
	return fmt.Sprintf("/api/songs/%d", id)
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
	res := ts.Do(http.MethodGet, songPath(id), nil)
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

// patchSong sends changes to a Song without checking the response.
func (ts *testServer) patchSong(id int64, changes map[string]any) response {
	ts.t.Helper()
	return ts.Do(http.MethodPatch, songPath(id), changes)
}

// updateSong applies changes to a Song and returns its aggregate.
func (ts *testServer) updateSong(id int64, changes map[string]any) song {
	ts.t.Helper()
	res := ts.patchSong(id, changes)
	expectStatus(ts.t, res, http.StatusOK)
	var s song
	res.JSON(ts.t, &s)
	return s
}

// lyricSheetChange sends a Lyric Sheet change, expects it to succeed and
// returns the updated Song aggregate.
func (ts *testServer) lyricSheetChange(method, path string, body any) song {
	ts.t.Helper()
	res := ts.Do(method, path, body)
	expectStatus(ts.t, res, http.StatusOK)
	var s song
	res.JSON(ts.t, &s)
	return s
}

// addSection adds a Section to a Song's Arrangement and returns the Song.
// body may set "label" and "position".
func (ts *testServer) addSection(songID int64, body map[string]any) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPost, fmt.Sprintf("/api/songs/%d/sections", songID), body)
}

// setText replaces an Alternate's text and returns the Song.
func (ts *testServer) setText(songID, alternateID int64, text string) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPut,
		fmt.Sprintf("/api/songs/%d/alternates/%d/text", songID, alternateID), map[string]any{"text": text})
}

// setLabel changes a Section's Label and returns the Song.
func (ts *testServer) setLabel(songID, sectionID int64, label string) song {
	ts.t.Helper()
	return ts.lyricSheetChange(http.MethodPatch,
		fmt.Sprintf("/api/songs/%d/sections/%d", songID, sectionID), map[string]any{"label": label})
}

// titles lists the Song titles in order.
func titles(list []songSummary) []string {
	out := []string{}
	for _, s := range list {
		out = append(out, s.Title)
	}
	return out
}

// parseTime reads a timestamp as the API returns it.
func parseTime(t *testing.T, s string) time.Time {
	t.Helper()
	got, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatalf("parsing time %q: %v", s, err)
	}
	return got
}

// beat is a Beat as the API returns it.
type beat struct {
	ID          int64       `json:"id"`
	Title       string      `json:"title"`
	Producer    string      `json:"producer"`
	SourceLink  string      `json:"sourceLink"`
	BPM         *int        `json:"bpm"`
	Key         string      `json:"key"`
	Notes       string      `json:"notes"`
	FileName    string      `json:"fileName"`
	ContentType string      `json:"contentType"`
	Size        int64       `json:"size"`
	Duration    float64     `json:"duration"`
	Peaks       []float64   `json:"peaks"`
	Songs       []songTitle `json:"songs"`
	CreatedAt   string      `json:"createdAt"`
	UpdatedAt   string      `json:"updatedAt"`
}

// songTitle names a Song, e.g. one using a Beat.
type songTitle struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// audioUpload is an audio file sent with what the browser worked out from
// decoding it.
type audioUpload struct {
	FileName    string
	ContentType string
	Data        []byte
	// Details holds the other form fields (title, producer, duration,
	// peaks...), sent as the JSON "details" part.
	Details map[string]any
}

// fakeAudio is a stand-in for an audio file: the server keeps files as
// uploaded and never decodes them.
func fakeAudio(fileName string) audioUpload {
	return audioUpload{
		FileName:    fileName,
		ContentType: "audio/mpeg",
		Data:        []byte("ID3 not really an mp3, but the server never decodes it: " + fileName),
		Details: map[string]any{
			"duration": 2.5,
			"peaks":    []float64{0.1, 0.5, 1, 0.25},
		},
	}
}

// with returns a copy of the upload with extra details.
func (u audioUpload) with(details map[string]any) audioUpload {
	merged := map[string]any{}
	for k, v := range u.Details {
		merged[k] = v
	}
	for k, v := range details {
		merged[k] = v
	}
	u.Details = merged
	return u
}

// SendUpload sends an audio file as a multipart form, as the SPA does.
func (ts *testServer) SendUpload(method, path string, u audioUpload) response {
	ts.t.Helper()
	return ts.sendUpload(method, path, nil, u)
}

// SendUploadAt sends an upload based on a given version of the Song.
func (ts *testServer) SendUploadAt(version int64, method, path string, u audioUpload) response {
	ts.t.Helper()
	return ts.sendUpload(method, path, http.Header{"If-Match": {fmt.Sprintf("%q", fmt.Sprint(version))}}, u)
}

func (ts *testServer) sendUpload(method, path string, header http.Header, u audioUpload) response {
	ts.t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	details, err := json.Marshal(u.Details)
	if err != nil {
		ts.t.Fatalf("encoding details: %v", err)
	}
	if err := form.WriteField("details", string(details)); err != nil {
		ts.t.Fatal(err)
	}
	part, err := form.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {fmt.Sprintf(`form-data; name="file"; filename=%q`, u.FileName)},
		"Content-Type":        {u.ContentType},
	})
	if err != nil {
		ts.t.Fatal(err)
	}
	if _, err := part.Write(u.Data); err != nil {
		ts.t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		ts.t.Fatal(err)
	}
	header = header.Clone()
	if header == nil {
		header = http.Header{}
	}
	header.Set("Content-Type", form.FormDataContentType())
	return ts.DoRaw(method, path, header, &body)
}

// beatPath is where a Beat lives.
func beatPath(id int64) string {
	return fmt.Sprintf("/api/beats/%d", id)
}

// uploadBeat adds a Beat to the Beat Library and returns it.
func (ts *testServer) uploadBeat(u audioUpload) beat {
	ts.t.Helper()
	res := ts.SendUpload(http.MethodPost, "/api/beats", u)
	expectStatus(ts.t, res, http.StatusCreated)
	var b beat
	res.JSON(ts.t, &b)
	return b
}

// getBeat reads one Beat, with its peaks.
func (ts *testServer) getBeat(id int64) beat {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, beatPath(id), nil)
	expectStatus(ts.t, res, http.StatusOK)
	var b beat
	res.JSON(ts.t, &b)
	return b
}

// listBeats reads the Beat Library, with an optional query string such as
// "q=trap".
func (ts *testServer) listBeats(query ...string) []beat {
	ts.t.Helper()
	path := "/api/beats"
	if len(query) > 0 {
		path += "?" + query[0]
	}
	res := ts.Do(http.MethodGet, path, nil)
	expectStatus(ts.t, res, http.StatusOK)
	var list []beat
	res.JSON(ts.t, &list)
	return list
}

// beatTitles lists the Beat titles in order.
func beatTitles(list []beat) []string {
	out := []string{}
	for _, b := range list {
		out = append(out, b.Title)
	}
	return out
}

// master is a Master as the API returns it, in a Song or on its own.
type master struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Main        bool      `json:"main"`
	Notes       string    `json:"notes"`
	FileName    string    `json:"fileName"`
	ContentType string    `json:"contentType"`
	Size        int64     `json:"size"`
	Duration    float64   `json:"duration"`
	Peaks       []float64 `json:"peaks"`
	AddedAt     string    `json:"addedAt"`
}

// masterPath is where one of a Song's Masters lives.
func masterPath(songID, masterID int64) string {
	return fmt.Sprintf("/api/songs/%d/masters/%d", songID, masterID)
}

// uploadMaster adds a Master to a Song and returns the Song.
func (ts *testServer) uploadMaster(songID int64, u audioUpload) song {
	ts.t.Helper()
	res := ts.SendUpload(http.MethodPost, songPath(songID)+"/masters", u)
	expectStatus(ts.t, res, http.StatusOK)
	var s song
	res.JSON(ts.t, &s)
	return s
}

// masterNames lists a Song's Masters by name, with the main one starred.
func masterNames(s song) []string {
	out := []string{}
	for _, m := range s.Masters {
		name := m.Name
		if m.Main {
			name += "*"
		}
		out = append(out, name)
	}
	return out
}
