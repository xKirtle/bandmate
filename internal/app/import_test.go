package app_test

import (
	"net/http"
	"reflect"
	"strings"
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
	expectNoSectionRepeated(ts.t, s)
	return s
}

// expectNoSectionRepeated checks that each Section appears at most once in
// the Song's Arrangement (ADR 0010).
func expectNoSectionRepeated(t *testing.T, s song) {
	t.Helper()
	seen := map[int64]bool{}
	for _, o := range s.Arrangement {
		if seen[o.SectionID] {
			t.Errorf("section %d appears more than once in arrangement %+v", o.SectionID, s.Arrangement)
		}
		seen[o.SectionID] = true
	}
}

// shownSection is one Section of a Song as the user reads it: its
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
		"unrecognised directives are lines as written": {
			"{comment: Play softly}\nCity lights\n{c:slowly}\n{artist: Someone}\n  {unknown}  \nare calling",
			[]shownSection{{"", []string{"{comment: Play softly}", "City lights", "{c:slowly}", "{artist: Someone}", "  {unknown}  ", "are calling"}}},
		},
		"details directives are not lines": {
			"{title: Other Name}\n{key: Am}\n{bpm: 92}\n{tempo_x: 3}\n{capo: 2}\n{tuning: Drop D}\n{notes: low}\nCity lights",
			[]shownSection{{"", []string{"{tempo_x: 3}", "City lights"}}},
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

func TestImportRepeatedSectionsAreSeparate(t *testing.T) {
	cases := map[string]struct {
		text string
		want []shownSection
	}{
		"an identical chorus three times is three sections": {
			"[Chorus]\nMe home\ntonight\n\n[Verse]\nCity lights\n\n[Chorus]\nMe home\ntonight\n\n[Verse]\nSo far\n\n[Chorus]\nMe home\ntonight",
			[]shownSection{
				{"Chorus", []string{"Me home", "tonight"}}, {"Verse", []string{"City lights"}},
				{"Chorus", []string{"Me home", "tonight"}}, {"Verse", []string{"So far"}},
				{"Chorus", []string{"Me home", "tonight"}},
			},
		},
		"identical stanzas without headings are one section": {
			"Me home\ntonight\n\nMe home\ntonight",
			[]shownSection{{"", []string{"Me home", "tonight", "", "Me home", "tonight"}}},
		},
		"repeated sections keep their lines as written": {
			"[Chorus]\nMe home\ntonight\n\n[Chorus]\n  Me home \ntonight\t",
			[]shownSection{{"Chorus", []string{"Me home", "tonight"}}, {"Chorus", []string{"  Me home ", "tonight\t"}}},
		},
		"a repeated chordpro chorus is its own section": {
			"{soc}\nMe home\n{eoc}\n\n{soc}\nMe home\n{eoc}",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Chorus", []string{"Me home"}}},
		},
		"a heading on its own duplicates the section with that label": {
			"[Chorus]\nMe home\n\ntonight\n\n[Verse]\nCity lights\n\n[Chorus]",
			[]shownSection{{"Chorus", []string{"Me home", "", "tonight"}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home", "", "tonight"}}},
		},
		"a duplicate heading keeps its own label": {
			"Chorus:\nMe home\n\nCHORUS:",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"CHORUS", []string{"Me home"}}},
		},
		"a duplicate heading picks the most recent match": {
			"[Chorus]\nMe home\n\n[Chorus]\nCity lights\n\n[Chorus]",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Chorus", []string{"City lights"}}, {"Chorus", []string{"City lights"}}},
		},
		"a duplicate heading can duplicate a duplicate": {
			"[Chorus]\nMe home\n\n[Chorus]\n[Chorus]",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Chorus", []string{"Me home"}}, {"Chorus", []string{"Me home"}}},
		},
		"a duplicate heading does not match an unlabelled section": {
			"Me home\n\n[Verse]\nCity lights\n\n[Chorus]",
			[]shownSection{{"", []string{"Me home"}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{}}},
		},
		"a heading on its own without an earlier match stays empty": {
			"[Verse]\nCity lights\n\n[Chorus]\n\n[Chorus]",
			[]shownSection{{"Verse", []string{"City lights"}}, {"Chorus", []string{}}, {"Chorus", []string{}}},
		},
		"a heading does not duplicate a later section": {
			"[Chorus]\n[Verse]\nCity lights\n\n[Chorus]\nMe home",
			[]shownSection{{"Chorus", []string{}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
		},
		"an empty chordpro section duplicates the chorus": {
			"{soc}\nMe home\n{eoc}\n{sov}\nCity lights\n{eov}\n{soc}\n{eoc}",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			s := ts.importSheet(c.text)

			if got := readSheet(s); !reflect.DeepEqual(got, c.want) {
				t.Errorf("sheet = %+v, want %+v", got, c.want)
			}
			if got, want := len(s.Sections), len(c.want); got != want {
				t.Errorf("%d sections, want %d, one per Section in the arrangement", got, want)
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
	sections := sectionsByID(s)
	if len(s.Arrangement) != 2 {
		t.Fatalf("arrangement = %+v, want two Sections", s.Arrangement)
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
		"only directives": "{title: Midnight Drive}\n{key: Am}\n{notes: low}",
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

func TestImportDirectivesSetTheSongsDetails(t *testing.T) {
	ts := newTestServer(t)

	s := ts.importSheet("{key: Am}\n{bpm: 92}\n{capo:2}\n{tuning: Drop D}\nCity lights")

	if s.Key != "Am" || s.BPM == nil || *s.BPM != 92 || s.Capo == nil || *s.Capo != 2 || s.Tuning != "Drop D" {
		t.Errorf("details = key %q, bpm %v, capo %v, tuning %q; want Am, 92, 2, Drop D", s.Key, s.BPM, s.Capo, s.Tuning)
	}
	if sheet := readSheet(s); !reflect.DeepEqual(sheet, []shownSection{{"", []string{"City lights"}}}) {
		t.Errorf("sheet = %+v, want the directives left out", sheet)
	}
}

func TestImportTakesTheTempoAsTheBPM(t *testing.T) {
	ts := newTestServer(t)

	s := ts.importSheet("{tempo: 120}\nCity lights")

	if s.BPM == nil || *s.BPM != 120 {
		t.Errorf("bpm = %v, want 120", s.BPM)
	}
}

func TestImportNotesDirectivesBecomeTheNotesLines(t *testing.T) {
	ts := newTestServer(t)

	s := ts.importSheet("{notes: Sing it low}\nCity lights\n{notes:Half time in the bridge}\n{Notes: }\n{notes: Fade out}")

	if want := "Sing it low\nHalf time in the bridge\n\nFade out"; s.Notes != want {
		t.Errorf("notes = %q, want %q", s.Notes, want)
	}
}

// expectImportRejected pastes text into a new Song titled Midnight Drive and
// expects it to be rejected with msg, creating no Song.
func (ts *testServer) expectImportRejected(text, msg string) {
	ts.t.Helper()
	expectError(ts.t, ts.importSong("Midnight Drive", text), http.StatusBadRequest, msg)
	if list := ts.listSongs(); len(list) != 0 {
		ts.t.Errorf("songs = %+v, want none created", list)
	}
}

func TestImportWithABadBPMOrCapoIsRejected(t *testing.T) {
	cases := map[string]struct{ text, want string }{
		"bpm not a number":   {"City lights\n{bpm: fast}", "line 2: bpm must be a whole number between 1 and 999"},
		"bpm not whole":      {"{bpm: 92.5}\nCity lights", "line 1: bpm must be a whole number between 1 and 999"},
		"bpm too low":        {"{bpm: 0}\nCity lights", "line 1: bpm must be a whole number between 1 and 999"},
		"bpm too high":       {"{bpm: 1000}\nCity lights", "line 1: bpm must be a whole number between 1 and 999"},
		"bpm empty":          {"{bpm:}\nCity lights", "line 1: bpm must be a whole number between 1 and 999"},
		"tempo out of range": {"\n\n{tempo: -4}\nCity lights", "line 3: tempo must be a whole number between 1 and 999"},
		"capo not a number":  {"{capo: two}\nCity lights", "line 1: capo must be a whole number between 0 and 24"},
		"capo too low":       {"{capo: -1}\nCity lights", "line 1: capo must be a whole number between 0 and 24"},
		"capo too high":      {"[Verse]\nCity lights\n{capo: 25}", "line 3: capo must be a whole number between 0 and 24"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			newTestServer(t).expectImportRejected(c.text, c.want)
		})
	}
}

func TestImportTakesTheEdgesOfTheBPMAndCapoRanges(t *testing.T) {
	ts := newTestServer(t)

	low := ts.importSheet("{bpm: 1}\n{capo: 0}\nCity lights")
	high := ts.importSheet("{bpm: 999}\n{capo: 24}\nCity lights")

	for _, c := range []struct {
		s         song
		bpm, capo int
	}{{low, 1, 0}, {high, 999, 24}} {
		if c.s.BPM == nil || *c.s.BPM != c.bpm || c.s.Capo == nil || *c.s.Capo != c.capo {
			t.Errorf("bpm, capo = %v, %v; want %d, %d", c.s.BPM, c.s.Capo, c.bpm, c.capo)
		}
	}
}

func TestImportWithARepeatedDirectiveIsRejected(t *testing.T) {
	cases := map[string]struct{ text, want string }{
		"title":         {"{title: Midnight Drive}\nCity lights\n{title: Other}", "line 3: the title is already given on line 1"},
		"title and t":   {"{t: Midnight Drive}\n{Title: Other}\nCity lights", "line 2: the title is already given on line 1"},
		"empty title":   {"{title:}\n{title: Midnight Drive}\nCity lights", "line 2: the title is already given on line 1"},
		"key":           {"{key: Am}\n{key: C}\nCity lights", "line 2: the key is already given on line 1"},
		"bpm":           {"{bpm: 92}\nCity lights\n\n{bpm: 92}", "line 4: the bpm is already given on line 1"},
		"bpm and tempo": {"{tempo: 92}\n{bpm: 100}\nCity lights", "line 2: the bpm is already given on line 1"},
		"capo":          {"{capo: 2}\n{capo: 3}\nCity lights", "line 2: the capo is already given on line 1"},
		"tuning":        {"{tuning: Standard}\n{tuning: Drop D}\nCity lights", "line 2: the tuning is already given on line 1"},
		"bad repeat":    {"{capo: 2}\n{capo: x}\nCity lights", "line 2: the capo is already given on line 1"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			newTestServer(t).expectImportRejected(c.text, c.want)
		})
	}
}

func TestImportKeepsBracketTagsAsLabels(t *testing.T) {
	ts := newTestServer(t)

	s := ts.importSheet("[title: Other Name]\nCity lights\n\n[ti: Other]\nMe home\n[ar: Someone]")

	if s.Title != "Midnight Drive" {
		t.Errorf("title = %q, want the one given, Midnight Drive", s.Title)
	}
	want := []shownSection{{"title: Other Name", []string{"City lights"}}, {"ti: Other", []string{"Me home"}}, {"ar: Someone", []string{}}}
	if sheet := readSheet(s); !reflect.DeepEqual(sheet, want) {
		t.Errorf("sheet = %+v, want %+v", sheet, want)
	}
}

// shownCues is one Section's Line Cues as imported, by the position of
// each Line in its active Alternate.
type shownCues map[int]float64

// readCues lists a Song's Cues by Section, in Arrangement order.
func readCues(s song) []shownCues {
	sections := sectionsByID(s)
	out := []shownCues{}
	for _, o := range s.Arrangement {
		lines := map[int]float64{}
		for _, alt := range sections[o.SectionID].Alternates {
			if !alt.Active {
				continue
			}
			for pos, l := range alt.Lines {
				if cue, ok := o.LineCues[l.ID]; ok {
					lines[pos] = cue
				}
			}
		}
		out = append(out, lines)
	}
	return out
}

func TestImportTimestampsCueTheirLines(t *testing.T) {
	cases := map[string]struct {
		stamp string
		want  float64
	}{
		"minutes and seconds":     {"[1:02]", 62},
		"tenths":                  {"[1:02.5]", 62.5},
		"hundredths":              {"[1:02.34]", 62.34},
		"many minutes":            {"[75:03]", 4503},
		"leading zeros":           {"[00:07.10]", 7.1},
		"kept to the millisecond": {"[0:01.2345]", 1.235},
		"a space after the stamp": {"[1:02] ", 62},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			s := ts.importSheet("City lights\n" + c.stamp + "are calling")

			if got, want := readSheet(s), []shownSection{{"", []string{"City lights", "are calling"}}}; !reflect.DeepEqual(got, want) {
				t.Errorf("sheet = %+v, want %+v", got, want)
			}
			if got, want := readCues(s), []shownCues{{1: c.want}}; !reflect.DeepEqual(got, want) {
				t.Errorf("cues = %+v, want %+v", got, want)
			}
		})
	}
}

func TestImportTimestamps(t *testing.T) {
	cases := map[string]struct {
		text string
		want []shownSection
		cues []shownCues
	}{
		"timestamped lines are cued": {
			"[Verse]\n[0:05]City lights\n[0:08]are calling",
			[]shownSection{{"Verse", []string{"City lights", "are calling"}}},
			[]shownCues{{0: 5, 1: 8}},
		},
		"blank lines at a section's start take no cue": {
			"[Verse]\n\n[0:01]\n[0:05]City lights",
			[]shownSection{{"Verse", []string{"City lights"}}},
			[]shownCues{{0: 5}},
		},
		"a timestamp in front of a bracketed heading cues its first line": {
			"[0:30][Chorus]\nMe home\n[0:34]tonight",
			[]shownSection{{"Chorus", []string{"Me home", "tonight"}}},
			[]shownCues{{0: 30, 1: 34}},
		},
		"a timestamp in front of a colon heading cues its first line": {
			"[00:30.0]Chorus:\nMe home",
			[]shownSection{{"Chorus", []string{"Me home"}}},
			[]shownCues{{0: 30}},
		},
		"a heading and its first line can give the same time": {
			"[00:30.0][Chorus]\n\n[0:30]Me home",
			[]shownSection{{"Chorus", []string{"Me home"}}},
			[]shownCues{{0: 30}},
		},
		"a heading's timestamp cues only its own section": {
			"[0:10][Chorus]\nMe home\n\n[Verse]\nCity lights\n\n[Chorus]\n[1:10]Me home",
			[]shownSection{{"Chorus", []string{"Me home"}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home"}}},
			[]shownCues{{0: 10}, {}, {0: 70}},
		},
		"identical choruses at different times keep their own cues": {
			"[Chorus]\n[0:10]Me home\n[0:14]tonight\n\n[Verse]\n[0:20]City lights\n\n[Chorus]\n[0:40]Me home\n[0:44] tonight",
			[]shownSection{{"Chorus", []string{"Me home", "tonight"}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home", "tonight"}}},
			[]shownCues{
				{0: 10, 1: 14},
				{0: 20},
				{0: 40, 1: 44},
			},
		},
		"a timestamp on a duplicate heading cues the duplicate's first line": {
			"[Chorus]\n[0:10]Me home\n[0:14]tonight\n\n[Verse]\n[0:20]City lights\n\n[0:40][Chorus]",
			[]shownSection{{"Chorus", []string{"Me home", "tonight"}}, {"Verse", []string{"City lights"}}, {"Chorus", []string{"Me home", "tonight"}}},
			[]shownCues{{0: 10, 1: 14}, {0: 20}, {0: 40}},
		},
		"a duplicate heading without a timestamp copies no cues": {
			"[0:10][Chorus]\nMe home\n[0:14]tonight\n\n[Chorus]",
			[]shownSection{{"Chorus", []string{"Me home", "tonight"}}, {"Chorus", []string{"Me home", "tonight"}}},
			[]shownCues{{0: 10, 1: 14}, {}},
		},
		"timestamps out of order are kept as given": {
			"[0:50]City lights\n[0:20]are calling\n[0:30]Me home",
			[]shownSection{{"", []string{"City lights", "are calling", "Me home"}}},
			[]shownCues{{0: 50, 1: 20, 2: 30}},
		},
		"a timestamp alone is a blank line": {
			"[0:01]\n[Verse]\n[0:02]\n[0:05]City lights\n[0:09]\n[0:10]are calling\n[0:14]\n\n[0:20]",
			[]shownSection{{"Verse", []string{"City lights", "", "are calling"}}},
			[]shownCues{{0: 5, 2: 10}},
		},
		"a timestamp alone keeps a section going": {
			"[Chorus]\nMe home\n[0:09]\ntonight",
			[]shownSection{{"Chorus", []string{"Me home", "", "tonight"}}},
			[]shownCues{{}},
		},
		"chord lines take timestamps": {
			"[Intro]\n[0:00][Am] [F]\n[0:04.5]  [C] [G]",
			[]shownSection{{"Intro", []string{"[Am] [F]", "[C] [G]"}}},
			[]shownCues{{0: 0, 1: 4.5}},
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			s := ts.importSheet(c.text)

			if got := readSheet(s); !reflect.DeepEqual(got, c.want) {
				t.Errorf("sheet = %+v, want %+v", got, c.want)
			}
			if got := readCues(s); !reflect.DeepEqual(got, c.cues) {
				t.Errorf("cues = %+v, want %+v", got, c.cues)
			}
		})
	}
}

func TestImportWithABadTimestampIsRejected(t *testing.T) {
	cases := map[string]struct{ text, want string }{
		"one-digit seconds":     {"City lights\n[1:2]are calling", "line 2: a timestamp must be minutes and two digits of seconds, like [1:02] or [1:02.34]"},
		"alone":                 {"[1:2]\nCity lights", "line 1: a timestamp must be minutes and two digits of seconds, like [1:02] or [1:02.34]"},
		"no minutes":            {"[:30]City lights", "line 1: a timestamp must be minutes and two digits of seconds, like [1:02] or [1:02.34]"},
		"no decimals":           {"[0:30.]City lights", "line 1: a timestamp must be minutes and two digits of seconds, like [1:02] or [1:02.34]"},
		"hours":                 {"[1:00:30]City lights", "line 1: a timestamp must be minutes and two digits of seconds, like [1:02] or [1:02.34]"},
		"sixty seconds":         {"[0:60]City lights", "line 1: a timestamp must be minutes and two digits of seconds, like [1:02] or [1:02.34]"},
		"comma decimals":        {"[01:02,50]City lights", "line 1: a timestamp must be minutes and two digits of seconds, like [1:02] or [1:02.34]"},
		"over a day":            {"[1440:01]City lights", "line 1: a Cue can't be more than 24 hours into the Timeline"},
		"several timestamps":    {"City lights\n\n[00:45.0][01:50.0]Take me home", "line 3: a line can have only one timestamp"},
		"a bad second one":      {"[00:45.0][1:5]Take me home", "line 1: a line can have only one timestamp"},
		"in front of directive": {"City lights\n[00:10.0]{comment: x}", "line 2: a directive can't have a timestamp"},
		"in front of soc":       {"[00:10.0]{soc}\nMe home", "line 1: a directive can't have a timestamp"},
		"heading differs from first line": {
			"[Verse]\nCity lights\n\n[0:30][Chorus]\n\n[0:31]Me home",
			"line 6: its timestamp differs from the heading's on line 4",
		},
		"heading with no lines under it": {
			"[Chorus]\nMe home\n\n[1:10][Verse]\n\n[Bridge]\nCity lights",
			"line 4: a timestamp on a heading needs a Line under it to cue",
		},
		"heading at the end with no lines under it": {
			"[Chorus]\nMe home\n\n[1:10][Verse]",
			"line 4: a timestamp on a heading needs a Line under it to cue",
		},
		"heading duplicating a section with no lines": {
			"[Chorus]\n[Verse]\nCity lights\n\n[1:10][Chorus]",
			"line 5: a timestamp on a heading needs a Line under it to cue",
		},
		"heading ended with no lines under it": {
			"City lights\n[1:10][Chorus]\n{eoc}\nMe home",
			"line 2: a timestamp on a heading needs a Line under it to cue",
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			newTestServer(t).expectImportRejected(c.text, c.want)
		})
	}
}

func TestImportOffsetShiftsEveryCue(t *testing.T) {
	cases := map[string]struct {
		text string
		cues []shownCues
	}{
		"later in seconds": {
			"{offset: 1.5}\n[0:30][Chorus]\nMe home\n[0:34]tonight\n\n[Verse]\n[0:40]City lights",
			[]shownCues{{0: 31.5, 1: 35.5}, {0: 41.5}},
		},
		"earlier in minutes and seconds": {
			"{offset: -0:02}\n[0:30][Chorus]\nMe home\n[0:34]tonight\n\n[Verse]\n[0:40]City lights",
			[]shownCues{{0: 28, 1: 32}, {0: 38}},
		},
		"among the timestamps": {
			"[0:30][Chorus]\nMe home\n{offset: -0:02}\n[0:34]tonight\n\n[Verse]\n[0:40]City lights",
			[]shownCues{{0: 28, 1: 32}, {0: 38}},
		},
		"after the timestamps": {
			"[0:30][Chorus]\nMe home\n[0:34]tonight\n\n[Verse]\n[0:40]City lights\n{offset: -0:02}",
			[]shownCues{{0: 28, 1: 32}, {0: 38}},
		},
		"to 0:00": {
			"{offset: -5}\n[0:05]City lights",
			[]shownCues{{0: 0}},
		},
		"kept to the millisecond": {
			"{Offset: +0:00.001}\n[0:01.2345]City lights",
			[]shownCues{{0: 1.236}},
		},
		"without timestamps": {
			"{offset: 3}\nCity lights",
			[]shownCues{{}},
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)

			s := ts.importSheet(c.text)

			if got := readCues(s); !reflect.DeepEqual(got, c.cues) {
				t.Errorf("cues = %+v, want %+v", got, c.cues)
			}
			for _, sec := range readSheet(s) {
				for _, line := range sec.Lines {
					if strings.HasPrefix(strings.ToLower(line), "{offset") {
						t.Errorf("sheet = %+v, want the offset directive dropped", readSheet(s))
					}
				}
			}
		})
	}
}

func TestImportWithABadOffsetIsRejected(t *testing.T) {
	cases := map[string]struct{ text, want string }{
		"before 0:00": {
			"[0:30][Chorus]\nMe home\n\n[Verse]\n[0:01]City lights\n{offset: -2}",
			"line 5: a Cue can't be before the start of the Timeline",
		},
		"a duplicate heading's cue before 0:00": {
			"[Chorus]\n[0:05]Me home\n\n{offset: -0:02}\n[0:01][Chorus]",
			"line 5: a Cue can't be before the start of the Timeline",
		},
		"a heading's cue before 0:00": {
			"{offset: -0:02}\n[0:01][Chorus]\nMe home",
			"line 2: a Cue can't be before the start of the Timeline",
		},
		"past a day": {
			"{offset: 1}\n[1440:00]City lights",
			"line 2: a Cue can't be more than 24 hours into the Timeline",
		},
		"repeated": {
			"{offset: 1}\nCity lights\n{offset: 1}",
			"line 3: the offset is already given on line 1",
		},
		"not a time":        {"City lights\n{offset: soon}", "line 2: the offset must be a time in seconds, like 1.5 or -0:02"},
		"empty":             {"{offset:}\nCity lights", "line 1: the offset must be a time in seconds, like 1.5 or -0:02"},
		"a timestamp":       {"{offset: [0:02]}\nCity lights", "line 1: the offset must be a time in seconds, like 1.5 or -0:02"},
		"one-digit seconds": {"{offset: 0:2}\nCity lights", "line 1: the offset must be a time in seconds, like 1.5 or -0:02"},
		"comma decimals":    {"{offset: 1,5}\nCity lights", "line 1: the offset must be a time in seconds, like 1.5 or -0:02"},
		"over a day":        {"{offset: 86401}\nCity lights", "line 1: the offset can't be more than 24 hours"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			newTestServer(t).expectImportRejected(c.text, c.want)
		})
	}
}
