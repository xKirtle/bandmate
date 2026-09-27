package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// importSong pastes text into a new Song, with an optional title, without
// checking the response.
func (ts *testServer) importSong(title, text string) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, "/api/songs/import", map[string]any{"title": title, "text": text})
}

// importedSection is an Occurrence of an imported Song as the user reads it:
// its Section's Label and the texts of its active Lines.
type importedSection struct {
	Label string
	Lines []string
}

// readSheet lists a Song's Arrangement as imported Sections, in order.
func readSheet(s song) []importedSection {
	sections := map[int64]section{}
	for _, sec := range s.Sections {
		sections[sec.ID] = sec
	}
	out := []importedSection{}
	for _, o := range s.Arrangement {
		sec := sections[o.SectionID]
		lines := []string{}
		for _, alt := range sec.Alternates {
			if alt.Active {
				lines = lineTexts(alt)
			}
		}
		out = append(out, importedSection{Label: sec.Label, Lines: lines})
	}
	return out
}

func TestImportSplitsPastedTextIntoSections(t *testing.T) {
	cases := map[string]struct {
		text string
		want []importedSection
	}{
		"one section": {
			"City lights\nare calling",
			[]importedSection{{"", []string{"City lights", "are calling"}}},
		},
		"a blank line ends a section": {
			"City lights\nare calling\n\nMe home\ntonight",
			[]importedSection{{"", []string{"City lights", "are calling"}}, {"", []string{"Me home", "tonight"}}},
		},
		"several blank lines are one break": {
			"\n\nCity lights\n\n\n  \n\t\nMe home\n\n\n",
			[]importedSection{{"", []string{"City lights"}}, {"", []string{"Me home"}}},
		},
		"windows line endings": {
			"City lights\r\nare calling\r\n\r\nMe home",
			[]importedSection{{"", []string{"City lights", "are calling"}}, {"", []string{"Me home"}}},
		},
		"lines kept as written": {
			"  City lights  \nare calling",
			[]importedSection{{"", []string{"  City lights  ", "are calling"}}},
		},
		"colon heading": {
			"Verse 1:\nCity lights\n\nChorus:\nMe home",
			[]importedSection{{"Verse 1", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
		},
		"bracketed heading": {
			"[Verse 1]\nCity lights\n\n  [Chorus x2]  \nMe home",
			[]importedSection{{"Verse 1", []string{"City lights"}}, {"Chorus x2", []string{"Me home"}}},
		},
		"heading without a blank line before it": {
			"[Verse]\nCity lights\nChorus:\nMe home",
			[]importedSection{{"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
		},
		// Repeating an earlier Section this way comes with merging, in #11.
		"heading with no lines is an empty section": {
			"Intro:\n[Verse]\nCity lights\n\n[Chorus]\n\nMe home",
			[]importedSection{{"Intro", []string{}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{}}, {"", []string{"Me home"}}},
		},
		"text after the colon is a line": {
			"She said: come home\nand I did",
			[]importedSection{{"", []string{"She said: come home", "and I did"}}},
		},
		"a lone colon is a line": {
			"City lights\n:",
			[]importedSection{{"", []string{"City lights", ":"}}},
		},
		"a lone chord is a chord line, not a heading": {
			"[Chorus]\n[Am]\nMe [F]home",
			[]importedSection{{"Chorus", []string{"[Am]", "Me [F]home"}}},
		},
		"chord-only line is a chord line, not a heading": {
			"[Intro]\n[Am] [F] [C] [G]\n\n[Verse]\n[C]City [G/B]lights",
			[]importedSection{{"Intro", []string{"[Am] [F] [C] [G]"}}, {"Verse", []string{"[C]City [G/B]lights"}}},
		},
		"a chord before a colon is a line": {
			"Come [Am]home:\nnow",
			[]importedSection{{"", []string{"Come [Am]home:", "now"}}},
		},
		"comment directives are dropped": {
			"{comment: capo 2}\nCity lights\n{c:slowly}\nare calling",
			[]importedSection{{"", []string{"City lights", "are calling"}}},
		},
		"unknown directives are ignored": {
			"{artist: Someone}\n{key: Am}\nCity lights\n  {unknown}  \nare calling",
			[]importedSection{{"", []string{"City lights", "are calling"}}},
		},
		"title directives are not lines": {
			"{title: Other Name}\n{t: Other}\nCity lights",
			[]importedSection{{"", []string{"City lights"}}},
		},
		"brackets inside a line are lyrics": {
			"[Chorus] x2\nMe home",
			[]importedSection{{"", []string{"[Chorus] x2", "Me home"}}},
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			res := ts.importSong("Midnight Drive", c.text)

			expectStatus(t, res, http.StatusCreated)
			var s song
			res.JSON(t, &s)
			if got := readSheet(s); !reflect.DeepEqual(got, c.want) {
				t.Errorf("sheet = %+v, want %+v", got, c.want)
			}
			if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
				t.Errorf("song read back = %+v, want %+v", read, s)
			}
		})
	}
}

func TestImportedChordsAreParsed(t *testing.T) {
	ts := newTestServer(t)

	res := ts.importSong("Midnight Drive", "[Intro]\n[Am] [F]\n\n[Verse]\nHel[Am]lo [G]there")

	expectStatus(t, res, http.StatusCreated)
	var s song
	res.JSON(t, &s)
	sections := map[int64]section{}
	for _, sec := range s.Sections {
		sections[sec.ID] = sec
	}
	if len(s.Arrangement) != 2 {
		t.Fatalf("arrangement = %+v, want two Occurrences", s.Arrangement)
	}
	intro := sections[s.Arrangement[0].SectionID].Alternates[0].Lines[0]
	if !intro.ChordLine || !reflect.DeepEqual(intro.Chords, []chord{{0, "Am"}, {1, "F"}}) {
		t.Errorf("intro line = %+v, want a Chord Line with Am and F", intro)
	}
	verse := sections[s.Arrangement[1].SectionID].Alternates[0].Lines[0]
	if verse.ChordLine || verse.Lyrics != "Hello there" || !reflect.DeepEqual(verse.Chords, []chord{{3, "Am"}, {6, "G"}}) {
		t.Errorf("verse line = %+v, want lyrics %q with Am at 3 and G at 6", verse, "Hello there")
	}
}

func TestImportTakesTheTitleFromADirectiveOrTheUser(t *testing.T) {
	cases := map[string]struct {
		title, text, want string
	}{
		"title directive":              {"", "{title: Midnight Drive}\nCity lights", "Midnight Drive"},
		"short title directive":        {"", "{t:Midnight Drive}\nCity lights", "Midnight Drive"},
		"directive name ignores case":  {"", "{Title: Midnight Drive}\nCity lights", "Midnight Drive"},
		"title given by the user":      {"  Midnight Drive ", "City lights", "Midnight Drive"},
		"directive wins over the user": {"Working title", "{title: Midnight Drive}\nCity lights", "Midnight Drive"},
		"empty directive falls back":   {"Midnight Drive", "{title:  }\nCity lights", "Midnight Drive"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			res := ts.importSong(c.title, c.text)

			expectStatus(t, res, http.StatusCreated)
			var s song
			res.JSON(t, &s)
			if s.Title != c.want {
				t.Errorf("title = %q, want %q", s.Title, c.want)
			}
		})
	}
}

func TestImportWithoutATitleIsRejected(t *testing.T) {
	for name, text := range map[string]string{
		"no directive":    "City lights\nare calling",
		"empty directive": "{title:}\nCity lights",
	} {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			res := ts.importSong(" ", text)

			expectError(t, res, http.StatusBadRequest, "title is required: add a {title: ...} line or give one")
			if list := ts.listSongs(); len(list) != 0 {
				t.Errorf("songs = %+v, want none created", list)
			}
		})
	}
}

func TestImportAlwaysCreatesANewSong(t *testing.T) {
	ts := newTestServer(t)
	first := ts.createSong("Midnight Drive")

	res := ts.importSong("Midnight Drive", "City lights")

	expectStatus(t, res, http.StatusCreated)
	var s song
	res.JSON(t, &s)
	if s.ID == first.ID {
		t.Errorf("import reused Song %d, want a new one", first.ID)
	}
	if got := ts.getSong(first.ID); len(got.Sections) != 0 {
		t.Errorf("existing Song sections = %+v, want it untouched", got.Sections)
	}
	if list := ts.listSongs(); len(list) != 2 {
		t.Errorf("songs = %+v, want two", list)
	}
}

func TestImportWithNothingToImportIsRejected(t *testing.T) {
	for name, text := range map[string]string{
		"empty":           "",
		"blank lines":     "\n  \n\n",
		"only directives": "{title: Midnight Drive}\n{c: capo 2}",
	} {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			res := ts.importSong("Midnight Drive", text)

			expectError(t, res, http.StatusBadRequest, "there are no lyrics to import")
			if list := ts.listSongs(); len(list) != 0 {
				t.Errorf("songs = %+v, want none created", list)
			}
		})
	}
}
