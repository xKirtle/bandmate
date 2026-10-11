// Command ptwords builds Portuguese's data, pt.txt.gz, from the European
// Portuguese Hunspell dictionary that LibreOffice ships, at a pinned
// commit: one word a line, to suggest Rhymes from. Each of the
// dictionary's words is kept with the forms its suffixes make (plurals,
// genders, a verb's tenses), but not the forms its prefixes make, nor the
// verb tenses rarely sung (the imperfect and future subjunctive, the
// pluperfect, the personal infinitive, and vós). Only words written in
// lower-case letters are kept, so no names or abbreviations. go generate
// runs it in internal/languagedata, so it needs network access.
package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
)

// dictionariesCommit is the commit of github.com/LibreOffice/dictionaries
// to build from. Keep dictionariesVersion in languagedata.go in step with it.
const dictionariesCommit = "fe49c662796b47cb19732d18114610a58848f5cb"

// word is a word as it's kept: lower-case Portuguese letters only.
var word = regexp.MustCompile(`^[a-záàâãéêíóôõúüç]+$`)

// rare is the morphology of a suffix whose forms are left out.
var rare = regexp.MustCompile(`T=(pic|pmp|fc|ip)\b|P=2,N=p`)

// suffix is one of the affix file's suffix rules: it takes strip off a
// word that ends as condition says, and adds add.
type suffix struct {
	strip, add string
	condition  *regexp.Regexp
}

func main() {
	base := "https://raw.githubusercontent.com/LibreOffice/dictionaries/" + dictionariesCommit + "/pt_PT/pt_PT"
	aff, err := fetch(base + ".aff")
	if err != nil {
		log.Fatal(err)
	}
	dic, err := fetch(base + ".dic")
	if err != nil {
		log.Fatal(err)
	}
	suffixes, err := readSuffixes(bytes.NewReader(aff))
	if err != nil {
		log.Fatal(err)
	}
	words, err := expand(bytes.NewReader(dic), suffixes)
	if err != nil {
		log.Fatal(err)
	}
	// Without a name or time in its header, the same text always gzips the
	// same, so regenerating changes nothing unless the dictionary did.
	var out bytes.Buffer
	zw, err := gzip.NewWriterLevel(&out, gzip.BestCompression)
	if err != nil {
		log.Fatal(err)
	}
	for _, w := range words {
		if _, err := fmt.Fprintln(zw, w); err != nil {
			log.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile("pt.txt.gz", out.Bytes(), 0o644); err != nil {
		log.Fatal(err)
	}
}

func fetch(url string) ([]byte, error) {
	res, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching %s: %s", url, res.Status)
	}
	return io.ReadAll(res.Body)
}

// readSuffixes reads the affix file's suffix rules by their flag, leaving
// out those that make rare forms. A rule is "SFX flag strip add condition
// morphology", "0" meaning nothing.
func readSuffixes(aff io.Reader) (map[rune][]suffix, error) {
	suffixes := map[rune][]suffix{}
	sc := bufio.NewScanner(aff)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 5 || fields[0] != "SFX" {
			continue
		}
		if len(fields) > 5 && rare.MatchString(fields[5]) {
			continue
		}
		flag := []rune(fields[1])[0]
		strip, add := zeroIsNothing(fields[2]), zeroIsNothing(strings.SplitN(fields[3], "/", 2)[0])
		var condition *regexp.Regexp
		if fields[4] != "." {
			var err error
			if condition, err = regexp.Compile("(?:" + fields[4] + ")$"); err != nil {
				return nil, fmt.Errorf("suffix %s: %w", fields[1], err)
			}
		}
		suffixes[flag] = append(suffixes[flag], suffix{strip: strip, add: add, condition: condition})
	}
	return suffixes, sc.Err()
}

func zeroIsNothing(s string) string {
	if s == "0" {
		return ""
	}
	return s
}

// expand lists the dictionary's words, each "word/flags" and a tab before
// its morphology, with the forms their suffixes make, sorted.
func expand(dic io.Reader, suffixes map[rune][]suffix) ([]string, error) {
	seen := map[string]bool{}
	sc := bufio.NewScanner(dic)
	sc.Scan() // The first line is how many words there are.
	for sc.Scan() {
		entry, _, _ := strings.Cut(sc.Text(), "\t")
		stem, flags, _ := strings.Cut(entry, "/")
		if !word.MatchString(stem) {
			continue
		}
		seen[stem] = true
		for _, flag := range flags {
			for _, s := range suffixes[flag] {
				if !strings.HasSuffix(stem, s.strip) || (s.condition != nil && !s.condition.MatchString(stem)) {
					continue
				}
				if form := strings.TrimSuffix(stem, s.strip) + s.add; word.MatchString(form) {
					seen[form] = true
				}
			}
		}
	}
	words := make([]string, 0, len(seen))
	for w := range seen {
		words = append(words, w)
	}
	slices.Sort(words)
	return words, sc.Err()
}
