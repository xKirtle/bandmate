package main

import (
	"fmt"
	"regexp"
	"strings"
)

// The phone set Portuguese (Portugal)'s pronunciations are written in, as
// the CMU Pronouncing Dictionary writes English's: a name for each sound,
// a vowel's followed by its stress, 1 for the stressed one, 2 for one
// stressed less before it, and 0 for the rest. It keeps apart what a
// rhyme hears: open vowels from closed ones (EH from E, OH from O, A from
// AX), and nasal vowels from oral ones (AN from AX, ON from O). A
// diphthong is one vowel, one syllable, as English's AY is.
//
//	Vowels      A (pá)  AX (cama's last)  E (vê)  EH (pé)  I (vi)  IX (sede's last)
//	            O (avô)  OH (avó)  U (tu)
//	Nasal       AN (lã)  EN (tempo)  IN (fim)  ON (bom)  UN (um)
//	Diphthongs  AY (pai)  AW (mau)  EY (lei)  EHY (papéis)  EW (eu)  EHW (céu)
//	            IW (partiu)  OY (depois)  OHY (herói)  UY (fui)
//	            ANW (pão)  ANY (mãe, bem)  ONY (põe)  UNY (muito)
//	Consonants  P B T D K G F V S Z SH (chá) ZH (já) M N NY (vinho) L
//	            LH (olho) R (caro) RR (carro) J (rio's glide) W (água's glide)

// vowelPhones are eSpeak NG's vowels, and diphthongs, as phones.
var vowelPhones = map[string]string{
	"a": "A", "ɑ": "A", "ɐɐ": "A",
	"ɐ": "AX",
	"e": "E",
	"ɛ": "EH",
	"i": "I",
	"ɨ": "IX",
	"o": "O",
	"ɔ": "OH",
	"u": "U", "ʊ": "U",
	"ɐ̃": "AN",
	// eSpeak NG writes a tilde apart from the letter it's on.
	"ẽ":   "EN",
	"ĩ":   "IN",
	"õ":   "ON",
	"ũ":   "UN",
	"aɪ":   "AY",
	"aʊ":   "AW",
	"eɪ":   "EY",
	"ɛɪ":   "EHY",
	"eʊ":   "EW",
	"ɛʊ":   "EHW",
	"iʊ":   "IW",
	"oɪ":   "OY",
	"ɔɪ":   "OHY",
	"uɪ":   "UY",
	"ɐ̃ʊ̃": "ANW",
}

// consonantPhones are eSpeak NG's consonants as phones. Its r symbols for
// the tap are one, R; the other r, as in "carro", is RR. It says some
// loanwords' consonants as two, as tʃ in "ticket".
var consonantPhones = map[string]string{
	"p": "P", "b": "B", "t": "T", "d": "D", "k": "K", "ɡ": "G",
	"f": "F", "v": "V", "s": "S", "z": "Z", "ʃ": "SH", "ʒ": "ZH",
	"m": "M", "n": "N", "ɲ": "NY", "l": "L", "ʎ": "LH",
	"ɾ": "R", "ɹ": "R", "r": "R", "ʁ": "RR",
	"j": "J", "w": "W",
	"tʃ": "T SH", "ts": "T S", "dʒ": "D ZH",
}

// nasalOf is a vowel made nasal by eSpeak NG's ŋ after it.
var nasalOf = map[string]string{
	"A": "AN", "AX": "AN", "AN": "AN",
	"E": "EN", "EN": "EN",
	"I": "IN", "IN": "IN",
	"O": "ON", "ON": "ON",
	"U": "UN", "UN": "UN",
}

// nasalDiphthongOf is a nasal vowel with the i glide after it: ãe, õe, ui.
var nasalDiphthongOf = map[string]string{"AN": "ANY", "ON": "ONY", "UN": "UNY"}

// segment is a sound of a pronunciation as it's worked out: its phone,
// whether it's a vowel, and its stress mark, ˈ, ˌ or none.
type segment struct {
	phone  string
	vowel  bool
	stress rune
}

// phonesOf is a word's pronunciation in the phone set, from eSpeak NG's
// IPA for it. Not ok for a word eSpeak NG read as another language's, as
// it does a loanword such as "copyright", with a sound Portuguese doesn't
// have, or with more syllables than the word has vowels, as it reads a
// word of one letter, such as "é", by the letter's name.
func phonesOf(word, ipa string) (phones []string, ok bool, err error) {
	if strings.Contains(ipa, "(") {
		return nil, false, nil
	}
	var segs []segment
	for _, token := range strings.Split(ipa, "_") {
		token = strings.ReplaceAll(token, "ː", "") // A long sound, in a loanword, is as the short one.
		var stress rune
		if rest, found := strings.CutPrefix(token, "ˈ"); found {
			stress, token = 'ˈ', rest
		} else if rest, found := strings.CutPrefix(token, "ˌ"); found {
			stress, token = 'ˌ', rest
		}
		switch {
		case token == "" || token == "ə":
			// A part between two vowels said apart, or the breath eSpeak
			// NG puts after an r before a consonant, which is no syllable.
		case token == "ŋ":
			// eSpeak NG writes a nasal vowel before a consonant, or at the
			// end, as the vowel and ŋ.
			if len(segs) == 0 || !nasalize(&segs[len(segs)-1]) {
				return nil, false, fmt.Errorf("%s (%s): ŋ after no vowel that can be nasal", word, ipa)
			}
		case token == "ɪ" && len(segs) > 0 && segs[len(segs)-1].vowel:
			segs = append(segs, segment{phone: "J"})
		case vowelPhones[token] != "":
			segs = append(segs, segment{phone: vowelPhones[token], vowel: true, stress: stress})
		case token == "ɪ":
			segs = append(segs, segment{phone: "I", vowel: true, stress: stress})
		case consonantPhones[token] != "":
			for _, phone := range strings.Fields(consonantPhones[token]) {
				segs = append(segs, segment{phone: phone})
			}
		default:
			return nil, false, nil
		}
	}
	segs = nasalizeBeforeConsonant(segs)
	segs = joinNasalDiphthongs(segs)
	segs = readVowelBeforeW(word, segs)
	phones = withStress(segs)
	if syllables(phones) > vowelLetters(word) {
		// eSpeak NG spelt it out, as it says a word of one letter by its
		// name, such as "é" as "é agudo".
		return nil, false, nil
	}
	return openStressedIX(phones), true, nil
}

// vowelLetters is how many vowels a word is written with, more than it can
// have syllables.
func vowelLetters(word string) int {
	n := 0
	for _, r := range word {
		if strings.ContainsRune("aeiouyáàâãéêíóôõúü", r) {
			n++
		}
	}
	return n
}

// openStressedIX reads a stressed IX in a word of more than one syllable as
// EH. Portuguese stresses ɨ only in a word of one syllable said unstressed
// in a sentence, as "de" and "me", but eSpeak NG writes it for the
// stressed e of some longer words, as in "depressa" and "interessa", which
// are said with an open e. Wiktionary then corrects any said closed.
func openStressedIX(phones []string) []string {
	if syllables(phones) < 2 {
		return phones
	}
	for i, p := range phones {
		if p == "IX1" {
			phones[i] = "EH1"
		}
	}
	return phones
}

// nasalize makes a vowel nasal, reporting whether it can be. eSpeak NG
// writes ẽ as eɪ: before a consonant it's EN, as in "tempo"; at the end, or
// before only an s, it's said as ãe is, as in "bem" and "homens", which
// joinNasalDiphthongs sees to.
func nasalize(s *segment) bool {
	if s.phone == "EY" {
		s.phone = "EN"
		return true
	}
	nasal, ok := nasalOf[s.phone]
	if ok && s.vowel {
		s.phone = nasal
	}
	return ok && s.vowel
}

// nasalizeBeforeConsonant reads a vowel eSpeak NG writes with an m or n after it,
// before a consonant, or with an m at the end, as nasal, as Portuguese
// spells and says it: "tempo", "com", "quem".
func nasalizeBeforeConsonant(segs []segment) []segment {
	var out []segment
	for i, s := range segs {
		if (s.phone == "M" || s.phone == "N") && len(out) > 0 && closesSyllable(s.phone, segs[i+1:]) &&
			nasalize(&out[len(out)-1]) {
			continue
		}
		out = append(out, s)
	}
	return out
}

// closesSyllable reports whether an m or n, before the rest of a word, ends
// its syllable: before a consonant, or for an m, at the end.
func closesSyllable(phone string, rest []segment) bool {
	if len(rest) == 0 {
		return phone == "M"
	}
	next := rest[0].phone
	return !rest[0].vowel && next != "M" && next != "N" && next != "J" && next != "W"
}

// joinNasalDiphthongs makes a nasal vowel and an i glide after it, which
// eSpeak NG writes as j, ɪ or ɨ, one diphthong, as in "mãe", "mães" and
// "corações"; and an EN that ends the word, but for an s, ANY, as "bem"
// and "homens" are said.
func joinNasalDiphthongs(segs []segment) []segment {
	var out []segment
	for i := 0; i < len(segs); i++ {
		s := segs[i]
		diphthong, nasal := nasalDiphthongOf[s.phone]
		if nasal && i+1 < len(segs) && isIGlide(segs[i+1]) && !(i+2 < len(segs) && segs[i+2].vowel) {
			s.phone = diphthong
			i++
		} else if s.phone == "EN" && endsButForS(segs[i+1:]) {
			s.phone = "ANY"
		}
		out = append(out, s)
	}
	return out
}

func isIGlide(s segment) bool {
	return s.phone == "J" || (s.phone == "IX" && s.stress == 0) || (s.phone == "I" && s.stress == 0)
}

// endsButForS reports whether the rest of a word is nothing, or an s.
func endsButForS(rest []segment) bool {
	return len(rest) == 0 || (len(rest) == 1 && (rest[0].phone == "SH" || rest[0].phone == "S" || rest[0].phone == "Z" || rest[0].phone == "ZH"))
}

// spelledBeforeW finds where a word is spelled ou, or ul or ol before no
// vowel (an lh is a sound of its own).
var spelledBeforeW = regexp.MustCompile(`ou|[uo]l(?:[^aeiouáàâãéêíóôõúh]|$)`)

// readVowelBeforeW reads eSpeak NG's o or u with a w after it, before no
// vowel. It writes so the ou of "cantou" and "sou", said o in Portugal, and
// the ul of "azul" and ol of "solta". Each is read from the spelling it's
// said from, in turn: an ou is O, an ul U and L, an ol O and L. When they
// can't be matched, every one is O.
func readVowelBeforeW(word string, segs []segment) []segment {
	var at []int
	for i := 0; i+1 < len(segs); i++ {
		if (segs[i].phone == "O" || segs[i].phone == "U") && segs[i+1].phone == "W" && !(i+2 < len(segs) && segs[i+2].vowel) {
			at = append(at, i)
		}
	}
	if len(at) == 0 {
		return segs
	}
	spelled := spelledBeforeW.FindAllString(word, -1)
	out := append([]segment(nil), segs[:at[0]]...)
	for n, i := range at {
		vowel := segs[i]
		vowel.phone = "O"
		if len(spelled) == len(at) && strings.HasSuffix(spelled[n][:2], "l") {
			vowel.phone = strings.ToUpper(spelled[n][:1])
			out = append(out, vowel, segment{phone: "L"})
		} else {
			out = append(out, vowel)
		}
		end := len(segs)
		if n+1 < len(at) {
			end = at[n+1]
		}
		out = append(out, segs[i+2:end]...)
	}
	return out
}

// withStress writes the phones, each vowel with its stress: 1 for the last
// that eSpeak NG stresses most, 2 for one it stresses less before that, 0
// for the rest, as one it stresses less after it, such as -ável's e, isn't
// what the word rhymes on.
func withStress(segs []segment) []string {
	primary := -1
	for i, s := range segs {
		if s.vowel && s.stress == 'ˈ' {
			primary = i
		}
	}
	phones := make([]string, len(segs))
	for i, s := range segs {
		switch {
		case !s.vowel:
			phones[i] = s.phone
		case i == primary:
			phones[i] = s.phone + "1"
		case s.stress != 0 && i < primary:
			phones[i] = s.phone + "2"
		default:
			phones[i] = s.phone + "0"
		}
	}
	return phones
}
