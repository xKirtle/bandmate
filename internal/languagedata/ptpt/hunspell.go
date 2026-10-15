package main

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"maps"
	"regexp"
	"slices"
	"strings"
)

// dictionariesCommit is the commit of github.com/LibreOffice/dictionaries
// to take the word list from. Keep dictionariesVersion in languagedata.go in
// step with it.
const dictionariesCommit = "fe49c662796b47cb19732d18114610a58848f5cb"

// keptWord matches a word as it's kept: lower-case Portuguese letters only.
var keptWord = regexp.MustCompile(`^[a-záàâãéêíóôõúüç]+$`)

// vos is the morphology of a verb form said to vós, which is left out, as
// it's hardly said in Portugal any more.
var vos = regexp.MustCompile(`P=2,N=p`)

// notAWord is the morphology of a dictionary word that isn't said as it's
// written: an abbreviation, such as "kg" or "dr", or a Roman numeral, such
// as "xv". eSpeak NG spells them out, or says what they stand for.
var notAWord = regexp.MustCompile(`ABR=1|subcat=rom`)

// affix is one of the affix file's rules: a suffix takes strip off the end
// of a word that ends as condition says, and adds add there; a prefix does
// the same at the start.
type affix struct {
	strip, add string
	prefix     bool
	condition  *regexp.Regexp
}

// apply is the form the affix makes of a word, and whether it makes one.
func (a affix) apply(word string) (string, bool) {
	if a.condition != nil && !a.condition.MatchString(word) {
		return "", false
	}
	if a.prefix {
		rest, ok := strings.CutPrefix(word, a.strip)
		return a.add + rest, ok
	}
	rest, ok := strings.CutSuffix(word, a.strip)
	return rest + a.add, ok
}

// hunspellWords is the word list: the European Portuguese Hunspell
// dictionary's words, each with the forms its suffixes make (plurals,
// genders, every verb tense) and the forms its prefixes make of those
// ("desculpe" of "culpe"), but not the verb forms said to vós,
// abbreviations, or Roman numerals. Only words written in lower-case
// letters are kept, so no names. Sorted.
func hunspellWords() ([]string, error) {
	base := "https://raw.githubusercontent.com/LibreOffice/dictionaries/" + dictionariesCommit + "/pt_PT/pt_PT"
	aff, err := fetch(base + ".aff")
	if err != nil {
		return nil, err
	}
	dic, err := fetch(base + ".dic")
	if err != nil {
		return nil, err
	}
	affixes, err := readAffixes(bytes.NewReader(aff))
	if err != nil {
		return nil, err
	}
	return expand(bytes.NewReader(dic), affixes)
}

// readAffixes reads the affix file's rules by their flag, leaving out the
// suffixes that make vós forms. A rule is "SFX flag strip add condition
// morphology", or PFX for a prefix's, "0" meaning nothing. Every rule of
// this affix file can be combined with others, a prefix with a suffix.
func readAffixes(aff io.Reader) (map[rune][]affix, error) {
	affixes := map[rune][]affix{}
	sc := bufio.NewScanner(aff)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 5 || (fields[0] != "SFX" && fields[0] != "PFX") {
			continue
		}
		if len(fields) > 5 && vos.MatchString(fields[5]) {
			continue
		}
		a := affix{
			strip:  zeroIsNothing(fields[2]),
			add:    zeroIsNothing(strings.SplitN(fields[3], "/", 2)[0]),
			prefix: fields[0] == "PFX",
		}
		if fields[4] != "." {
			pattern := "(?:" + fields[4] + ")$"
			if a.prefix {
				pattern = "^(?:" + fields[4] + ")"
			}
			var err error
			if a.condition, err = regexp.Compile(pattern); err != nil {
				return nil, fmt.Errorf("%s %s: %w", fields[0], fields[1], err)
			}
		}
		flag := []rune(fields[1])[0]
		affixes[flag] = append(affixes[flag], a)
	}
	return affixes, sc.Err()
}

func zeroIsNothing(s string) string {
	if s == "0" {
		return ""
	}
	return s
}

// expand lists the dictionary's words, each "word/flags" and a tab before
// its morphology, with the forms their suffixes make, and the forms their
// prefixes make of those, sorted.
func expand(dic io.Reader, affixes map[rune][]affix) ([]string, error) {
	seen := map[string]bool{}
	sc := bufio.NewScanner(dic)
	sc.Scan() // The first line is how many words there are.
	for sc.Scan() {
		entry, morphology, _ := strings.Cut(sc.Text(), "\t")
		stem, flags, _ := strings.Cut(entry, "/")
		if !keptWord.MatchString(stem) || vos.MatchString(morphology) || notAWord.MatchString(morphology) {
			continue
		}
		suffixed := []string{stem}
		for _, flag := range flags {
			for _, a := range affixes[flag] {
				if form, ok := a.apply(stem); ok && !a.prefix {
					suffixed = append(suffixed, form)
				}
			}
		}
		// One prefix at most, on the word or any of its suffixed forms.
		forms := slices.Clone(suffixed)
		for _, flag := range flags {
			for _, a := range affixes[flag] {
				if !a.prefix {
					continue
				}
				for _, form := range suffixed {
					if prefixed, ok := a.apply(form); ok {
						forms = append(forms, prefixed)
					}
				}
			}
		}
		for _, form := range forms {
			if keptWord.MatchString(form) {
				seen[form] = true
			}
		}
	}
	return slices.Sorted(maps.Keys(seen)), sc.Err()
}
