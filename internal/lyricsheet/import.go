package lyricsheet

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"strings"
)

var (
	// The import screen asks for a title when it sees this message.
	errImportTitleRequired = invalid("title is required: add a {title: ...} line or give one")
	errNothingToImport     = invalid("there are no lyrics to import")
)

// ImportSong creates a new Song from pasted lyrics, plain text or ChordPro,
// with one Occurrence per group of Lines in the text. Repeated groups share
// one Section (see arrange). A title directive in the text names the Song;
// without one, title does.
func (s *Store) ImportSong(ctx context.Context, title, text string) (Song, error) {
	directiveTitle, sections := parseImport(text)
	if directiveTitle != "" {
		title = directiveTitle
	}
	if strings.TrimSpace(title) == "" {
		return Song{}, errImportTitleRequired
	}
	if len(sections) == 0 {
		return Song{}, errNothingToImport
	}

	// Not s.change: that changes a Song that already exists.
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Song{}, err
	}
	defer tx.Rollback()
	songID, err := insertSong(ctx, tx, title)
	if err != nil {
		return Song{}, err
	}
	sections, arrangement := arrange(sections)
	sectionIDs := make([]int64, len(sections))
	for i, sec := range sections {
		sectionID, alternateID, err := insertSection(ctx, tx, songID, sec.label)
		if err != nil {
			return Song{}, err
		}
		sectionIDs[i] = sectionID
		for pos, line := range sec.lines {
			if _, err := tx.ExecContext(ctx, `INSERT INTO lines (alternate_id, position, text) VALUES (?, ?, ?)`,
				alternateID, pos, line); err != nil {
				return Song{}, fmt.Errorf("adding line: %w", err)
			}
		}
	}
	for pos, i := range arrangement {
		if err := insertOccurrence(ctx, tx, songID, sectionIDs[i], pos); err != nil {
			return Song{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, songID)
}

// importedSection is one Section read from pasted text.
type importedSection struct {
	label string
	lines []string
}

// sectionDirectives maps the ChordPro directives that start a Section to the
// Label it gets when the directive doesn't name one.
var sectionDirectives = map[string]string{
	"start_of_chorus": "Chorus", "soc": "Chorus",
	"start_of_verse": "Verse", "sov": "Verse",
	"start_of_bridge": "Bridge", "sob": "Bridge",
}

// endDirectives are the ChordPro directives that end a Section.
var endDirectives = map[string]bool{
	"end_of_chorus": true, "eoc": true,
	"end_of_verse": true, "eov": true,
	"end_of_bridge": true, "eob": true,
}

// parseImport reads pasted text into the Song title, if a directive gives
// one, and Sections, one per group of Lines in the text. Blank lines and end
// directives end a Section, and a heading or start directive starts one with
// that Label. A heading with no Lines under it is a Section with no Lines.
// Other directives never become Lines.
func parseImport(text string) (title string, sections []importedSection) {
	var cur importedSection
	end := func() {
		if cur.label != "" || len(cur.lines) > 0 {
			sections = append(sections, cur)
		}
		cur = importedSection{}
	}
	for _, line := range splitLines(text) {
		if strings.TrimSpace(line) == "" {
			end()
			continue
		}
		if name, value, ok := directive(line); ok {
			switch {
			case name == "title" || name == "t":
				title = value
			case sectionDirectives[name] != "":
				end()
				cur = importedSection{label: cmp.Or(value, sectionDirectives[name])}
			case endDirectives[name]:
				end()
			}
			continue
		}
		if label, ok := heading(line); ok {
			end()
			cur = importedSection{label: label}
			continue
		}
		cur.lines = append(cur.lines, line)
	}
	end()
	return title, sections
}

// arrange lays imported Sections out as a Song. It returns the distinct
// Sections and, for each Occurrence in order, the index of its Section.
//
// A Section with Lines is an Occurrence of the most recent earlier Section
// with the same Lines (see sameAs), which takes its Label if it had none.
// A heading with no Lines is an Occurrence of the most recent earlier
// Section with that Label, ignoring case, or of a new Section without Lines
// if there is none.
func arrange(imported []importedSection) (sections []importedSection, arrangement []int) {
	for _, sec := range imported {
		match := func(earlier importedSection) bool { return earlier.sameAs(sec) }
		if len(sec.lines) == 0 {
			match = func(earlier importedSection) bool { return strings.EqualFold(earlier.label, sec.label) }
		}
		i := -1
		for _, earlier := range slices.Backward(arrangement) {
			if match(sections[earlier]) {
				i = earlier
				break
			}
		}
		if i < 0 {
			i = len(sections)
			sections = append(sections, sec)
		} else if sections[i].label == "" {
			sections[i].label = sec.label
		}
		arrangement = append(arrangement, i)
	}
	return sections, arrangement
}

// sameAs reports whether two imported Sections with Lines are the same
// Section: their Lines match once trimmed at both ends, and they don't have
// different Labels.
func (a importedSection) sameAs(b importedSection) bool {
	if len(a.lines) == 0 {
		return false
	}
	if a.label != "" && b.label != "" && !strings.EqualFold(a.label, b.label) {
		return false
	}
	return slices.EqualFunc(a.lines, b.lines, func(x, y string) bool {
		return strings.TrimSpace(x) == strings.TrimSpace(y)
	})
}

// directive reads a ChordPro directive line such as "{title: Midnight Drive}"
// into its lower-cased name and its value.
func directive(line string) (name, value string, ok bool) {
	line = strings.TrimSpace(line)
	inner, ok := strings.CutPrefix(line, "{")
	if !ok {
		return "", "", false
	}
	if inner, ok = strings.CutSuffix(inner, "}"); !ok {
		return "", "", false
	}
	name, value, _ = strings.Cut(inner, ":")
	return strings.ToLower(strings.TrimSpace(name)), strings.TrimSpace(value), true
}

// heading reads a line that names the next Section: "Chorus:", with nothing
// after the colon, or "[Chorus]", whose content isn't a chord name.
func heading(line string) (label string, ok bool) {
	line = strings.TrimSpace(line)
	if label, ok := strings.CutSuffix(line, ":"); ok {
		label = strings.TrimSpace(label)
		if _, chords := parseLine(label); label == "" || len(chords) > 0 {
			return "", false
		}
		return label, true
	}
	inner, ok := strings.CutPrefix(line, "[")
	if !ok {
		return "", false
	}
	inner, ok = strings.CutSuffix(inner, "]")
	inner = strings.TrimSpace(inner)
	if !ok || inner == "" || strings.ContainsAny(inner, "[]") || chordName.MatchString(inner) {
		return "", false
	}
	return inner, true
}
