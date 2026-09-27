package lyricsheet

import (
	"context"
	"fmt"
	"strings"
)

var errImportTitleRequired = invalid("title is required: add a {title: ...} line or give one")

// ImportSong creates a new Song from pasted lyrics, plain text or ChordPro,
// with one Section and Occurrence per block of Lines in the text. A title
// directive in the text names the Song; without one, title does.
func (s *Store) ImportSong(ctx context.Context, title, text string) (Song, error) {
	directiveTitle, sections := parseImport(text)
	if directiveTitle != "" {
		title = directiveTitle
	}
	if strings.TrimSpace(title) == "" {
		return Song{}, errImportTitleRequired
	}
	if len(sections) == 0 {
		return Song{}, invalid("there are no lyrics to import")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Song{}, err
	}
	defer tx.Rollback()
	songID, err := insertSong(ctx, tx, title)
	if err != nil {
		return Song{}, err
	}
	for pos, sec := range sections {
		sectionID, err := insertSection(ctx, tx, songID, sec.label)
		if err != nil {
			return Song{}, err
		}
		if err := insertOccurrence(ctx, tx, songID, sectionID, pos); err != nil {
			return Song{}, err
		}
		for i, line := range sec.lines {
			if _, err := tx.ExecContext(ctx, `INSERT INTO lines (alternate_id, position, text)
				SELECT id, ?, ? FROM alternates WHERE section_id = ?`, i, line, sectionID); err != nil {
				return Song{}, fmt.Errorf("adding line: %w", err)
			}
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

// parseImport reads pasted text into the Song title, if a directive gives
// one, and Sections. Blank lines end a Section, and a heading starts one with
// that Label. A heading with no Lines under it is an empty Section. Other
// directives never become Lines.
func parseImport(text string) (title string, sections []importedSection) {
	var cur importedSection
	end := func() {
		if cur.label != "" || len(cur.lines) > 0 {
			sections = append(sections, cur)
		}
		cur = importedSection{}
	}
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			end()
			continue
		}
		if name, value, ok := directive(line); ok {
			if name == "title" || name == "t" {
				title = value
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
		if _, chords := parseLine(label); len(chords) == 0 && strings.TrimSpace(label) != "" {
			return strings.TrimSpace(label), true
		}
		return "", false
	}
	inner, ok := strings.CutPrefix(line, "[")
	if !ok {
		return "", false
	}
	inner, ok = strings.CutSuffix(inner, "]")
	if !ok || strings.ContainsAny(inner, "[]") || strings.TrimSpace(inner) == "" || chordName.MatchString(inner) {
		return "", false
	}
	return strings.TrimSpace(inner), true
}
