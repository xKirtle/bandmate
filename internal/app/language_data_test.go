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

// The page finds Rhymes itself, in each Language's data, which the
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

func TestEachLanguageIsListedWithItsDownloadSize(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodGet, "/api/languages", nil)

	expectStatus(t, res, http.StatusOK)
	var got []struct {
		Code string `json:"code"`
		Size int    `json:"size"`
	}
	res.JSON(t, &got)
	codes := make([]string, len(got))
	for i, l := range got {
		codes[i] = l.Code
	}
	if !slices.Equal(codes, []string{"en", "pt"}) {
		t.Fatalf("languages = %v, want en and pt", codes)
	}
	// What a browser downloads, compressed, to set each up.
	en := ts.DoRaw(http.MethodGet, "/api/languages/en", http.Header{"Accept-Encoding": {"gzip"}}, nil)
	if got[0].Size != len(en.Body) {
		t.Errorf("English size = %d, want the %d bytes downloaded", got[0].Size, len(en.Body))
	}
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

func TestPortugueseWordsAreServedFromTheBinary(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodGet, "/api/languages/pt", nil)

	expectStatus(t, res, http.StatusOK)
	// Words, with the forms they're sung in, to suggest Rhymes from.
	for _, word := range []string{"coração", "canção", "amores", "cantava"} {
		if !strings.Contains(string(res.Body), "\n"+word+"\n") {
			t.Errorf("Portuguese data doesn't hold %q", word)
		}
	}
}

func TestAboutCreditsThePortugueseWordList(t *testing.T) {
	got := getDependencies(t, func(*app.Config) {})

	i := slices.IndexFunc(got.Data, func(d dependency) bool { return strings.Contains(d.Name, "Portuguese") })
	if i < 0 {
		t.Fatalf("data = %+v, want the Portuguese word list", got.Data)
	}
	if d := got.Data[i]; d.Version == "" || !strings.Contains(d.License, "LGPL-2.1") {
		t.Errorf("Portuguese word list = %+v, want a version and a licence that offers LGPL-2.1", d)
	}
}

// ranksOf is the words a Language's data ranks, most common first: the
// lines after its "#ranks" line.
func ranksOf(t *testing.T, body []byte) []string {
	t.Helper()
	_, ranks, ok := strings.Cut(string(body), "\n#ranks\n")
	if !ok {
		t.Fatal("the data has no ranks")
	}
	return strings.Fields(ranks)
}

func TestEachLanguagesDataRanksItsWordsMostCommonFirst(t *testing.T) {
	ts := newTestServer(t)

	en := ranksOf(t, ts.Do(http.MethodGet, "/api/languages/en", nil).Body)
	pt := ranksOf(t, ts.Do(http.MethodGet, "/api/languages/pt", nil).Body)

	if !slices.Equal(en[:3], []string{"you", "i", "the"}) {
		t.Errorf("English ranks start %v, want you, i, the", en[:3])
	}
	if !slices.Contains(en, "don't") || slices.Contains(en, "don") {
		t.Error(`English ranks "don't" by "don"'s count, so not "don" itself`)
	}
	// The subtitles' old spellings count as the dictionary's new ones.
	if !slices.Contains(pt, "ação") || slices.Contains(pt, "acção") {
		t.Error(`Portuguese ranks "ação", counting "acção", and not "acção"`)
	}
}

func TestAboutCreditsTheWordFrequencies(t *testing.T) {
	got := getDependencies(t, func(*app.Config) {})

	i := slices.IndexFunc(got.Data, func(d dependency) bool { return strings.Contains(d.Name, "FrequencyWords") })
	if i < 0 {
		t.Fatalf("data = %+v, want FrequencyWords", got.Data)
	}
	if d := got.Data[i]; d.Version == "" || d.License != "CC-BY-SA-4.0" {
		t.Errorf("FrequencyWords = %+v, want a version and CC-BY-SA-4.0", d)
	}
	// Its licence asks for an attribution, and OpenSubtitles for a link to opensubtitles.org.
	res := newTestServer(t).Do(http.MethodGet, "/api/about", nil)
	var about struct {
		Dependencies struct {
			Data []struct {
				Credit []struct {
					Text string `json:"text"`
					URL  string `json:"url"`
				} `json:"credit"`
			} `json:"data"`
		} `json:"dependencies"`
	}
	res.JSON(t, &about)
	var credit strings.Builder
	links := map[string]string{}
	for _, part := range about.Dependencies.Data[i].Credit {
		credit.WriteString(part.Text)
		links[part.Text] = part.URL
	}
	for _, want := range []string{"Hermit Dave", "CC BY-SA 4.0", "OpenSubtitles 2018", "Lison & J. Tiedemann, 2016"} {
		if !strings.Contains(credit.String(), want) {
			t.Errorf("FrequencyWords' credit %q doesn't name %q", credit.String(), want)
		}
	}
	if !strings.Contains(links["opensubtitles.org"], "opensubtitles.org") {
		t.Errorf("FrequencyWords' credit doesn't link to opensubtitles.org: %v", links)
	}
}
