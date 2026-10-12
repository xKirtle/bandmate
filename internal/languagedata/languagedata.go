// Package languagedata holds the data each Language is rhymed from, built
// into the binary and served to the page, which works out Rhymes itself
// (ADR 0018).
package languagedata

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"io"
	"maps"
	"slices"
	"sync"

	"github.com/xKirtle/bandmate/internal/build"
)

// en.txt.gz is English's: the CMU Pronouncing Dictionary, one pronunciation
// a line ("hello HH AH0 L OW1"), a word with several on as many lines,
// gzipped, under the licence in en.LICENSE, which the About page names. It's
// committed, so every build has it: to take a newer
// dictionary, change cmudictCommit in ./cmudict, and cmudictVersion here,
// then run `go generate ./internal/languagedata`.
//
//go:generate go run ./cmudict
//go:embed en.txt.gz
var english []byte

// cmudictVersion is the commit of github.com/cmusphinx/cmudict that
// en.txt.gz was built from, shortened.
const cmudictVersion = "7479086"

// pt.txt.gz is Portuguese's: the words of the European Portuguese Hunspell
// dictionary, with the forms they're sung in, one a line, gzipped, under
// the licence in pt.LICENSE, which the About page names. Portuguese words
// are read by their spelling, so the page needs it only to suggest Rhymes
// from. It's committed, so every build has it: to take a newer
// dictionary, change dictionariesCommit in ./ptwords, and
// dictionariesVersion here, then run `go generate ./internal/languagedata`.
//
//go:generate go run ./ptwords
//go:embed pt.txt.gz
var portuguese []byte

// dictionariesVersion is the commit of github.com/LibreOffice/dictionaries
// that pt.txt.gz was built from, shortened.
const dictionariesVersion = "fe49c66"

// en.ranks.txt.gz and pt.ranks.txt.gz are each Language's ranks: the words
// its dictionary has among the 50,000 most said in the OpenSubtitles 2018
// corpus, as FrequencyWords counts them, most common first, one a line,
// gzipped, under the licences in en.ranks.LICENSE and pt.ranks.LICENSE,
// which the About page names. The page suggests common Rhymes first by
// them. They're built from the dictionaries above, so after them, and
// committed, so every build has them: to take newer lists, change
// frequencyWordsCommit in ./frequencywords, and frequencyWordsVersion here,
// then run `go generate ./internal/languagedata`.
//
//go:generate go run ./frequencywords
//go:embed en.ranks.txt.gz
var englishRanks []byte

//go:embed pt.ranks.txt.gz
var portugueseRanks []byte

// frequencyWordsVersion is the commit of github.com/hermitdave/FrequencyWords
// that the ranks were built from, shortened.
const frequencyWordsVersion = "525f9b5"

// Data is one Language's data as the page fetches it: gzipped text, with a
// tag that changes whenever it does. The text is the Language's dictionary,
// then a "#ranks" line, then its ranks.
type Data struct {
	Gzipped []byte
	ETag    string
}

// sources is each Language's dictionary and ranks, each gzipped.
var sources = map[string][2][]byte{
	"en": {english, englishRanks},
	"pt": {portuguese, portugueseRanks},
}

// byCode is each Language's data, joined from its sources the first time
// any is asked for, as gzipping it takes a moment.
var byCode = sync.OnceValue(func() map[string]Data {
	data := make(map[string]Data, len(sources))
	for code, s := range sources {
		data[code] = withTag(joined(s[0], s[1]))
	}
	return data
})

// joined is a Language's dictionary, a "#ranks" line and its ranks,
// gzipped as one, as a browser reads a single gzip stream.
func joined(dictionary, ranks []byte) []byte {
	var out bytes.Buffer
	zw, err := gzip.NewWriterLevel(&out, gzip.BestCompression)
	if err != nil {
		panic(err)
	}
	gunzipTo(zw, dictionary)
	if _, err := io.WriteString(zw, "#ranks\n"); err != nil {
		panic(err)
	}
	gunzipTo(zw, ranks)
	if err := zw.Close(); err != nil {
		panic(err)
	}
	return out.Bytes()
}

// gunzipTo writes embedded gzipped data to w, uncompressed. It's built
// into the binary, so data that can't be read is a broken build.
func gunzipTo(w io.Writer, gzipped []byte) {
	zr, err := gzip.NewReader(bytes.NewReader(gzipped))
	if err != nil {
		panic("languagedata: can't read embedded data; run go generate ./internal/languagedata: " + err.Error())
	}
	if _, err := io.Copy(w, zr); err != nil {
		panic("languagedata: can't read embedded data; run go generate ./internal/languagedata: " + err.Error())
	}
}

func withTag(gzipped []byte) Data {
	sum := sha256.Sum256(gzipped)
	return Data{Gzipped: gzipped, ETag: `"` + hex.EncodeToString(sum[:8]) + `"`}
}

// Codes are the ISO 639-1 codes of every Language Bandmate has data for, in order.
func Codes() []string {
	return slices.Sorted(maps.Keys(sources))
}

// Of is the data of the Language with an ISO 639-1 code, and whether
// Bandmate has any for it.
func Of(code string) (Data, bool) {
	d, ok := byCode()[code]
	return d, ok
}

// Credits is the data that ships in Bandmate, as the About page lists it
// beside the packages: whose it is, which version, and its licence.
func Credits() []build.Dependency {
	return []build.Dependency{
		{Name: "CMU Pronouncing Dictionary", Version: cmudictVersion, License: "BSD-2-Clause"},
		{Name: "Hunspell dictionary for European Portuguese", Version: dictionariesVersion, License: "GPL-2.0-only OR LGPL-2.1-only OR MPL-1.1"},
		{
			Name:    "FrequencyWords by Hermit Dave",
			Version: frequencyWordsVersion,
			License: "CC-BY-SA-4.0",
			Credit: []build.Link{
				{Text: "Word frequencies from "},
				{Text: "FrequencyWords", URL: "https://github.com/hermitdave/FrequencyWords"},
				{Text: " by Hermit Dave, "},
				{Text: "CC BY-SA 4.0", URL: "https://creativecommons.org/licenses/by-sa/4.0/"},
				{Text: ", built from the "},
				{Text: "OpenSubtitles 2018 corpus", URL: "https://opus.nlpl.eu/legacy/OpenSubtitles-v2018.php"},
				{Text: " (OPUS; "},
				{Text: "P. Lison & J. Tiedemann, 2016", URL: "https://aclanthology.org/L16-1147/"},
				{Text: "), with subtitles from "},
				{Text: "opensubtitles.org", URL: "https://www.opensubtitles.org/"},
				{Text: "."},
			},
		},
	}
}
