// Command ptpt builds Portuguese (Portugal)'s data, pt-PT.txt.gz: a
// pronouncing dictionary in English's layout, one word a line with its
// phones, a stress digit on each vowel ("amor AX0 M O1 R"), gzipped.
//
// Its words are the European Portuguese Hunspell dictionary's, as
// LibreOffice ships it (hunspell.go). eSpeak NG says each one (espeak.go),
// and its IPA is written in one phone set (phones.go). Where Wiktionary has
// the word, as WikiPron scraped it, its readings settle whether the stressed
// vowel is open or closed (wiktionary.go). Then overrides.txt, checked by
// hand, corrects the rest, and picks the usual reading of a word spelt the
// same as another. Each word has one pronunciation, the most usual.
//
// go generate runs it in internal/languagedata, so it needs network access,
// and eSpeak NG at the pinned version: espeak-ng, or the command in
// $ESPEAK_NG, such as a container's, as CONTRIBUTING.md says.
package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	_ "embed"
	"fmt"
	"io"
	"log"
	"maps"
	"net/http"
	"os"
	"slices"
	"strings"
)

// overrides are pronunciations checked by hand, which take the place of
// those worked out: "word PHONES", one a line, with # comments.
//
//go:embed overrides.txt
var overrides string

func main() {
	if err := checkEspeak(); err != nil {
		log.Fatal(err)
	}
	words, err := hunspellWords()
	if err != nil {
		log.Fatal(err)
	}
	readings, err := wiktionaryReadings()
	if err != nil {
		log.Fatal(err)
	}
	said, err := sayAll(words)
	if err != nil {
		log.Fatal(err)
	}
	dictionary := map[string][]string{}
	var left []string
	corrected := 0
	for _, word := range words {
		phones, ok, err := phonesOf(word, said[word])
		if err != nil {
			log.Fatal(err)
		}
		if !ok {
			left = append(left, word)
			continue
		}
		dictionary[word] = withWiktionaryVowel(word, phones, readings[word])
		if !slices.Equal(dictionary[word], phones) {
			corrected++
		}
	}
	log.Printf("Wiktionary corrected %d stressed vowels", corrected)
	log.Printf("left out %d words eSpeak NG doesn't read as Portuguese: %s", len(left), strings.Join(left, " "))
	if err := override(dictionary, overrides); err != nil {
		log.Fatal(err)
	}
	if err := write("pt-PT.txt.gz", dictionary); err != nil {
		log.Fatal(err)
	}
}

// override puts the pronunciations checked by hand in the dictionary.
func override(dictionary map[string][]string, text string) error {
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line, _, _ := strings.Cut(sc.Text(), "#")
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if len(fields) < 2 {
			return fmt.Errorf("overrides.txt: %q has no phones", line)
		}
		for _, p := range fields[1:] {
			if !isPhone(p) {
				return fmt.Errorf("overrides.txt: %s's %q isn't a phone", fields[0], p)
			}
		}
		dictionary[fields[0]] = fields[1:]
	}
	return sc.Err()
}

// isPhone reports whether p is one of the phone set's: a vowel with its
// stress, or a consonant.
func isPhone(p string) bool {
	if vowel, ok := strings.CutSuffix(p, p[len(p)-1:]); ok && strings.ContainsAny(p[len(p)-1:], "012") {
		return slices.Contains(slices.Collect(maps.Values(vowelPhones)), vowel) ||
			slices.Contains(slices.Collect(maps.Values(nasalDiphthongOf)), vowel)
	}
	return slices.Contains(slices.Collect(maps.Values(consonantPhones)), p)
}

// write writes the dictionary, a word a line, sorted, gzipped. Without a
// name or time in its header, the same text always gzips the same, so
// regenerating changes nothing unless the dictionary did.
func write(path string, dictionary map[string][]string) error {
	var out bytes.Buffer
	zw, err := gzip.NewWriterLevel(&out, gzip.BestCompression)
	if err != nil {
		return err
	}
	for _, word := range slices.Sorted(maps.Keys(dictionary)) {
		if _, err := fmt.Fprintln(zw, word, strings.Join(dictionary[word], " ")); err != nil {
			return err
		}
	}
	if err := zw.Close(); err != nil {
		return err
	}
	return os.WriteFile(path, out.Bytes(), 0o644)
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
