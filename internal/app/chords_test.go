package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

// parsedLine writes text as a Song's only Line and returns it as the API
// returns it, checking it reads back the same.
func (ts *testServer) parsedLine(text string) line {
	ts.t.Helper()
	s, alt := ts.verseWithLines(text)
	if len(alt.Lines) != 1 {
		ts.t.Fatalf("lines = %+v, want one", alt.Lines)
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
		ts.t.Errorf("song read back = %+v, want %+v", read, s)
	}
	return alt.Lines[0]
}

func TestChordsAreParsedOutOfTheLineText(t *testing.T) {
	cases := map[string]struct {
		text   string
		lyrics string
		chords []chord
	}{
		"no chords":         {"City lights are calling", "City lights are calling", []chord{}},
		"start of line":     {"[G]City lights", "City lights", []chord{{Offset: 0, Name: "G"}}},
		"mid-word":          {"Hel[Am]lo", "Hello", []chord{{Offset: 3, Name: "Am"}}},
		"end of line":       {"are calling [F]", "are calling ", []chord{{Offset: 12, Name: "F"}}},
		"end right after":   {"calling[F]", "calling", []chord{{Offset: 7, Name: "F"}}},
		"several":           {"[C]City [G]lights are [Am]call[F]ing", "City lights are calling", []chord{{Offset: 0, Name: "C"}, {Offset: 5, Name: "G"}, {Offset: 16, Name: "Am"}, {Offset: 20, Name: "F"}}},
		"two at one place":  {"[Am][G]home", "home", []chord{{Offset: 0, Name: "Am"}, {Offset: 0, Name: "G"}}},
		"offsets in chars":  {"Can[D]ção do [E]mar", "Canção do mar", []chord{{Offset: 3, Name: "D"}, {Offset: 10, Name: "E"}}},
		"chord text kept":   {"  [Em]  wide  ", "    wide  ", []chord{{Offset: 2, Name: "Em"}}},
		"brackets in words": {"[Chorus] x2", "[Chorus] x2", []chord{}},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			got := ts.parsedLine(c.text)

			if got.Text != c.text {
				t.Errorf("text = %q, want the raw text %q", got.Text, c.text)
			}
			if got.Lyrics != c.lyrics {
				t.Errorf("lyrics = %q, want %q", got.Lyrics, c.lyrics)
			}
			if !reflect.DeepEqual(got.Chords, c.chords) {
				t.Errorf("chords = %+v, want %+v", got.Chords, c.chords)
			}
			if got.ChordLine {
				t.Errorf("chordLine = true, want false for a Line with lyrics")
			}
		})
	}
}

func TestChordNamesFollowTheChordGrammar(t *testing.T) {
	chords := []string{
		"A", "B", "C", "D", "E", "F", "G",
		"C#", "Bb", "F♯", "E♭",
		"Am", "Cmaj7", "Dm7", "G7", "Esus4", "Asus2", "Cadd9", "Bdim", "Caug", "C+",
		"Bm7b5", "G13", "C6", "Dmin", "Fm(maj7)", "E7(#9)", "C7alt", "A5", "Bø", "C°7",
		"C6/9", "Cmi7", "Cma7", "A6/9/E",
		"D/F#", "G/B", "Am7/G", "C#m/G#", "Bb/Ab",
	}
	for _, name := range chords {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			got := ts.parsedLine("la [" + name + "]la")

			if want := []chord{{Offset: 3, Name: name}}; !reflect.DeepEqual(got.Chords, want) || got.Lyrics != "la la" {
				t.Errorf("lyrics = %q, chords = %+v; want %q, %+v", got.Lyrics, got.Chords, "la la", want)
			}
		})
	}
}

func TestBracketedTextThatIsNotAChordStaysInTheLyrics(t *testing.T) {
	texts := []string{
		"[Chorus]", "[x2]", "[H]", "[am]", "[Bridge]", "[Add]", "[C/H]", "[C/]", "[]", "[ Am ]",
		"[Am", "Am]", "[[Am", "[spoken] ok",
	}
	for _, text := range texts {
		t.Run(text, func(t *testing.T) {
			ts := newTestServer(t)

			got := ts.parsedLine("la " + text + " la")

			if want := "la " + text + " la"; got.Lyrics != want || len(got.Chords) != 0 {
				t.Errorf("lyrics = %q, chords = %+v; want %q and no chords", got.Lyrics, got.Chords, want)
			}
		})
	}
}

// frets is a Song Voicing as the API returns it, from each string's fret, muted for a muted one.
func frets(of ...int) []*int {
	voicing := make([]*int, len(of))
	for i, f := range of {
		if f != muted {
			voicing[i] = &f
		}
	}
	return voicing
}

// muted is a muted string, for frets.
const muted = -1

func TestAChordCanCarryASongVoicing(t *testing.T) {
	cases := map[string]chord{
		"Em:00002x":         {Offset: 3, Name: "Em", SongVoicing: frets(0, 0, 0, 0, 2, muted)},
		"Em:0-0-0-0-2-x":    {Offset: 3, Name: "Em", SongVoicing: frets(0, 0, 0, 0, 2, muted)},
		"A:x-12-14-14-13-x": {Offset: 3, Name: "A", SongVoicing: frets(muted, 12, 14, 14, 13, muted)},
		"Em:x-0-9-9-x-x":    {Offset: 3, Name: "Em", SongVoicing: frets(muted, 0, 9, 9, muted, muted)},
		"D/F#:2x0232":       {Offset: 3, Name: "D/F#", SongVoicing: frets(2, muted, 0, 2, 3, 2)},
		"C:x3201":           {Offset: 3, Name: "C", SongVoicing: frets(muted, 3, 2, 0, 1)},
	}
	for text, want := range cases {
		t.Run(text, func(t *testing.T) {
			ts := newTestServer(t)

			got := ts.parsedLine("la [" + text + "]la")

			if !reflect.DeepEqual(got.Chords, []chord{want}) || got.Lyrics != "la la" {
				t.Errorf("lyrics = %q, chords = %s; want %q, %s", got.Lyrics, showChords(got.Chords), "la la", showChords([]chord{want}))
			}
		})
	}
}

func TestBracketedTextWhoseNameOrFretsCantBeReadStaysInTheLyrics(t *testing.T) {
	texts := []string{
		"[Em:00z]", "[foo:000000]", "[Em:]", "[:000000]", "[Em:0-0-0-0-2-]", "[Em:-0-0]", "[Em:0--0]",
		"[Em:00-002x]", "[Em:X00000]", "[Em: 000000]", "[Em:00 0000]", "[Em:000000:]", "[Em:x-012-0]",
		"[Em:x-123-0]",
	}
	for _, text := range texts {
		t.Run(text, func(t *testing.T) {
			ts := newTestServer(t)

			got := ts.parsedLine("la " + text + " la")

			if want := "la " + text + " la"; got.Lyrics != want || len(got.Chords) != 0 {
				t.Errorf("lyrics = %q, chords = %s; want %q and no chords", got.Lyrics, showChords(got.Chords), want)
			}
		})
	}
}

// showChords writes Chords out with their Song Voicings' frets, not their pointers.
func showChords(chords []chord) string {
	var b strings.Builder
	for _, c := range chords {
		fmt.Fprintf(&b, "{%d %s", c.Offset, c.Name)
		for _, f := range c.SongVoicing {
			if f == nil {
				b.WriteString(" x")
			} else {
				fmt.Fprintf(&b, " %d", *f)
			}
		}
		b.WriteString("}")
	}
	return "[" + b.String() + "]"
}

func TestAChordNextToLiteralBracketsIsStillParsed(t *testing.T) {
	ts := newTestServer(t)

	got := ts.parsedLine("[[Am]la] [x2]")

	if want := []chord{{Offset: 1, Name: "Am"}}; got.Lyrics != "[la] [x2]" || !reflect.DeepEqual(got.Chords, want) {
		t.Errorf("lyrics = %q, chords = %+v; want %q, %+v", got.Lyrics, got.Chords, "[la] [x2]", want)
	}
}

func TestALineWithOnlyChordsIsAChordLine(t *testing.T) {
	cases := map[string]bool{
		"[Am] [F] [C] [G]":   true,
		"[E]":                true,
		"  [Am]   [G]  ":     true,
		"[Am] [F] oh":        false,
		"City lights":        false,
		"":                   false,
		"   ":                false,
		"[Am] [x2]":          false,
		"[Am] [F] [C] [G] ;": false,
	}
	for text, want := range cases {
		t.Run(text, func(t *testing.T) {
			ts := newTestServer(t)
			s, alt := ts.verseWithLines("Verse starts\n" + text + "\nand ends")
			if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
				t.Errorf("song read back = %+v, want %+v", read, s)
			}

			if got := alt.Lines[1].ChordLine; got != want {
				t.Errorf("chordLine = %v, want %v (line %+v)", got, want, alt.Lines[1])
			}
		})
	}
}

func TestASongHasNoShowChordsSetting(t *testing.T) {
	// Whether Read mode shows the Chords is kept on each device, not on the Song.
	ts := newTestServer(t)
	created := ts.createSong("Midnight Drive")

	res := ts.Do(http.MethodGet, songPath(created.ID), nil)

	expectStatus(t, res, http.StatusOK)
	var fields map[string]any
	res.JSON(t, &fields)
	if _, ok := fields["showChords"]; ok {
		t.Errorf("song = %s, want no showChords", res.Body)
	}
}
