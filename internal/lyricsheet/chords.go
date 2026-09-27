package lyricsheet

import (
	"regexp"
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

// parseLine splits a Line's ChordPro text into its lyrics and its Chords.
// Bracketed text that isn't a chord name stays in the lyrics as written.
func parseLine(text string) (lyrics string, chords []Chord) {
	chords = []Chord{}
	var b strings.Builder
	chars := 0
	for text != "" {
		if name, rest, ok := cutChord(text); ok {
			chords = append(chords, Chord{Offset: chars, Name: name})
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

// cutChord reads a bracketed chord name at the start of text.
func cutChord(text string) (name, rest string, ok bool) {
	inner, ok := strings.CutPrefix(text, "[")
	if !ok {
		return "", "", false
	}
	name, rest, ok = strings.Cut(inner, "]")
	if !ok || !chordName.MatchString(name) {
		return "", "", false
	}
	return name, rest, true
}

// isChordLine reports whether a Line holds Chords and nothing else.
func isChordLine(lyrics string, chords []Chord) bool {
	return len(chords) > 0 && strings.TrimFunc(lyrics, unicode.IsSpace) == ""
}
