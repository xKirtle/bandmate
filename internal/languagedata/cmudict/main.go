// Command cmudict builds English's data, en.txt.gz, from the CMU
// Pronouncing Dictionary at a pinned commit: each pronunciation on a line of
// its own, as "word PHONES", without the dictionary's comments or the
// numbers it gives a word's second and later pronunciations. go generate
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
	"strings"
)

// cmudictCommit is the commit of github.com/cmusphinx/cmudict to build
// from. Keep cmudictVersion in languagedata.go in step with it.
const cmudictCommit = "74790861f652b15e4ac49015a90074ad62a27690"

// variant is the "(2)" that numbers a word's second pronunciation.
var variant = regexp.MustCompile(`\(\d+\)$`)

func main() {
	url := "https://raw.githubusercontent.com/cmusphinx/cmudict/" + cmudictCommit + "/cmudict.dict"
	res, err := http.Get(url)
	if err != nil {
		log.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		log.Fatalf("fetching %s: %s", url, res.Status)
	}
	var text bytes.Buffer
	if err := compact(res.Body, &text); err != nil {
		log.Fatal(err)
	}
	// Without a name or time in its header, the same text always gzips the
	// same, so regenerating changes nothing unless the dictionary did.
	var out bytes.Buffer
	zw, err := gzip.NewWriterLevel(&out, gzip.BestCompression)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := zw.Write(text.Bytes()); err != nil {
		log.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile("en.txt.gz", out.Bytes(), 0o644); err != nil {
		log.Fatal(err)
	}
}

// compact writes each of the dictionary's entries as "word PHONES".
func compact(dict io.Reader, w io.Writer) error {
	sc := bufio.NewScanner(dict)
	for sc.Scan() {
		line, _, _ := strings.Cut(sc.Text(), "#")
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		word := variant.ReplaceAllString(fields[0], "")
		if _, err := fmt.Fprintln(w, word, strings.Join(fields[1:], " ")); err != nil {
			return err
		}
	}
	return sc.Err()
}
