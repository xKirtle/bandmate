// Package languagedata holds the data each Language is counted and rhymed
// from, built into the binary and served to the page, which works out
// Syllable Counts and Rhymes itself (ADR 0018).
package languagedata

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"

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

// Data is one Language's data as the page fetches it: gzipped text, with a
// tag that changes whenever it does.
type Data struct {
	Gzipped []byte
	ETag    string
}

var byCode = map[string]Data{
	"en": withTag(english),
}

func withTag(gzipped []byte) Data {
	sum := sha256.Sum256(gzipped)
	return Data{Gzipped: gzipped, ETag: `"` + hex.EncodeToString(sum[:8]) + `"`}
}

// Of is the data of the Language with an ISO 639-1 code, and whether
// Bandmate has any for it.
func Of(code string) (Data, bool) {
	d, ok := byCode[code]
	return d, ok
}

// Credits is the data that ships in Bandmate, as the About page lists it
// beside the packages: whose it is, which version, and its licence.
func Credits() []build.Dependency {
	return []build.Dependency{
		{Name: "CMU Pronouncing Dictionary", Version: cmudictVersion, License: "BSD-2-Clause"},
	}
}
