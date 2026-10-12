// Package languagedata is the one register of the Languages Bandmate rhymes
// in, in registry below: each one's code, name, data and credit. A Song can
// be sung in only these, and the page offers only these, as the API lists
// them. Their data is built into the binary and served to the page, which
// works out Rhymes itself (ADR 0018). CONTRIBUTING.md's "Adding a rhyming
// language" says how to add one.
package languagedata

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"io"
	"slices"
	"sync"

	"github.com/xKirtle/bandmate/internal/build"
)

// Language is a Language Bandmate rhymes in.
type Language struct {
	// Code is its ISO 639-1 code, e.g. "en", which a Song's Languages name
	// it by.
	Code string
	// Name is its name in English, as the page shows it.
	Name string
	// dictionary is its data, gzipped: a pronouncing dictionary, one
	// pronunciation a line ("hello HH AH0 L OW1"), or a word list, one word
	// a line, for a Language the page reads by its spelling rules.
	dictionary []byte
	// ranks are the words of its dictionary most said, most common first,
	// one a line, gzipped, which the page suggests common Rhymes first by;
	// nil for a Language FrequencyWords has no list for.
	ranks []byte
	// credit is its dictionary's, as the About page lists it.
	credit build.Dependency
}

// registry is every Language Bandmate rhymes in, in the order the page
// lists them: by name.
var registry = []Language{
	{
		Code:       "en",
		Name:       "English",
		dictionary: english,
		ranks:      englishRanks,
		credit:     build.Dependency{Name: "CMU Pronouncing Dictionary", Version: cmudictVersion, License: "BSD-2-Clause"},
	},
	{
		Code:       "pt",
		Name:       "Portuguese",
		dictionary: portuguese,
		ranks:      portugueseRanks,
		// Offered under GPL-2.0, LGPL-2.1 or MPL-1.1; Bandmate takes it
		// under LGPL-2.1, as pt.LICENSE says.
		credit: build.Dependency{Name: "Hunspell dictionary for European Portuguese", Version: dictionariesVersion, License: "LGPL-2.1-only"},
	},
}

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
// then a "#ranks" line, then its ranks, if it has any.
type Data struct {
	Gzipped []byte
	ETag    string
}

// byCode is each Language's data, joined the first time any is asked for,
// as gzipping it takes a moment.
var byCode = sync.OnceValue(func() map[string]Data {
	data := make(map[string]Data, len(registry))
	for _, l := range registry {
		gzipped, err := l.joined()
		if err != nil {
			panic("languagedata: can't read the embedded " + l.Code + " data; run go generate ./internal/languagedata: " + err.Error())
		}
		data[l.Code] = Data{Gzipped: gzipped, ETag: l.tag()}
	}
	return data
})

// joined is the Language's dictionary, then a "#ranks" line and its ranks,
// if it has any, gzipped as one, as a browser reads a single gzip stream.
func (l Language) joined() ([]byte, error) {
	var out bytes.Buffer
	zw, err := gzip.NewWriterLevel(&out, gzip.BestCompression)
	if err != nil {
		return nil, err
	}
	if err := gunzipTo(zw, l.dictionary); err != nil {
		return nil, err
	}
	if l.ranks != nil {
		if _, err := io.WriteString(zw, "#ranks\n"); err != nil {
			return nil, err
		}
		if err := gunzipTo(zw, l.ranks); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// gunzipTo writes gzipped data to w, uncompressed.
func gunzipTo(w io.Writer, gzipped []byte) error {
	zr, err := gzip.NewReader(bytes.NewReader(gzipped))
	if err != nil {
		return err
	}
	_, err = io.Copy(w, zr)
	return err
}

// tag is a tag of the Language's data, which changes whenever its parts
// do, but not when a newer Go gzips the same text differently.
func (l Language) tag() string {
	h := sha256.New()
	h.Write(l.dictionary)
	h.Write(l.ranks)
	return `"` + hex.EncodeToString(h.Sum(nil)[:8]) + `"`
}

// List is every Language Bandmate rhymes in, in the order the page lists
// them.
func List() []Language {
	return append([]Language(nil), registry...)
}

// Has reports whether Bandmate rhymes in the Language with an ISO 639-1
// code, so a Song can be sung in it.
func Has(code string) bool {
	return slices.ContainsFunc(registry, func(l Language) bool { return l.Code == code })
}

// Of is the data of the Language with an ISO 639-1 code, and whether
// Bandmate has any for it.
func Of(code string) (Data, bool) {
	d, ok := byCode()[code]
	return d, ok
}

// Credits is the data that ships in Bandmate, as the About page lists it
// beside the packages: whose it is, which version, and its licence. Each
// Language's dictionary, then the word frequencies they're ranked by.
func Credits() []build.Dependency {
	credits := make([]build.Dependency, 0, len(registry)+1)
	for _, l := range registry {
		credits = append(credits, l.credit)
	}
	return append(credits, build.Dependency{
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
			{Text: " ("},
			{Text: "OPUS", URL: "https://opus.nlpl.eu/"},
			{Text: "; "},
			{Text: "P. Lison & J. Tiedemann, 2016", URL: "https://aclanthology.org/L16-1147/"},
			{Text: "), with subtitles from "},
			{Text: "opensubtitles.org", URL: "https://www.opensubtitles.org/"},
			{Text: "."},
		},
	})
}
