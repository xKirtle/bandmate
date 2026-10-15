package main

import (
	"bufio"
	"bytes"
	"slices"
	"strings"
	"unicode/utf8"
)

// wikipronCommit is the commit of github.com/CUNY-CL/wikipron whose
// European Portuguese data, scraped from Wiktionary, corrects eSpeak NG's
// stressed vowels. Keep wikipronVersion in languagedata.go in step with it.
const wikipronCommit = "d282e848a211ea31cfd730f0ced8bc8cdab9e83d"

// wiktionaryReadings is each word's readings in Wiktionary, as WikiPron's
// broad European Portuguese data has them: phonemes in IPA, without stress.
func wiktionaryReadings() (map[string][][]string, error) {
	tsv, err := fetch("https://raw.githubusercontent.com/CUNY-CL/wikipron/" + wikipronCommit + "/data/scrape/tsv/por_latn_po_broad.tsv")
	if err != nil {
		return nil, err
	}
	readings := map[string][][]string{}
	sc := bufio.NewScanner(bytes.NewReader(tsv))
	for sc.Scan() {
		word, ipa, ok := strings.Cut(sc.Text(), "\t")
		if ok {
			readings[word] = append(readings[word], strings.Fields(ipa))
		}
	}
	return readings, sc.Err()
}

// readingsOf are the vowels Wiktionary may say a stressed vowel as, by
// the phone each is: an e or o open or closed, and an e eSpeak NG says as
// ɨ. That's right for "de" and "me", but not for "ser" and "ter".
var readingsOf = map[string]map[string]string{
	"E": {"e": "E", "ɛ": "EH"}, "EH": {"e": "E", "ɛ": "EH"},
	"O": {"o": "O", "ɔ": "OH"}, "OH": {"o": "O", "ɔ": "OH"},
	"EY": {"e": "EY", "ɛ": "EHY"}, "EHY": {"e": "EY", "ɛ": "EHY"},
	"EW": {"e": "EW", "ɛ": "EHW"}, "EHW": {"e": "EW", "ɛ": "EHW"},
	"OY": {"o": "OY", "ɔ": "OHY"}, "OHY": {"o": "OY", "ɔ": "OHY"},
	"IX": {"ɨ": "IX", "e": "E", "ɛ": "EH"},
}

// accentOf is the accent written on an e or o, by whether it's open.
var accentOf = map[string]map[bool]rune{"E": {true: 'é', false: 'ê'}, "O": {true: 'ó', false: 'ô'}}

// isOpen reports whether a phone's e or o is open.
func isOpen(phone string) bool {
	return strings.HasPrefix(phone, "EH") || strings.HasPrefix(phone, "OH")
}

// withWiktionaryVowel corrects the stressed vowel of a word's phones, which
// eSpeak NG sometimes gets wrong, by Wiktionary's readings of it, as people
// wrote them: whether an e or o is open or closed, and an e eSpeak NG says
// as ɨ. Only a reading with as many syllables says which vowel is stressed.
// Where none of them says the stressed vowel is as eSpeak NG has it, the
// first one's is taken, unless the word's accent says eSpeak NG has it
// right, as é in "anéis" does.
func withWiktionaryVowel(word string, phones []string, readings [][]string) []string {
	stressed, nth := -1, 0
	for i, p := range phones {
		if !isVowelPhone(p) {
			continue
		}
		if strings.HasSuffix(p, "1") {
			stressed = i
			break
		}
		nth++
	}
	if stressed < 0 {
		return phones
	}
	phone := strings.TrimSuffix(phones[stressed], "1")
	options, ok := readingsOf[phone]
	if !ok || strings.ContainsRune(word, accentOf[phone[:1]][isOpen(phone)]) {
		return phones
	}
	var said []string
	for _, r := range readings {
		nuclei := wiktionaryNuclei(r)
		if len(nuclei) != syllables(phones) {
			continue
		}
		if p, ok := options[nuclei[nth]]; ok {
			said = append(said, p)
		}
	}
	if len(said) == 0 || slices.Contains(said, phone) {
		return phones
	}
	corrected := append([]string(nil), phones...)
	corrected[stressed] = said[0] + "1"
	return corrected
}

// wiktionaryNuclei are a Wiktionary reading's vowels, one a syllable, its
// glides left out.
func wiktionaryNuclei(reading []string) []string {
	var nuclei []string
	for _, p := range reading {
		if first, _ := utf8.DecodeRuneInString(p); strings.ContainsRune("aɐeɛioɔuɨøyɜə", first) && !strings.ContainsRune(p, '\u032f') {
			nuclei = append(nuclei, p)
		}
	}
	return nuclei
}

func isVowelPhone(p string) bool {
	return strings.HasSuffix(p, "0") || strings.HasSuffix(p, "1") || strings.HasSuffix(p, "2")
}

func syllables(phones []string) int {
	n := 0
	for _, p := range phones {
		if isVowelPhone(p) {
			n++
		}
	}
	return n
}
