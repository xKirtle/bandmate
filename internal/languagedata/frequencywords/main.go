// Command frequencywords builds each Language's ranks, en.ranks.txt.gz and
// pt.ranks.txt.gz, from FrequencyWords by Hermit Dave at a pinned commit:
// how often each word is said in the OpenSubtitles 2018 corpus, a list for
// each Language of its 50,000 most common words. Each Language's ranks are
// the words of its list its dictionary has, most common first, one a line,
// so the page can suggest common Rhymes first. They're built from the
// Language's dictionary, en.txt.gz or pt.txt.gz, so go generate runs it
// after those, in internal/languagedata, and it needs network access.
//
// The lists count words as the subtitles spell them, so two Languages need
// a hand:
//
//   - English: the lists split a contraction at its apostrophe, so "don't"
//     is counted as "don" and "'t". A contraction takes its count from
//     contractions, below.
//   - Portuguese: the subtitles mostly spell words as before the 1990
//     spelling reform ("acção", "óptimo"), and the dictionary as after it
//     ("ação", "ótimo"). An old spelling's count goes to its new one, when
//     only the new one is a dictionary word.
package main

import (
	"bufio"
	"bytes"
	"cmp"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// frequencyWordsCommit is the commit of github.com/hermitdave/FrequencyWords
// to build from. Keep frequencyWordsVersion in languagedata.go in step with it.
const frequencyWordsCommit = "525f9b560de45753a5ea01069454e72e9aa541c6"

// contractions gives each common English contraction the count it's ranked
// by, as the lists have none of their own.
//
// Where the part before the apostrophe is only ever that contraction's, as
// "didn" is "didn't"'s, the contraction takes its count, and the part isn't
// ranked as a word of its own: "don" and "haven" are words, but the
// subtitles say them far less than "don't" and "haven't". So is "'m",
// only ever "i'm"'s.
//
// Where it isn't, as "can" is a word of its own and "'s" may be "it's",
// "that's" or "he's", the contraction takes the count of a word said about
// as often, chosen by hand: its share of the part after the apostrophe
// ("'re" for "you're", "we're" and "they're"), or of the word before it.
var contractions = map[string]contraction{
	// Only ever the contraction's.
	"don't":     {fragment: "don"},
	"didn't":    {fragment: "didn"},
	"doesn't":   {fragment: "doesn"},
	"isn't":     {fragment: "isn"},
	"wasn't":    {fragment: "wasn"},
	"wouldn't":  {fragment: "wouldn"},
	"haven't":   {fragment: "haven"},
	"couldn't":  {fragment: "couldn"},
	"aren't":    {fragment: "aren"},
	"ain't":     {fragment: "ain"},
	"shouldn't": {fragment: "shouldn"},
	"weren't":   {fragment: "weren"},
	"hasn't":    {fragment: "hasn"},
	"hadn't":    {fragment: "hadn"},
	"mustn't":   {fragment: "mustn"},
	"needn't":   {fragment: "needn"},
	"i'm":       {fragment: "'m"},

	// A word said about as often. "'t" (9.6M) is mostly the fragments'
	// above; "can" (3.8M) and "won" (0.57M) are words too.
	"can't": {like: "take"}, // 1.31M
	"won't": {like: "keep"}, // 0.50M
	// "'s" (14.3M) is also every possessive.
	"it's":    {like: "have"},      // 4.76M
	"that's":  {like: "get"},       // 2.88M
	"what's":  {like: "good"},      // 1.74M
	"he's":    {like: "time"},      // 1.45M
	"she's":   {like: "really"},    // 1.17M
	"there's": {like: "something"}, // 1.04M
	"let's":   {like: "never"},     // 0.93M
	"here's":  {like: "sure"},      // 0.71M
	"who's":   {like: "talk"},      // 0.57M
	"where's": {like: "money"},     // 0.47M
	// "'re" (4.06M).
	"you're":  {like: "yeah"},   // 2.00M
	"we're":   {like: "tell"},   // 1.18M
	"they're": {like: "please"}, // 0.84M
	// "'ll" (2.91M).
	"i'll":    {like: "going"}, // 1.52M
	"you'll":  {like: "find"},  // 0.63M
	"we'll":   {like: "stop"},  // 0.57M
	"he'll":   {like: "true"},  // 0.21M
	"it'll":   {like: "party"}, // 0.17M
	"they'll": {like: "front"}, // 0.14M
	// "'ve" (1.99M).
	"i've":    {like: "by"},    // 1.09M
	"you've":  {like: "feel"},  // 0.44M
	"we've":   {like: "ready"}, // 0.27M
	"they've": {like: "hurt"},  // 0.16M
	// "'d" (1.11M).
	"i'd":   {like: "call"},  // 0.57M
	"you'd": {like: "happy"}, // 0.26M
	"he'd":  {like: "save"},  // 0.13M
	"we'd":  {like: "sound"}, // 0.11M
}

// contraction is where a contraction's count comes from: a fragment it
// takes the count of, or a word whose count it shares.
type contraction struct {
	fragment, like string
}

func main() {
	english, err := dictionaryWords("en.txt.gz", func(line string) string {
		word, _, _ := strings.Cut(line, " ")
		return word
	})
	if err != nil {
		log.Fatal(err)
	}
	portuguese, err := dictionaryWords("pt.txt.gz", func(line string) string { return line })
	if err != nil {
		log.Fatal(err)
	}
	for _, l := range []struct {
		code  string
		words map[string]bool
		adapt func(counts map[string]int, words map[string]bool) error
	}{
		{"en", english, countContractions},
		{"pt", portuguese, foldOldSpellings},
	} {
		counts, err := fetchCounts(l.code)
		if err != nil {
			log.Fatal(err)
		}
		if err := l.adapt(counts, l.words); err != nil {
			log.Fatal(err)
		}
		if err := writeRanks(l.code+".ranks.txt.gz", ranked(counts, l.words)); err != nil {
			log.Fatal(err)
		}
	}
}

// dictionaryWords reads the words a Language's data has, wordOf finding
// each line's.
func dictionaryWords(path string, wordOf func(line string) string) (map[string]bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	words := map[string]bool{}
	sc := bufio.NewScanner(zr)
	for sc.Scan() {
		if word := wordOf(sc.Text()); word != "" {
			words[word] = true
		}
	}
	return words, sc.Err()
}

// fetchCounts reads a Language's list of its 50,000 most common words,
// each "word count".
func fetchCounts(code string) (map[string]int, error) {
	url := "https://raw.githubusercontent.com/hermitdave/FrequencyWords/" + frequencyWordsCommit + "/content/2018/" + code + "/" + code + "_50k.txt"
	res, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching %s: %s", url, res.Status)
	}
	return readCounts(res.Body)
}

func readCounts(list io.Reader) (map[string]int, error) {
	counts := map[string]int{}
	sc := bufio.NewScanner(list)
	for sc.Scan() {
		word, count, ok := strings.Cut(sc.Text(), " ")
		if !ok {
			continue
		}
		n, err := strconv.Atoi(count)
		if err != nil {
			return nil, fmt.Errorf("count of %q: %w", word, err)
		}
		counts[word] += n
	}
	return counts, sc.Err()
}

// countContractions gives each of contractions its count, and takes the
// fragments' from them.
func countContractions(counts map[string]int, words map[string]bool) error {
	for word, c := range contractions {
		if !words[word] {
			return fmt.Errorf("the dictionary has no %q", word)
		}
		from := cmp.Or(c.fragment, c.like)
		n, ok := counts[from]
		if !ok {
			return fmt.Errorf("the list has no %q, for %q", from, word)
		}
		counts[word] = n
	}
	for _, c := range contractions {
		delete(counts, c.fragment)
	}
	return nil
}

// silent is a consonant the 1990 spelling reform dropped from European
// Portuguese, as it isn't said: a c or p before c, ç or t, as in "acção",
// "adopção" and "óptimo".
var silent = regexp.MustCompile(`[cp]([cçt])`)

// foldOldSpellings gives an old spelling's count to its new one, when
// only the new one is a dictionary word: "acção"'s to "ação".
func foldOldSpellings(counts map[string]int, words map[string]bool) error {
	for word, n := range counts {
		if words[word] {
			continue
		}
		if reformed := silent.ReplaceAllString(word, "$1"); reformed != word && words[reformed] {
			counts[reformed] += n
			delete(counts, word)
		}
	}
	return nil
}

// ranked lists the counted words the dictionary has, most common first,
// alphabetically among equals.
func ranked(counts map[string]int, words map[string]bool) []string {
	var list []string
	for word := range counts {
		if words[word] {
			list = append(list, word)
		}
	}
	slices.SortFunc(list, func(a, b string) int {
		return cmp.Or(cmp.Compare(counts[b], counts[a]), strings.Compare(a, b))
	})
	return list
}

func writeRanks(path string, words []string) error {
	// Without a name or time in its header, the same text always gzips the
	// same, so regenerating changes nothing unless the list did.
	var out bytes.Buffer
	zw, err := gzip.NewWriterLevel(&out, gzip.BestCompression)
	if err != nil {
		return err
	}
	for _, w := range words {
		if _, err := fmt.Fprintln(zw, w); err != nil {
			return err
		}
	}
	if err := zw.Close(); err != nil {
		return err
	}
	return os.WriteFile(path, out.Bytes(), 0o644)
}
