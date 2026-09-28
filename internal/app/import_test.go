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

// importSheet pastes text into a new Song titled Midnight Drive, expects it
// to be created and to read back the same, and returns it.
func (ts *testServer) importSheet(text string) song {
	ts.t.Helper()
	res := ts.importSong("Midnight Drive", text)
	expectStatus(ts.t, res, http.StatusCreated)
	var s song
	res.JSON(ts.t, &s)
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
		ts.t.Errorf("song read back = %+v, want %+v", read, s)
	}
	return s
}

// shownSection is one Occurrence of a Song as the user reads it: its
// Section's Label and the texts of its active Lines.
type shownSection struct {
	Label string
	Lines []string
}

// readSheet lists a Song's Arrangement as imported Sections, in order.
func readSheet(s song) []shownSection {
	sections := sectionsByID(s)
	out := []shownSection{}
	for _, o := range s.Arrangement {
		sec := sections[o.SectionID]
		lines := []string{}
		for _, alt := range sec.Alternates {
			if alt.Active {
				lines = lineTexts(alt)
			}
		}
		out = append(out, shownSection{Label: sec.Label, Lines: lines})
	}
	return out
}

// sectionsByID indexes a Song's Sections by id.
func sectionsByID(s song) map[int64]section {
	sections := map[int64]section{}
	for _, sec := range s.Sections {
		sections[sec.ID] = sec
	}
	return sections
}

func TestImportSplitsPastedTextIntoSections(t *testing.T) {
	cases := map[string]struct {
		text string
		want []shownSection
	}{
		"one section": {
			"City lights\nare calling",
			[]shownSection{{"", []string{"City lights", "are calling"}}},
		},
		"a blank line is a blank line, not a new section": {
			"City lights\nare calling\n\nMe home\ntonight",
			[]shownSection{{"", []string{"City lights", "are calling", "", "Me home", "tonight"}}},
		},
		"several blank lines are several blank lines": {
			"\n\nCity lights\n\n\n  \n\t\nMe home\n\n\n",
			[]shownSection{{"", []string{"City lights", "", "", "  ", "\t", "Me home"}}},
		},
		"windows line endings": {
			"City lights\r\nare calling\r\n\r\nMe home",
			[]shownSection{{"", []string{"City lights", "are calling", "", "Me home"}}},
		},
		"lines kept as written": {
			"  City lights  \nare calling",
			[]shownSection{{"", []string{"  City lights  ", "are calling"}}},
		},
		"colon heading": {
			"Verse 1:\nCity lights\n\nChorus:\nMe home",
			[]shownSection{{"Verse 1", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
		},
		"bracketed heading": {
			"[Verse 1]\nCity lights\n\n  [Chorus x2]  \nMe home",
			[]shownSection{{"Verse 1", []string{"City lights"}}, {"Chorus x2", []string{"Me home"}}},
		},
		"heading without a blank line before it": {
			"[Verse]\nCity lights\nChorus:\nMe home",
			[]shownSection{{"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
		},
		"heading with no lines is an empty section": {
			"Intro:\n[Verse]\nCity lights\n\n[Outro]\n\n",
			[]shownSection{{"Intro", []string{}}, {"Verse", []string{"City lights"}}, {"Outro", []string{}}},
		},
		"blank lines at a section's start and end are trimmed": {
			"[Verse]\n\n  \nCity lights\n\nare calling\n\n\n[Chorus]\n\nMe home\n \n",
			[]shownSection{{"Verse", []string{"City lights", "", "are calling"}}, {"Chorus", []string{"Me home"}}},
		},
		"text after the colon is a line": {
			"She said: come home\nand I did",
			[]shownSection{{"", []string{"She said: come home", "and I did"}}},
		},
		"a lone colon is a line": {
			"City lights\n:",
			[]shownSection{{"", []string{"City lights", ":"}}},
		},
		"a lone chord is a chord line, not a heading": {
			"[Chorus]\n[Am]\nMe [F]home",
			[]shownSection{{"Chorus", []string{"[Am]", "Me [F]home"}}},
		},
		"other lone chords are chord lines too": {
			"[C]\n[Bm7]\n[D/F#]",
			[]shownSection{{"", []string{"[C]", "[Bm7]", "[D/F#]"}}},
		},
		"a padded chord is not a heading": {
			"[ Am ]\nMe home",
			[]shownSection{{"", []string{"[ Am ]", "Me home"}}},
		},
		"chord-only line is a chord line, not a heading": {
			"[Intro]\n[Am] [F] [C] [G]\n\n[Verse]\n[C]City [G/B]lights",
			[]shownSection{{"Intro", []string{"[Am] [F] [C] [G]"}}, {"Verse", []string{"[C]City [G/B]lights"}}},
		},
		"a chord before a colon is a line": {
			"Come [Am]home:\nnow",
			[]shownSection{{"", []string{"Come [Am]home:", "now"}}},
		},
		"comment directives are dropped": {
			"{comment: capo 2}\nCity lights\n{c:slowly}\nare calling",
			[]shownSection{{"", []string{"City lights", "are calling"}}},
		},
		"unknown directives are ignored": {
			"{artist: Someone}\n{key: Am}\nCity lights\n  {unknown}  \nare calling",
			[]shownSection{{"", []string{"City lights", "are calling"}}},
		},
		"title directives are not lines": {
			"{title: Other Name}\n{t: Other}\nCity lights",
			[]shownSection{{"", []string{"City lights"}}},
		},
		"chordpro section directives": {
			"{start_of_verse}\nCity lights\n{end_of_verse}\n{start_of_chorus}\nMe home\n{end_of_chorus}\n{start_of_bridge}\nSo far\n{end_of_bridge}",
			[]shownSection{{"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}}, {"Bridge", []string{"So far"}}},
		},
		"short chordpro section directives": {
			"{sov}\nCity lights\n{eov}\n{soc}\nMe home\n{eoc}\n{sob}\nSo far\n{eob}",
			[]shownSection{{"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}}, {"Bridge", []string{"So far"}}},
		},
		"a section directive can name its label": {
			"{start_of_verse: Verse 2}\nCity lights\n{end_of_verse}",
			[]shownSection{{"Verse 2", []string{"City lights"}}},
		},
		"section directive names ignore case": {
			"{Start_Of_Chorus}\nMe home\n{EOC}",
			[]shownSection{{"Chorus", []string{"Me home"}}},
		},
		"an end directive closes the section": {
			"{soc}\nMe home\n{eoc}\nCity lights",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"", []string{"City lights"}}},
		},
		"lines after an end directive are one unlabelled section": {
			"{soc}\nMe home\n{eoc}\n\nCity lights\n\nare calling\n\n{sov}\nSo far\n{eov}",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"", []string{"City lights", "", "are calling"}}, {"Verse", []string{"So far"}}},
		},
		"blank lines between an end and a start directive are no section": {
			"{soc}\nMe home\n{eoc}\n\n \n{sov}\nCity lights\n{eov}\n\n",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Verse", []string{"City lights"}}},
		},
		"a blank line inside a chordpro section is a blank line": {
			"{sov}\n\nCity lights\n\nare calling\n\n{eov}",
			[]shownSection{{"Verse", []string{"City lights", "", "are calling"}}},
		},
		"a section directive closes the one before": {
			"City lights\n{soc}\nMe home",
			[]shownSection{{"", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
		},
		"brackets inside a line are lyrics": {
			"[Chorus] x2\nMe home",
			[]shownSection{{"", []string{"[Chorus] x2", "Me home"}}},
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			s := ts.importSheet(c.text)

			if got := readSheet(s); !reflect.DeepEqual(got, c.want) {
				t.Errorf("sheet = %+v, want %+v", got, c.want)
			}
		})
	}
}

// sharing numbers each Occurrence of a Song by its Section, in order of first
// appearance, so Occurrences of one shared Section get the same number.
func sectionNumbers(s song) []int {
	number := map[int64]int{}
	out := []int{}
	for _, o := range s.Arrangement {
		if _, ok := number[o.SectionID]; !ok {
			number[o.SectionID] = len(number)
		}
		out = append(out, number[o.SectionID])
	}
	return out
}

func TestImportMergesRepeatedSections(t *testing.T) {
	cases := map[string]struct {
		text     string
		want     []shownSection
		sections []int
	}{
		"an identical chorus three times is one section": {
			"[Chorus]\nMe home\ntonight\n\n[Verse]\nCity lights\n\n[Chorus]\nMe home\ntonight\n\n[Verse]\nSo far\n\n[Chorus]\nMe home\ntonight",
			[]shownSection{
				{"Chorus", []string{"Me home", "tonight"}}, {"Verse", []string{"City lights"}},
				{"Chorus", []string{"Me home", "tonight"}}, {"Verse", []string{"So far"}},
				{"Chorus", []string{"Me home", "tonight"}},
			},
			[]int{0, 1, 0, 2, 0},
		},
		"identical stanzas without headings are one section": {
			"Me home\ntonight\n\nMe home\ntonight",
			[]shownSection{{"", []string{"Me home", "tonight", "", "Me home", "tonight"}}},
			[]int{0},
		},
		"whitespace at line ends is ignored": {
			"[Chorus]\nMe home\ntonight\n\n[Chorus]\n  Me home \ntonight\t",
			[]shownSection{{"Chorus", []string{"Me home", "tonight"}}, {"Chorus", []string{"Me home", "tonight"}}},
			[]int{0, 0},
		},
		"blank lines inside merge like any line": {
			"[Chorus]\nMe home\n\ntonight\n\n[Verse]\nCity lights\n\n[Chorus]\nMe home\n  \ntonight",
			[]shownSection{
				{"Chorus", []string{"Me home", "", "tonight"}}, {"Verse", []string{"City lights"}},
				{"Chorus", []string{"Me home", "", "tonight"}},
			},
			[]int{0, 1, 0},
		},
		"a blank line more does not merge": {
			"[Chorus]\nMe home\ntonight\n\n[Chorus]\nMe home\n\ntonight",
			[]shownSection{{"Chorus", []string{"Me home", "tonight"}}, {"Chorus", []string{"Me home", "", "tonight"}}},
			[]int{0, 1},
		},
		"sections that differ slightly do not merge": {
			"[Chorus]\nMe home\ntonight\n[Chorus]\nMe home\ntonight!\n[Chorus]\nMe home\n[Chorus]\nMe  home\ntonight\n[Chorus]\nMe home\ntonight\nagain",
			[]shownSection{
				{"Chorus", []string{"Me home", "tonight"}}, {"Chorus", []string{"Me home", "tonight!"}}, {"Chorus", []string{"Me home"}},
				{"Chorus", []string{"Me  home", "tonight"}}, {"Chorus", []string{"Me home", "tonight", "again"}},
			},
			[]int{0, 1, 2, 3, 4},
		},
		"different chords do not merge": {
			"[Chorus]\nMe [Am]home\n\n[Chorus]\nMe [F]home",
			[]shownSection{{"Chorus", []string{"Me [Am]home"}}, {"Chorus", []string{"Me [F]home"}}},
			[]int{0, 1},
		},
		"a label on the first one is kept": {
			"{soc}\nMe home\n{eoc}\n\nMe home",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Chorus", []string{"Me home"}}},
			[]int{0, 0},
		},
		"a label on a later one is kept": {
			"Me home\n\nChorus:\nMe home",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Chorus", []string{"Me home"}}},
			[]int{0, 0},
		},
		"labels differing only in case merge": {
			"[Chorus]\nMe home\n\n[chorus]\nMe home",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Chorus", []string{"Me home"}}},
			[]int{0, 0},
		},
		"different labels do not merge": {
			"[Intro]\n[Am] [F]\n\n[Outro]\n[Am] [F]",
			[]shownSection{{"Intro", []string{"[Am] [F]"}}, {"Outro", []string{"[Am] [F]"}}},
			[]int{0, 1},
		},
		"a heading on its own repeats the section with that label": {
			"[Chorus]\nMe home\n\n[Verse]\nCity lights\n\n[Chorus]",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
			[]int{0, 1, 0},
		},
		"a repeat heading ignores case": {
			"Chorus:\nMe home\n\nCHORUS:",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Chorus", []string{"Me home"}}},
			[]int{0, 0},
		},
		"a repeat heading picks the most recent match": {
			"[Chorus]\nMe home\n\n[Chorus]\nCity lights\n\n[Chorus]",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Chorus", []string{"City lights"}}, {"Chorus", []string{"City lights"}}},
			[]int{0, 1, 1},
		},
		"a repeat heading matches a label kept on merge": {
			"Me home\n\n[Chorus]\nMe home\n\n[Verse]\nCity lights\n\n[Chorus]",
			[]shownSection{
				{"Chorus", []string{"Me home"}}, {"Chorus", []string{"Me home"}},
				{"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}},
			},
			[]int{0, 0, 1, 0},
		},
		"a repeat heading without an earlier match is an empty section": {
			"[Verse]\nCity lights\n\n[Chorus]\n\n[Chorus]",
			[]shownSection{{"Verse", []string{"City lights"}}, {"Chorus", []string{}}, {"Chorus", []string{}}},
			[]int{0, 1, 1},
		},
		"a heading does not repeat a later section": {
			"[Chorus]\n[Verse]\nCity lights\n\n[Chorus]\nMe home",
			[]shownSection{{"Chorus", []string{}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
			[]int{0, 1, 2},
		},
		"an empty chordpro section repeats the chorus": {
			"{soc}\nMe home\n{eoc}\n{sov}\nCity lights\n{eov}\n{soc}\n{eoc}",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
			[]int{0, 1, 0},
		},
		"a repeated chordpro chorus merges": {
			"{soc}\nMe home\n{eoc}\n\n{soc}\nMe home\n{eoc}",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Chorus", []string{"Me home"}}},
			[]int{0, 0},
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			s := ts.importSheet(c.text)

			if got := readSheet(s); !reflect.DeepEqual(got, c.want) {
				t.Errorf("sheet = %+v, want %+v", got, c.want)
			}
			if got := sectionNumbers(s); !reflect.DeepEqual(got, c.sections) {
				t.Errorf("sections by occurrence = %v, want %v", got, c.sections)
			}
		})
	}
}

func TestAWronglyMergedOccurrenceCanBeDetached(t *testing.T) {
	ts := newTestServer(t)
	s := ts.importSheet("[Chorus]\nMe home\n\n[Verse]\nCity lights\n\n[Chorus]\nMe home")
	last := s.Arrangement[2]

	got := ts.lyricSheetChange(http.MethodPost, detachPath(s.ID, last.ID), nil)

	if sectionNumbers(got)[2] != 2 {
		t.Fatalf("sections by occurrence = %v, want the last one on its own", sectionNumbers(got))
	}
	copied := sectionOf(t, got, got.Arrangement[2])
	ts.setText(got.ID, copied.Alternates[0].ID, "Me home again")
	want := []shownSection{{"Chorus", []string{"Me home"}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home again"}}}
	if sheet := readSheet(ts.getSong(s.ID)); !reflect.DeepEqual(sheet, want) {
		t.Errorf("sheet = %+v, want %+v", sheet, want)
	}
}

func TestImportedChordsAreParsed(t *testing.T) {
	ts := newTestServer(t)

	res := ts.importSong("Midnight Drive", "[Intro]\n[Am] [F]\n\n[Verse]\nHel[Am]lo [G]there")

	expectStatus(t, res, http.StatusCreated)
	var s song
	res.JSON(t, &s)
	sections := sectionsByID(s)
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
