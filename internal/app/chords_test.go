package app_test

import (
	"net/http"
	"reflect"
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
		"start of line":     {"[G]City lights", "City lights", []chord{{0, "G"}}},
		"mid-word":          {"Hel[Am]lo", "Hello", []chord{{3, "Am"}}},
		"end of line":       {"are calling [F]", "are calling ", []chord{{12, "F"}}},
		"end right after":   {"calling[F]", "calling", []chord{{7, "F"}}},
		"several":           {"[C]City [G]lights are [Am]call[F]ing", "City lights are calling", []chord{{0, "C"}, {5, "G"}, {16, "Am"}, {20, "F"}}},
		"two at one place":  {"[Am][G]home", "home", []chord{{0, "Am"}, {0, "G"}}},
		"offsets in chars":  {"Can[D]ção do [E]mar", "Canção do mar", []chord{{3, "D"}, {10, "E"}}},
		"chord text kept":   {"  [Em]  wide  ", "    wide  ", []chord{{2, "Em"}}},
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

			if want := []chord{{3, name}}; !reflect.DeepEqual(got.Chords, want) || got.Lyrics != "la la" {
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

func TestAChordNextToLiteralBracketsIsStillParsed(t *testing.T) {
	ts := newTestServer(t)

	got := ts.parsedLine("[[Am]la] [x2]")

	if want := []chord{{1, "Am"}}; got.Lyrics != "[la] [x2]" || !reflect.DeepEqual(got.Chords, want) {
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
