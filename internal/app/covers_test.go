package app_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"github.com/xKirtle/bandmate/internal/app"
)

func TestAddedCoverIsPartOfTheSong(t *testing.T) {
	ts := newTestServer(t)
	before := ts.createSong("Night Drive")
	ts.createSong("Edited Since")
	upload := fakeCover()

	res := ts.sendCoverAt(before.Version, before.ID, upload)

	expectStatus(t, res, http.StatusOK)
	var got song
	res.JSON(t, &got)
	if got.Cover == nil {
		t.Fatalf("cover = nil, want one")
	}
	want := cover{
		ID:      got.Cover.ID,
		Width:   1600,
		Height:  1200,
		Crop:    coverCrop{X: 200, Y: 0, Size: 1200},
		AddedAt: got.Cover.AddedAt,
	}
	if !reflect.DeepEqual(*got.Cover, want) {
		t.Errorf("cover = %+v, want %+v", *got.Cover, want)
	}
	if got.Cover.AddedAt == "" {
		t.Error("addedAt is empty")
	}
	if got.Version == before.Version {
		t.Errorf("version = %d, want it changed", got.Version)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want it after %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(before.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
	first := ts.listSongs()[0]
	if first.ID != before.ID {
		t.Errorf("top of the Song list = %q, want the Song given a Cover", first.Title)
	}
	if first.CoverID == nil || *first.CoverID != got.Cover.ID {
		t.Errorf("coverId in the Song list = %v, want %d", first.CoverID, got.Cover.ID)
	}

	for picture, data := range map[string][]byte{
		"original": upload.Original, "list": upload.List, "header": upload.Header,
	} {
		served := ts.Do(http.MethodGet, songPath(before.ID)+"/cover/"+picture, nil)
		expectStatus(t, served, http.StatusOK)
		if !bytes.Equal(served.Body, data) {
			t.Errorf("%s = %q, want it as uploaded: %q", picture, served.Body, data)
		}
		if got := served.Header.Get("Content-Type"); got != "image/webp" {
			t.Errorf("%s Content-Type = %q, want image/webp", picture, got)
		}
	}
}

func TestASongWithoutACoverHasNone(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	if s.Cover != nil {
		t.Errorf("cover = %+v, want none", *s.Cover)
	}
	if id := ts.listSongs()[0].CoverID; id != nil {
		t.Errorf("coverId in the Song list = %d, want none", *id)
	}
	expectStatus(t, ts.Do(http.MethodGet, songPath(s.ID)+"/cover/list", nil), http.StatusNotFound)
}

func TestACoverOnAStaleSongVersionIsRefused(t *testing.T) {
	ts := newTestServer(t)
	old := ts.createSong("Night Drive")
	current := ts.updateSong(old.ID, map[string]any{"notes": "Edited in another tab"})

	expectStale(t, ts.sendCoverAt(old.Version, old.ID, fakeCover()))

	if read := ts.getSong(old.ID); !reflect.DeepEqual(read, current) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, current)
	}
	if files := coverFiles(t, ts); len(files) != 0 {
		t.Errorf("cover files on disk = %q, want none", files)
	}
}

func TestASongHasAtMostOneCover(t *testing.T) {
	ts := newTestServer(t)
	s := ts.addCover(ts.createSong("Night Drive").ID, fakeCover())
	before := coverFiles(t, ts)

	expectError(t, ts.sendCoverAt(s.Version, s.ID, fakeCover()), http.StatusConflict, "this Song already has a Cover")

	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, s)
	}
	if files := coverFiles(t, ts); !reflect.DeepEqual(files, before) {
		t.Errorf("cover files on disk = %q, want only the first Cover's: %q", files, before)
	}
}

func TestACoverNeedsItsPicturesAndACropInsideTheOriginal(t *testing.T) {
	cases := map[string]struct {
		upload coverUpload
		msg    string
	}{
		"no header":  {fakeCover().without("header"), "header is required"},
		"no details": {fakeCover().withDetails(nil), "details are required"},
		"unknown detail": {fakeCover().withDetails(map[string]any{"title": "A"}),
			"details must be valid JSON with known fields"},
		"no size": {fakeCover().withDetails(map[string]any{
			"width": 0, "height": 1200, "crop": map[string]any{"x": 0, "y": 0, "size": 1},
		}), "the original must be between 1 and 2048 pixels on each side"},
		"too big": {fakeCover().withDetails(map[string]any{
			"width": 4000, "height": 3000, "crop": map[string]any{"x": 0, "y": 0, "size": 3000},
		}), "the original must be between 1 and 2048 pixels on each side"},
		"crop outside": {fakeCover().withDetails(map[string]any{
			"width": 1600, "height": 1200, "crop": map[string]any{"x": 500, "y": 0, "size": 1200},
		}), "the crop must be a square inside the original"},
		"empty crop": {fakeCover().withDetails(map[string]any{
			"width": 1600, "height": 1200, "crop": map[string]any{"x": 0, "y": 0, "size": 0},
		}), "the crop must be a square inside the original"},
		"empty picture": {fakeCover().withData("list", nil), "a Cover's pictures can't be empty"},
		"not a picture": {fakeCover().withType("list", "text/html"), "a Cover's pictures must be JPEG, PNG or WebP"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)
			s := ts.createSong("Night Drive")

			expectError(t, ts.sendCoverAt(s.Version, s.ID, c.upload), http.StatusBadRequest, c.msg)

			if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, s)
			}
			if files := coverFiles(t, ts); len(files) != 0 {
				t.Errorf("cover files on disk = %q, want none", files)
			}
		})
	}
}

func TestCoverUploadsOverTheCoverLimitAreRefused(t *testing.T) {
	// The Cover limit is its own: far below the audio one.
	ts := newTestServerWith(t, func(c *app.Config) { c.MaxCoverBytes = 1 << 20 })
	s := ts.createSong("Night Drive")
	big := fakeCover()
	big.Original = bytes.Repeat([]byte{1}, 1<<20+1)

	expectError(t, ts.sendCoverAt(s.Version, s.ID, big),
		http.StatusRequestEntityTooLarge, "the pictures are larger than the Cover limit of 1 MB")

	if read := ts.getSong(s.ID); read.Cover != nil {
		t.Errorf("cover = %+v, want none", *read.Cover)
	}
	if files := coverFiles(t, ts); len(files) != 0 {
		t.Errorf("cover files on disk = %q, want none", files)
	}
}

func TestTheCoverLimitIsInTheConfig(t *testing.T) {
	ts := newTestServerWith(t, func(c *app.Config) { c.MaxCoverBytes = 3 << 20 })
	var config struct {
		MaxCoverBytes int64 `json:"maxCoverBytes"`
	}
	ts.Do(http.MethodGet, "/api/config", nil).JSON(t, &config)

	if config.MaxCoverBytes != 3<<20 {
		t.Errorf("maxCoverBytes = %d, want %d", config.MaxCoverBytes, 3<<20)
	}
	var defaults struct {
		MaxCoverBytes int64 `json:"maxCoverBytes"`
	}
	newTestServer(t).Do(http.MethodGet, "/api/config", nil).JSON(t, &defaults)
	if defaults.MaxCoverBytes != 25<<20 {
		t.Errorf("default maxCoverBytes = %d, want 25 MB", defaults.MaxCoverBytes)
	}
}

func TestDeletingASongDeletesItsCoversFiles(t *testing.T) {
	ts := newTestServer(t)
	gone := ts.addCover(ts.createSong("Night Drive").ID, fakeCover())
	kept := ts.addCover(ts.createSong("Kept").ID, fakeCover())

	expectStatus(t, ts.Do(http.MethodDelete, songPath(gone.ID), nil), http.StatusNoContent)

	id := fmt.Sprint(kept.Cover.ID)
	want := []string{"header/" + id, "list/" + id, "original/" + id}
	if files := coverFiles(t, ts); !reflect.DeepEqual(files, want) {
		t.Errorf("cover files on disk = %q, want only the kept Song's: %q", files, want)
	}
	expectStatus(t, ts.Do(http.MethodGet, songPath(kept.ID)+"/cover/header", nil), http.StatusOK)
}

func TestCoversSurviveARestart(t *testing.T) {
	ts := newTestServer(t)
	upload := fakeCover()
	s := ts.addCover(ts.createSong("Night Drive").ID, upload)
	ts.Stop()

	restarted := startTestServer(t, ts.DataDir)

	if read := restarted.getSong(s.ID); !reflect.DeepEqual(read.Cover, s.Cover) {
		t.Errorf("cover after restart = %+v, want %+v", read.Cover, s.Cover)
	}
	served := restarted.Do(http.MethodGet, songPath(s.ID)+"/cover/list", nil)
	if !bytes.Equal(served.Body, upload.List) {
		t.Errorf("list size after restart = %q, want %q", served.Body, upload.List)
	}
}

func TestReplacingACoverKeepsOnlyTheNewOne(t *testing.T) {
	ts := newTestServer(t)
	before := ts.addCover(ts.createSong("Night Drive").ID, fakeCover())
	kept := ts.addCover(ts.createSong("Kept").ID, fakeCover())
	upload := otherCover()

	res := ts.replaceCoverAt(before.Version, before.ID, upload)

	expectStatus(t, res, http.StatusOK)
	var got song
	res.JSON(t, &got)
	if got.Cover == nil {
		t.Fatalf("cover = nil, want the new one")
	}
	if got.Cover.ID == before.Cover.ID {
		t.Errorf("cover id = %d, want a new one, so its pictures' addresses change", got.Cover.ID)
	}
	want := cover{ID: got.Cover.ID, Width: 900, Height: 1600, Crop: coverCrop{X: 0, Y: 300, Size: 900}, AddedAt: got.Cover.AddedAt}
	if !reflect.DeepEqual(*got.Cover, want) {
		t.Errorf("cover = %+v, want %+v", *got.Cover, want)
	}
	if got.Version == before.Version {
		t.Errorf("version = %d, want it changed", got.Version)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want it after %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(before.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
	if id := ts.listSongs()[0].CoverID; id == nil || *id != got.Cover.ID {
		t.Errorf("coverId in the Song list = %v, want %d", id, got.Cover.ID)
	}
	for picture, data := range map[string][]byte{
		"original": upload.Original, "list": upload.List, "header": upload.Header,
	} {
		served := ts.Do(http.MethodGet, songPath(before.ID)+"/cover/"+picture, nil)
		expectStatus(t, served, http.StatusOK)
		if !bytes.Equal(served.Body, data) {
			t.Errorf("%s = %q, want the new one: %q", picture, served.Body, data)
		}
		if got := served.Header.Get("Content-Type"); got != "image/jpeg" {
			t.Errorf("%s Content-Type = %q, want image/jpeg", picture, got)
		}
	}
	if files, want := coverFiles(t, ts), coverFileNames(got.Cover.ID, kept.Cover.ID); !reflect.DeepEqual(files, want) {
		t.Errorf("cover files on disk = %q, want only the new Cover's and the other Song's: %q", files, want)
	}
}

func TestOnlyASongWithACoverCanHaveItReplaced(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	expectError(t, ts.replaceCoverAt(s.Version, s.ID, fakeCover()), http.StatusConflict, "this Song has no Cover")

	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, s)
	}
	if files := coverFiles(t, ts); len(files) != 0 {
		t.Errorf("cover files on disk = %q, want none", files)
	}
}

func TestAReplacementCoverIsCheckedLikeANewOne(t *testing.T) {
	ts := newTestServer(t)
	s := ts.addCover(ts.createSong("Night Drive").ID, fakeCover())
	before := coverFiles(t, ts)

	expectError(t, ts.replaceCoverAt(s.Version, s.ID, otherCover().withType("list", "text/html")),
		http.StatusBadRequest, "a Cover's pictures must be JPEG, PNG or WebP")

	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, s)
	}
	if files := coverFiles(t, ts); !reflect.DeepEqual(files, before) {
		t.Errorf("cover files on disk = %q, want the old Cover's: %q", files, before)
	}
}

func TestRemovingACoverDeletesItAndItsFiles(t *testing.T) {
	ts := newTestServer(t)
	before := ts.addCover(ts.createSong("Night Drive").ID, fakeCover())
	kept := ts.addCover(ts.createSong("Kept").ID, fakeCover())

	res := ts.DoAt(before.Version, http.MethodDelete, songPath(before.ID)+"/cover", nil)

	expectStatus(t, res, http.StatusOK)
	var got song
	res.JSON(t, &got)
	if got.Cover != nil {
		t.Errorf("cover = %+v, want none", *got.Cover)
	}
	if got.Version == before.Version {
		t.Errorf("version = %d, want it changed", got.Version)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want it after %s", got.UpdatedAt, before.UpdatedAt)
	}
	if read := ts.getSong(before.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
	if id := ts.listSongs()[0].CoverID; id != nil {
		t.Errorf("coverId in the Song list = %d, want none", *id)
	}
	expectStatus(t, ts.Do(http.MethodGet, songPath(before.ID)+"/cover/list", nil), http.StatusNotFound)
	if files, want := coverFiles(t, ts), coverFileNames(kept.Cover.ID); !reflect.DeepEqual(files, want) {
		t.Errorf("cover files on disk = %q, want only the other Song's: %q", files, want)
	}
}

func TestOnlyASongWithACoverCanHaveItRemoved(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	expectError(t, ts.DoAt(s.Version, http.MethodDelete, songPath(s.ID)+"/cover", nil),
		http.StatusConflict, "this Song has no Cover")

	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, s)
	}
}

func TestChangingACoverOnAStaleSongVersionIsRefused(t *testing.T) {
	for name, send := range map[string]func(ts *testServer, version, songID int64) response{
		"replace": func(ts *testServer, version, songID int64) response {
			return ts.replaceCoverAt(version, songID, otherCover())
		},
		"remove": func(ts *testServer, version, songID int64) response {
			return ts.DoAt(version, http.MethodDelete, songPath(songID)+"/cover", nil)
		},
	} {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)
			old := ts.addCover(ts.createSong("Night Drive").ID, fakeCover())
			current := ts.updateSong(old.ID, map[string]any{"notes": "Edited in another tab"})
			before := coverFiles(t, ts)

			expectStale(t, send(ts, old.Version, old.ID))

			if read := ts.getSong(old.ID); !reflect.DeepEqual(read, current) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, current)
			}
			if files := coverFiles(t, ts); !reflect.DeepEqual(files, before) {
				t.Errorf("cover files on disk = %q, want the old Cover's: %q", files, before)
			}
		})
	}
}

// cover is a Song's Cover as the API returns it.
type cover struct {
	ID int64 `json:"id"`
	// Width and Height are the original's, in pixels.
	Width   int       `json:"width"`
	Height  int       `json:"height"`
	Crop    coverCrop `json:"crop"`
	AddedAt string    `json:"addedAt"`
}

// coverCrop is the square of the original the Cover shows, in its pixels.
type coverCrop struct {
	X    int `json:"x"`
	Y    int `json:"y"`
	Size int `json:"size"`
}

// coverUpload is what the browser sends to add a Cover: the pictures it
// made, and the details of the original and crop.
type coverUpload struct {
	Original, List, Header []byte
	// Types are the pictures' media types, by part name.
	Types map[string]string
	// Missing leaves out parts, by name.
	Missing map[string]bool
	// Details is sent as the JSON "details" part, unless nil.
	Details map[string]any
}

// fakeCover is a stand-in for a 1600×1200 picture, centre-cropped: the
// server keeps pictures as uploaded and never decodes them.
func fakeCover() coverUpload {
	return coverUpload{
		Original: []byte("RIFF not really a webp: original"),
		List:     []byte("RIFF not really a webp: list"),
		Header:   []byte("RIFF not really a webp: header"),
		Types:    map[string]string{"original": "image/webp", "list": "image/webp", "header": "image/webp"},
		Details: map[string]any{
			"width": 1600, "height": 1200, "crop": map[string]any{"x": 200, "y": 0, "size": 1200},
		},
	}
}

// otherCover is a stand-in for a 900×1600 JPEG, centre-cropped, unlike
// fakeCover in every way.
func otherCover() coverUpload {
	return coverUpload{
		Original: []byte("not really a jpeg: another original"),
		List:     []byte("not really a jpeg: another list"),
		Header:   []byte("not really a jpeg: another header"),
		Types:    map[string]string{"original": "image/jpeg", "list": "image/jpeg", "header": "image/jpeg"},
		Details: map[string]any{
			"width": 900, "height": 1600, "crop": map[string]any{"x": 0, "y": 300, "size": 900},
		},
	}
}

func (u coverUpload) without(part string) coverUpload {
	u.Missing = map[string]bool{part: true}
	return u
}

func (u coverUpload) withDetails(details map[string]any) coverUpload {
	u.Details = details
	return u
}

func (u coverUpload) withData(part string, data []byte) coverUpload {
	switch part {
	case "original":
		u.Original = data
	case "list":
		u.List = data
	case "header":
		u.Header = data
	}
	return u
}

func (u coverUpload) withType(part, contentType string) coverUpload {
	types := map[string]string{}
	for k, v := range u.Types {
		types[k] = v
	}
	types[part] = contentType
	u.Types = types
	return u
}

// sendCoverAt adds a Cover to a Song based on a given version of it, as the
// SPA does.
func (ts *testServer) sendCoverAt(version, songID int64, u coverUpload) response {
	ts.t.Helper()
	return ts.uploadCoverAt(http.MethodPost, version, songID, u)
}

// replaceCoverAt replaces a Song's Cover based on a given version of it, as
// the SPA does.
func (ts *testServer) replaceCoverAt(version, songID int64, u coverUpload) response {
	ts.t.Helper()
	return ts.uploadCoverAt(http.MethodPut, version, songID, u)
}

// uploadCoverAt sends a Cover's pictures with the given method.
func (ts *testServer) uploadCoverAt(method string, version, songID int64, u coverUpload) response {
	ts.t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	if u.Details != nil {
		details, err := json.Marshal(u.Details)
		if err != nil {
			ts.t.Fatalf("encoding details: %v", err)
		}
		if err := form.WriteField("details", string(details)); err != nil {
			ts.t.Fatal(err)
		}
	}
	for _, p := range []struct {
		name string
		data []byte
	}{{"original", u.Original}, {"list", u.List}, {"header", u.Header}} {
		if u.Missing[p.name] {
			continue
		}
		part, err := form.CreatePart(textproto.MIMEHeader{
			"Content-Disposition": {fmt.Sprintf(`form-data; name=%q; filename="%s.webp"`, p.name, p.name)},
			"Content-Type":        {u.Types[p.name]},
		})
		if err != nil {
			ts.t.Fatal(err)
		}
		if _, err := part.Write(p.data); err != nil {
			ts.t.Fatal(err)
		}
	}
	if err := form.Close(); err != nil {
		ts.t.Fatal(err)
	}
	header := http.Header{
		"Content-Type": {form.FormDataContentType()},
		"If-Match":     {fmt.Sprintf("%q", fmt.Sprint(version))},
	}
	return ts.DoRaw(method, songPath(songID)+"/cover", header, &body)
}

// addCover adds a Cover to a Song at its current version and returns the
// Song.
func (ts *testServer) addCover(songID int64, u coverUpload) song {
	ts.t.Helper()
	res := ts.sendCoverAt(ts.getSong(songID).Version, songID, u)
	expectStatus(ts.t, res, http.StatusOK)
	var s song
	res.JSON(ts.t, &s)
	return s
}

// coverFileNames are the files kept for the given Covers, as coverFiles
// lists them.
func coverFileNames(ids ...int64) []string {
	names := []string{}
	for _, picture := range []string{"original", "list", "header"} {
		for _, id := range ids {
			names = append(names, fmt.Sprintf("%s/%d", picture, id))
		}
	}
	sort.Strings(names)
	return names
}

// coverFiles lists the files stored for Covers in the data directory, as
// "picture/name", sorted.
func coverFiles(t *testing.T, ts *testServer) []string {
	t.Helper()
	names := []string{}
	for _, picture := range []string{"original", "list", "header"} {
		entries, err := os.ReadDir(filepath.Join(ts.DataDir, "covers", picture))
		if err != nil {
			t.Fatalf("reading cover directory: %v", err)
		}
		for _, e := range entries {
			names = append(names, picture+"/"+e.Name())
		}
	}
	sort.Strings(names)
	return names
}
