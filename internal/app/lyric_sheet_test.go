package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

func TestAddingASectionCreatesItWithOneActiveAlternateInTheArrangement(t *testing.T) {
	ts := newTestServer(t)
	created := ts.createSong("Midnight Drive")

	got := ts.addSection(created.ID, map[string]any{"label": "Verse"})

	if len(got.Sections) != 1 {
		t.Fatalf("sections = %+v, want one", got.Sections)
	}
	sec := got.Sections[0]
	if sec.Label != "Verse" {
		t.Errorf("label = %q, want %q", sec.Label, "Verse")
	}
	if len(sec.Alternates) != 1 || !sec.Alternates[0].Active || len(sec.Alternates[0].Lines) != 0 {
		t.Errorf("alternates = %+v, want one active, empty Alternate", sec.Alternates)
	}
	wantArrangement := []int64{sec.ID}
	if !reflect.DeepEqual(got.Arrangement, wantArrangement) {
		t.Errorf("arrangement = %+v, want %+v", got.Arrangement, wantArrangement)
	}
	if len(got.Scrapbook) != 0 || got.Scrapbook == nil {
		t.Errorf("scrapbook = %#v, want an empty list", got.Scrapbook)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, created.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, created.UpdatedAt)
	}
	if read := ts.getSong(created.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("song read back = %+v, want %+v", read, got)
	}
}

// arrangementLabels lists the Labels of the Arrangement's Sections in order.
func arrangementLabels(s song) []string {
	labels := map[int64]string{}
	for _, sec := range s.Sections {
		labels[sec.ID] = sec.Label
	}
	out := []string{}
	for _, id := range s.Arrangement {
		out = append(out, labels[id])
	}
	return out
}

func TestSectionsAreAddedAtTheirPositionInTheArrangement(t *testing.T) {
	ts := newTestServer(t)
	id := ts.createSong("Midnight Drive").ID

	ts.addSection(id, map[string]any{"label": "Verse 1"})
	ts.addSection(id, map[string]any{"label": "Chorus"})
	ts.addSection(id, map[string]any{"label": "Intro", "position": 0})
	ts.addSection(id, map[string]any{"label": "Pre-Chorus", "position": 2})
	got := ts.addSection(id, map[string]any{"label": "Outro", "position": 4})

	want := []string{"Intro", "Verse 1", "Pre-Chorus", "Chorus", "Outro"}
	if labels := arrangementLabels(got); !reflect.DeepEqual(labels, want) {
		t.Errorf("arrangement = %q, want %q", labels, want)
	}
	if labels := arrangementLabels(ts.getSong(id)); !reflect.DeepEqual(labels, want) {
		t.Errorf("arrangement read back = %q, want %q", labels, want)
	}
}

func TestAddingASectionOutsideTheArrangementIsRejected(t *testing.T) {
	for _, position := range []int{-1, 3} {
		t.Run(fmt.Sprint(position), func(t *testing.T) {
			ts := newTestServer(t)
			id := ts.createSong("Midnight Drive").ID
			ts.addSection(id, map[string]any{"label": "Verse"})
			before := ts.addSection(id, map[string]any{"label": "Chorus"})

			res := ts.Do(http.MethodPost, fmt.Sprintf("/api/songs/%d/sections", id),
				map[string]any{"label": "Bridge", "position": position})

			expectError(t, res, http.StatusBadRequest, "position must be between 0 and 2")
			if got := ts.getSong(id); !reflect.DeepEqual(got, before) {
				t.Errorf("song after rejected add = %+v, want it unchanged %+v", got, before)
			}
		})
	}
}

func TestAddingASectionToAnUnknownSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodPost, "/api/songs/999/sections", map[string]any{})

	expectStatus(t, res, http.StatusNotFound)
}

func TestSectionLabelsAreFreeTextAndOptional(t *testing.T) {
	ts := newTestServer(t)
	id := ts.createSong("Midnight Drive").ID

	ts.addSection(id, map[string]any{})
	ts.addSection(id, map[string]any{"label": "   "})
	got := ts.addSection(id, map[string]any{"label": "  Spoken intro (whispered) "})

	want := []string{"", "", "Spoken intro (whispered)"}
	if labels := arrangementLabels(got); !reflect.DeepEqual(labels, want) {
		t.Errorf("labels = %q, want %q", labels, want)
	}
}

func TestSectionLabelCanBeChangedAndCleared(t *testing.T) {
	ts := newTestServer(t)
	id := ts.createSong("Midnight Drive").ID
	before := ts.addSection(id, map[string]any{"label": "Verse"})
	path := fmt.Sprintf("/api/songs/%d/sections/%d", id, before.Sections[0].ID)

	got := ts.lyricSheetChange(http.MethodPatch, path, map[string]any{"label": " Hook "})

	if got.Sections[0].Label != "Hook" {
		t.Errorf("label = %q, want %q", got.Sections[0].Label, "Hook")
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}

	got = ts.lyricSheetChange(http.MethodPatch, path, map[string]any{"label": ""})

	if got.Sections[0].Label != "" {
		t.Errorf("label after clearing = %q, want none", got.Sections[0].Label)
	}
}

func TestChangingASectionOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.addSection(ts.createSong("Other").ID, map[string]any{"label": "Verse"})
	id := ts.createSong("Midnight Drive").ID

	res := ts.Do(http.MethodPatch, fmt.Sprintf("/api/songs/%d/sections/%d", id, other.Sections[0].ID),
		map[string]any{"label": "Hook"})

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); got.Sections[0].Label != "Verse" {
		t.Errorf("other song's label = %q, want it unchanged", got.Sections[0].Label)
	}
}

// lineTexts lists an Alternate's Line texts.
func lineTexts(a alternate) []string {
	out := []string{}
	for _, l := range a.Lines {
		out = append(out, l.Text)
	}
	return out
}

// lineIDs lists an Alternate's Line ids.
func lineIDs(a alternate) []int64 {
	out := []int64{}
	for _, l := range a.Lines {
		out = append(out, l.ID)
	}
	return out
}

func TestAlternateTextIsSplitIntoLines(t *testing.T) {
	cases := map[string]struct {
		text string
		want []string
	}{
		"empty":                  {"", []string{}},
		"one line":               {"City lights are calling", []string{"City lights are calling"}},
		"several lines":          {"City lights\nare calling\nme home", []string{"City lights", "are calling", "me home"}},
		"windows line endings":   {"City lights\r\nare calling\r\n", []string{"City lights", "are calling"}},
		"trailing blank lines":   {"City lights\n\n\n", []string{"City lights"}},
		"blank line in between":  {"City lights\n\nare calling", []string{"City lights", "", "are calling"}},
		"leading blank line":     {"\nCity lights", []string{"", "City lights"}},
		"spaces kept inside":     {"  City   lights  ", []string{"  City   lights  "}},
		"chords kept as written": {"Hel[Am]lo [F]", []string{"Hel[Am]lo [F]"}},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)
			id := ts.createSong("Midnight Drive").ID
			before := ts.addSection(id, map[string]any{"label": "Verse"})

			got := ts.setText(id, before.Sections[0].Alternates[0].ID, c.text)

			if texts := lineTexts(got.Sections[0].Alternates[0]); !reflect.DeepEqual(texts, c.want) {
				t.Errorf("lines = %q, want %q", texts, c.want)
			}
			if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
				t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
			}
			if read := ts.getSong(id); !reflect.DeepEqual(read, got) {
				t.Errorf("song read back = %+v, want %+v", read, got)
			}
		})
	}
}

func TestReplacingTextOfAnAlternateOfAnotherSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.addSection(ts.createSong("Other").ID, map[string]any{})
	id := ts.createSong("Midnight Drive").ID

	res := ts.Do(http.MethodPut,
		fmt.Sprintf("/api/songs/%d/alternates/%d/text", id, other.Sections[0].Alternates[0].ID),
		map[string]any{"text": "Not yours"})

	expectStatus(t, res, http.StatusNotFound)
	if got := ts.getSong(other.ID); !reflect.DeepEqual(got, other) {
		t.Errorf("other song = %+v, want it unchanged %+v", got, other)
	}
}

// verseWithLines returns a Song with one Section whose active Alternate has
// the given text, and that Alternate.
func (ts *testServer) verseWithLines(text string) (song, alternate) {
	ts.t.Helper()
	id := ts.createSong("Midnight Drive").ID
	s := ts.addSection(id, map[string]any{"label": "Verse"})
	s = ts.setText(id, s.Sections[0].Alternates[0].ID, text)
	return s, s.Sections[0].Alternates[0]
}

func TestLinesKeepTheirIdentityAcrossEdits(t *testing.T) {
	const original = "City lights\nare calling\nme home"
	// Each case gives the new text and, for each new Line, the index of the
	// original Line whose identity it keeps, or -1 for a new Line.
	cases := map[string]struct {
		text  string
		keeps []int
	}{
		"same text again":           {original, []int{0, 1, 2}},
		"line added before":         {"Late night\n" + original, []int{-1, 0, 1, 2}},
		"line added after":          {original + "\ntonight", []int{0, 1, 2, -1}},
		"line added in between":     {"City lights\nsoftly\nare calling\nme home", []int{0, -1, 1, 2}},
		"line edited in place":      {"City lights\nkeep calling\nme home", []int{0, 1, 2}},
		"first and last edited":     {"Neon lights\nare calling\nyou home", []int{0, 1, 2}},
		"line deleted":              {"City lights\nme home", []int{0, 2}},
		"line edited and one added": {"City lights\nkeep calling\nand calling\nme home", []int{0, 1, -1, 2}},
		"edit and unrelated delete": {"Neon lights\nare calling", []int{0, 1}},
		"everything replaced":       {"Different\nwords", []int{0, 1}},
		"everything removed":        {"", []int{}},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)
			before, alt := ts.verseWithLines(original)
			old := lineIDs(alt)

			got := ts.setText(before.ID, alt.ID, c.text)

			newIDs := lineIDs(got.Sections[0].Alternates[0])
			if len(newIDs) != len(c.keeps) {
				t.Fatalf("lines = %q, want %d lines", lineTexts(got.Sections[0].Alternates[0]), len(c.keeps))
			}
			seen := map[int64]bool{}
			for _, id := range old {
				seen[id] = true
			}
			for i, k := range c.keeps {
				switch {
				case k >= 0 && newIDs[i] != old[k]:
					t.Errorf("line %d id = %d, want it to keep original line %d's id %d", i, newIDs[i], k, old[k])
				case k < 0 && seen[newIDs[i]]:
					t.Errorf("line %d id = %d, want a new id", i, newIDs[i])
				}
				seen[newIDs[i]] = true
			}
		})
	}
}

func TestLinesAreUntouchedByChangesElsewhereInTheSong(t *testing.T) {
	ts := newTestServer(t)
	s, verse := ts.verseWithLines("City lights\nare calling")
	verseID := s.Sections[0].ID
	s = ts.addSection(s.ID, map[string]any{"label": "Chorus"})
	chorus := s.Sections[1]

	ts.setText(s.ID, chorus.Alternates[0].ID, "Drive, drive\nall night")
	ts.lyricSheetChange(http.MethodPatch, fmt.Sprintf("/api/songs/%d/sections/%d", s.ID, verseID),
		map[string]any{"label": "Verse 1"})
	got := ts.addSection(s.ID, map[string]any{"label": "Intro", "position": 0})

	if lines := got.Sections[0].Alternates[0].Lines; !reflect.DeepEqual(lines, verse.Lines) {
		t.Errorf("verse lines = %+v, want them unchanged %+v", lines, verse.Lines)
	}
}

// reorderPath is where a Song's Arrangement is reordered.
func reorderPath(songID int64) string {
	return fmt.Sprintf("/api/songs/%d/arrangement", songID)
}

// songWithSections creates a Song with one Section per Label, in order.
func (ts *testServer) songWithSections(labels ...string) song {
	ts.t.Helper()
	s := ts.createSong("Midnight Drive")
	for _, l := range labels {
		s = ts.addSection(s.ID, map[string]any{"label": l})
	}
	return s
}

func TestArrangementCanBeReorderedInOneOperation(t *testing.T) {
	ts := newTestServer(t)
	before := ts.songWithSections("Verse", "Chorus", "Bridge", "Outro")
	ids := before.Arrangement
	order := []int64{ids[3], ids[1], ids[0], ids[2]}

	got := ts.lyricSheetChange(http.MethodPut, reorderPath(before.ID), map[string]any{"sections": order})

	if !reflect.DeepEqual(got.Arrangement, order) {
		t.Errorf("arrangement = %v, want %v", got.Arrangement, order)
	}
	want := []string{"Outro", "Chorus", "Verse", "Bridge"}
	if labels := arrangementLabels(ts.getSong(before.ID)); !reflect.DeepEqual(labels, want) {
		t.Errorf("arrangement read back = %q, want %q", labels, want)
	}
	if !reflect.DeepEqual(got.Sections, before.Sections) {
		t.Errorf("sections = %+v, want them unchanged %+v", got.Sections, before.Sections)
	}
	if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
		t.Errorf("updatedAt = %s, want later than %s", got.UpdatedAt, before.UpdatedAt)
	}
}

func TestReorderingMustListEverySectionInTheArrangementOnce(t *testing.T) {
	// Each case builds the new order from the ids of the Song's Sections in
	// the Arrangement, one in its Scrapbook, and one from another Song.
	cases := map[string]func(ids []int64, scrap, elsewhere int64) []int64{
		"one missing":            func(ids []int64, _, _ int64) []int64 { return []int64{ids[1], ids[0]} },
		"one twice":              func(ids []int64, _, _ int64) []int64 { return []int64{ids[0], ids[1], ids[2], ids[1]} },
		"one instead of another": func(ids []int64, _, _ int64) []int64 { return []int64{ids[0], ids[0], ids[2]} },
		"unknown one":            func(ids []int64, _, _ int64) []int64 { return []int64{ids[0], ids[1], 999} },
		"another song's one":     func(ids []int64, _, elsewhere int64) []int64 { return []int64{ids[0], ids[1], elsewhere} },
		"a Scrapbook one":        func(ids []int64, scrap, _ int64) []int64 { return []int64{ids[0], ids[1], ids[2], scrap} },
		"none":                   func([]int64, int64, int64) []int64 { return []int64{} },
	}
	for name, reorder := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)
			other := ts.songWithSections("Elsewhere")
			before := ts.songWithSections("Verse", "Chorus", "Bridge")
			before = ts.addToScrapbook(before.ID, "Idea")
			order := reorder(before.Arrangement, before.Scrapbook[0], other.Arrangement[0])

			res := ts.Do(http.MethodPut, reorderPath(before.ID), map[string]any{"sections": order})

			expectError(t, res, http.StatusBadRequest, "the new order must list every Section in the Lyric Sheet exactly once")
			if got := ts.getSong(before.ID); !reflect.DeepEqual(got, before) {
				t.Errorf("song after rejected reorder = %+v, want it unchanged %+v", got, before)
			}
		})
	}
}
