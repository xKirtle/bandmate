package app_test

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/xKirtle/bandmate/internal/app"
)

// The page counts syllables itself, from each Language's data, which the
// binary carries and serves (ADR 0018).

func TestEnglishDataIsServedFromTheBinary(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodGet, "/api/languages/en", nil)

	expectStatus(t, res, http.StatusOK)
	if !strings.Contains(string(res.Body), "\nhello HH AH0 L OW1\n") {
		t.Errorf("English data doesn't hold hello's pronunciation; it starts %q", res.Body[:min(len(res.Body), 200)])
	}
	if res.Header.Get("ETag") == "" {
		t.Error("English data has no ETag, so the browser can't keep it")
	}
}

func TestLanguageDataIsSentCompressedWhenTheBrowserTakesIt(t *testing.T) {
	ts := newTestServer(t)

	res := ts.DoRaw(http.MethodGet, "/api/languages/en", http.Header{"Accept-Encoding": {"gzip"}}, nil)

	expectStatus(t, res, http.StatusOK)
	if got := res.Header.Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	zr, err := gzip.NewReader(bytes.NewReader(res.Body))
	if err != nil {
		t.Fatalf("reading gzip: %v", err)
	}
	text, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("reading gzip: %v", err)
	}
	if !bytes.Contains(text, []byte("\nhello HH AH0 L OW1\n")) {
		t.Error("compressed English data doesn't hold hello's pronunciation")
	}
}

func TestLanguageDataTheBrowserKeptIsntSentAgain(t *testing.T) {
	ts := newTestServer(t)
	first := ts.Do(http.MethodGet, "/api/languages/en", nil)

	res := ts.DoRaw(http.MethodGet, "/api/languages/en", http.Header{"If-None-Match": {first.Header.Get("ETag")}}, nil)

	expectStatus(t, res, http.StatusNotModified)
}

func TestLanguageDataSentCompressedOrNotIsTaggedApart(t *testing.T) {
	ts := newTestServer(t)
	plain := ts.DoRaw(http.MethodGet, "/api/languages/en", http.Header{"Accept-Encoding": {"identity"}}, nil)
	gzipped := ts.DoRaw(http.MethodGet, "/api/languages/en", http.Header{"Accept-Encoding": {"gzip"}}, nil)

	if plain.Header.Get("ETag") == gzipped.Header.Get("ETag") {
		t.Errorf("plain and gzipped data share the ETag %s", plain.Header.Get("ETag"))
	}
	res := ts.DoRaw(http.MethodGet, "/api/languages/en", http.Header{
		"Accept-Encoding": {"gzip"},
		"If-None-Match":   {`"other", W/` + gzipped.Header.Get("ETag")},
	}, nil)
	expectStatus(t, res, http.StatusNotModified)
}

func TestALanguageBandmateHasNoDataForIsNotFound(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodGet, "/api/languages/xx", nil)

	expectError(t, res, http.StatusNotFound, "there's no language \"xx\"")
}

func TestAboutCreditsTheDataThatShips(t *testing.T) {
	got := getDependencies(t, func(*app.Config) {})

	i := slices.IndexFunc(got.Data, func(d dependency) bool { return d.Name == "CMU Pronouncing Dictionary" })
	if i < 0 {
		t.Fatalf("data = %+v, want the CMU Pronouncing Dictionary", got.Data)
	}
	if d := got.Data[i]; d.Version == "" || d.License != "BSD-2-Clause" {
		t.Errorf("CMU Pronouncing Dictionary = %+v, want a version and BSD-2-Clause", d)
	}
}
