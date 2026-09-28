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
	sheet, err := parseImport(text)
	if err != nil {
		return Song{}, err
	}
	if sheet.title != "" {
		title = sheet.title
	}
	if strings.TrimSpace(title) == "" {
		return Song{}, errImportTitleRequired
	}
	if len(sheet.sections) == 0 {
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
	distinct, arrangement := arrange(sheet.sections)
	sectionIDs := make([]int64, len(distinct))
	for i, sec := range distinct {
		sectionID, alternateID, err := insertSection(ctx, tx, songID, sec.label)
		if err != nil {
			return Song{}, err
		}
		sectionIDs[i] = sectionID
		for pos, line := range sec.lines {
			if _, err := tx.ExecContext(ctx, `INSERT INTO lines (alternate_id, position, text) VALUES (?, ?, ?)`,
				alternateID, pos, line.text); err != nil {
				return Song{}, fmt.Errorf("adding line: %w", err)
			}
		}
	}
	for pos, section := range arrangement {
		if err := insertOccurrence(ctx, tx, songID, sectionIDs[section], pos); err != nil {
			return Song{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, songID)
}

// importedSheet is what pasted text says about the Song to create.
type importedSheet struct {
	title    string // from a title directive, if any
	sections []importedSection
}

// importedSection is one Section read from pasted text, as it appears
// there: one Occurrence, until arrange finds the Sections it shares.
type importedSection struct {
	label string
	lines []importedLine
}

// importedLine is one Line read from pasted text, with where it came from.
type importedLine struct {
	text      string
	pasteLine int // its line number in the paste, from 1
}

// invalidPasteLine rejects a paste over one of its lines, counted from 1,
// naming it so the user can find it.
func invalidPasteLine(pasteLine int, format string, args ...any) error {
	return invalid(fmt.Sprintf("line %d: ", pasteLine) + fmt.Sprintf(format, args...))
}

// sectionDirective is what a ChordPro section directive does: start a
// Section, with label unless the directive names one, or end it.
type sectionDirective struct {
	starts bool
	label  string
}

// sectionDirectives are the ChordPro directives that start or end a Section.
var sectionDirectives = map[string]sectionDirective{
	"start_of_chorus": {true, "Chorus"}, "soc": {true, "Chorus"}, "end_of_chorus": {}, "eoc": {},
	"start_of_verse": {true, "Verse"}, "sov": {true, "Verse"}, "end_of_verse": {}, "eov": {},
	"start_of_bridge": {true, "Bridge"}, "sob": {true, "Bridge"}, "end_of_bridge": {}, "eob": {},
}

// parseImport reads pasted text into the Song title, if a directive gives
// one, and Sections, one per group of Lines in the text, or rejects it with
// an error naming the line at fault (see invalidPasteLine). Blank lines and
// end directives end a Section, and a heading or start directive starts one
// with that Label. A heading with no Lines under it is a Section with no
// Lines. Other directives never become Lines.
func parseImport(text string) (importedSheet, error) {
	var sheet importedSheet
	var cur importedSection
	end := func() {
		if cur.label != "" || len(cur.lines) > 0 {
			sheet.sections = append(sheet.sections, cur)
		}
		cur = importedSection{}
	}
	for i, line := range splitLines(text) {
		if strings.TrimSpace(line) == "" {
			end()
			continue
		}
		if name, value, ok := directive(line); ok {
			if name == "title" || name == "t" {
				sheet.title = value
			}
			if d, ok := sectionDirectives[name]; ok {
				end()
				if d.starts {
					cur = importedSection{label: cmp.Or(value, d.label)}
				}
			}
			continue
		}
		if label, ok := heading(line); ok {
			end()
			cur = importedSection{label: label}
			continue
		}
		cur.lines = append(cur.lines, importedLine{text: line, pasteLine: i + 1})
	}
	end()
	return sheet, nil
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

// sameAs reports whether two imported Sections are the same Section: they
// have Lines, their Lines match once trimmed at both ends, and they don't
// have different Labels.
func (a importedSection) sameAs(b importedSection) bool {
	if len(a.lines) == 0 || len(b.lines) == 0 {
		return false
	}
	if a.label != "" && b.label != "" && !strings.EqualFold(a.label, b.label) {
		return false
	}
	return slices.EqualFunc(a.lines, b.lines, func(x, y importedLine) bool {
		return strings.TrimSpace(x.text) == strings.TrimSpace(y.text)
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
