package song

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Chord is a chord name anchored at a character in a Line's lyrics.
type Chord struct {
	// Offset counts characters (Unicode code points) into the lyrics. It may
	// equal the lyrics' length, for a Chord at the end of the Line.
	Offset int    `json:"offset"`
	Name   string `json:"name"`
	// Voicing is the Chord's Song Voicing, if it's written with one: each
	// string's fret, low string to high, counted from the capo, nil for a
	// muted string.
	Voicing []*int `json:"voicing,omitempty"`
}

// chordName is the chord grammar: a root A–G, an optional sharp or flat, an
// optional quality or extension (e.g. m, maj7, sus4, add9, m7b5, 6/9, 7(#9)), and
// an optional slash bass note.
var chordName = func() *regexp.Regexp {
	const (
		note  = `[A-G][#b♯♭]?`
		token = `(?:maj|min|ma|mi|dim|aug|sus|add|alt|m|M|\+|-|°|ø|Δ|6/9|[#b♯♭]?\d+)`
	)
	return regexp.MustCompile(`^` + note + `(?:` + token + `|\((?:` + token + `|,)+\))*(?:/` + note + `)?$`)
}()

// songVoicing is a Song Voicing's grammar: each string's fret, low string to
// high, x for a muted one, either one character a fret, every fret 9 or
// lower, or parted by dashes, any fret up to 99.
var songVoicing = func() *regexp.Regexp {
	const fret = `(?:x|0|[1-9][0-9]?)`
	return regexp.MustCompile(`^(?:[0-9x]+|` + fret + `(?:-` + fret + `)+)$`)
}()

// parseLine splits a Line's ChordPro text into its lyrics and its Chords.
// Bracketed text that isn't a chord name, with or without a Song Voicing
// that can be read, stays in the lyrics as written.
func parseLine(text string) (lyrics string, chords []Chord) {
	chords = []Chord{}
	var b strings.Builder
	chars := 0
	for text != "" {
		if chord, rest, ok := cutChord(text); ok {
			chord.Offset = chars
			chords = append(chords, chord)
			text = rest
			continue
		}
		_, size := utf8.DecodeRuneInString(text)
		b.WriteString(text[:size])
		chars++
		text = text[size:]
	}
	return b.String(), chords
}

// cutChord reads a bracketed Chord at the start of text: its name, and its
// Song Voicing after a colon, if it's written with one.
func cutChord(text string) (chord Chord, rest string, ok bool) {
	inner, ok := strings.CutPrefix(text, "[")
	if !ok {
		return Chord{}, "", false
	}
	inner, rest, ok = strings.Cut(inner, "]")
	if !ok {
		return Chord{}, "", false
	}
	name, frets, hasFrets := strings.Cut(inner, ":")
	if !chordName.MatchString(name) {
		return Chord{}, "", false
	}
	chord = Chord{Name: name}
	if hasFrets {
		if chord.Voicing, ok = readSongVoicing(frets); !ok {
			return Chord{}, "", false
		}
	}
	return chord, rest, true
}

// readSongVoicing reads a Song Voicing's frets, written as songVoicing has them.
func readSongVoicing(text string) ([]*int, bool) {
	if !songVoicing.MatchString(text) {
		return nil, false
	}
	written := strings.Split(text, "")
	if strings.Contains(text, "-") {
		written = strings.Split(text, "-")
	}
	frets := make([]*int, len(written))
	for i, w := range written {
		if w == "x" {
			continue
		}
		fret, err := strconv.Atoi(w)
		if err != nil {
			return nil, false
		}
		frets[i] = &fret
	}
	return frets, true
}

// isChordLine reports whether a Line holds Chords and nothing else.
func isChordLine(lyrics string, chords []Chord) bool {
	return len(chords) > 0 && strings.TrimFunc(lyrics, unicode.IsSpace) == ""
}
