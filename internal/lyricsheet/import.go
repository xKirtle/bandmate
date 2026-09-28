package lyricsheet

import (
	"cmp"
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
)

var (
	// The import screen asks for a title when it sees this message.
	errImportTitleRequired = invalid("title is required: add a {title: ...} line or give one")
	errNothingToImport     = invalid("there are no lyrics to import")
)

// ImportSong creates a new Song from pasted lyrics, plain text or ChordPro,
// with one Occurrence per Section the text marks (see parseImport). A
// Section repeated in the text is one Section (see arrange). A title
// directive in the text names the Song; without one, title does. Other
// directives fill in the Song's Details. Timestamps in the text become
// Cues, each Occurrence keeping its own.
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
	if _, err := tx.ExecContext(ctx, `UPDATE songs SET song_key = ?, bpm = ?, capo = ?, tuning = ?, notes = ? WHERE id = ?`,
		sheet.key, sheet.bpm, sheet.capo, sheet.tuning, strings.Join(sheet.notes, "\n"), songID); err != nil {
		return Song{}, fmt.Errorf("setting details: %w", err)
	}
	distinct, arrangement := arrange(sheet.sections)
	sectionIDs := make([]int64, len(distinct))
	lineIDs := make([][]int64, len(distinct))
	for i, sec := range distinct {
		sectionID, alternateID, err := insertSection(ctx, tx, songID, sec.label)
		if err != nil {
			return Song{}, err
		}
		sectionIDs[i] = sectionID
		for pos, line := range sec.lines {
			lineID, err := insert(ctx, tx, `INSERT INTO lines (alternate_id, position, text) VALUES (?, ?, ?)`,
				alternateID, pos, line.text)
			if err != nil {
				return Song{}, fmt.Errorf("adding line: %w", err)
			}
			lineIDs[i] = append(lineIDs[i], lineID)
		}
	}
	for pos, section := range arrangement {
		occurrenceID, err := insertOccurrence(ctx, tx, songID, sectionIDs[section], pos)
		if err != nil {
			return Song{}, err
		}
		// The Occurrence's own Lines match its Section's one for one (see
		// sameAs), but have their own Cues. They're written directly, as
		// parseImport already gave blank Lines none (see writeLineCue).
		occ := sheet.sections[pos]
		if occ.cue != nil {
			if err := writeOccurrenceCue(ctx, tx, songID, occurrenceID, sql.NullInt64{Int64: *occ.cue, Valid: true}); err != nil {
				return Song{}, err
			}
		}
		for i, line := range occ.lines {
			if line.cue == nil {
				continue
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO line_cues (occurrence_id, line_id, cue_ms) VALUES (?, ?, ?)`,
				occurrenceID, lineIDs[section][i], *line.cue); err != nil {
				return Song{}, fmt.Errorf("adding line cue: %w", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, songID)
}

// importedSheet is what pasted text says about the Song to create.
type importedSheet struct {
	title string // from a title directive, if any
	// The Song's Details, from their directives; unset if there are none.
	key, tuning string
	bpm, capo   *int
	notes       []string // one line per notes directive, in order
	sections    []importedSection
}

// importedSection is one Section read from pasted text, as it appears
// there: one Occurrence, until arrange finds the Sections it shares.
type importedSection struct {
	label string
	lines []importedLine
	// cue is the Occurrence's Cue in milliseconds, from a timestamp on its
	// heading or first Line, or nil for none.
	cue *int64
	// cuePasteLine is the paste line of the heading or Line that gave cue,
	// or 0.
	cuePasteLine int
}

// importedLine is one Line read from pasted text, with where it came from.
type importedLine struct {
	text      string // without its timestamp
	pasteLine int    // its line number in the paste, from 1
	cue       *int64 // its Cue in milliseconds, from its timestamp, or nil
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

// detailDirectives are the ChordPro directives that each give one Detail
// of the Song, the title among them, so a paste may give it only once.
var detailDirectives = map[string]string{
	"title": "title", "t": "title", "key": "key", "bpm": "bpm", "tempo": "bpm", "capo": "capo", "tuning": "tuning",
}

// recognised reports whether import understands the directive name. It
// keeps any other directive as a Line, as written.
func recognised(name string) bool {
	_, detail := detailDirectives[name]
	_, section := sectionDirectives[name]
	return detail || section || name == "notes" || name == "offset"
}

// parseImport reads pasted text into the Song's title and Details, as far
// as directives give them, and Sections, or rejects it with an error naming the line at fault
// (see invalidPasteLine). Only what the text says starts a Section: a
// heading or start directive starts one with that Label, and an end
// directive ends one, so the Lines after it start one without a Label.
// Blank lines are blank Lines, except at a Section's start or end, where
// they're dropped. A heading with no Lines under it is a Section with no
// Lines. Each Detail's directive may appear once, and each notes directive
// adds a line to the notes. Directives import doesn't recognise are Lines
// as written.
//
// A timestamp at the start of a line (see cutTimestamp) cues the Line in
// its Occurrence and, on its first Line, the Occurrence too. On a heading,
// it cues only the Occurrence, and must agree with its first Line's. A
// timestamp alone is a blank line, with no Cue, and a directive can't have
// one. An offset directive, which may appear once, anywhere, shifts every
// Cue by its time (see shiftCues).
func parseImport(text string) (importedSheet, error) {
	var sheet importedSheet
	given := map[string]int{} // the paste line that gave each Detail, and the offset
	var offset int64          // in milliseconds
	var cur importedSection
	end := func() {
		for len(cur.lines) > 0 && blank(cur.lines[len(cur.lines)-1].text) {
			cur.lines = cur.lines[:len(cur.lines)-1]
		}
		if cur.label != "" || len(cur.lines) > 0 {
			sheet.sections = append(sheet.sections, cur)
		}
		cur = importedSection{}
	}
	for i, line := range splitLines(text) {
		line, cue, err := cutTimestamp(line, i+1)
		if err != nil {
			return importedSheet{}, err
		}
		if blank(line) {
			cue = nil
		}
		if _, _, ok := directive(line); ok && cue != nil {
			return importedSheet{}, invalidPasteLine(i+1, "a directive can't have a timestamp")
		}
		if blank(line) && len(cur.lines) == 0 {
			continue
		}
		if name, value, ok := directive(line); ok && recognised(name) {
			if detail, ok := detailDirectives[name]; ok {
				if earlier, ok := given[detail]; ok {
					return importedSheet{}, invalidPasteLine(i+1, "the %s is already given on line %d", detail, earlier)
				}
				given[detail] = i + 1
				switch detail {
				case "title":
					sheet.title = value
				case "key":
					sheet.key = value
				case "tuning":
					sheet.tuning = value
				case "bpm":
					if sheet.bpm, ok = wholeNumber(value, 1, 999); !ok {
						return importedSheet{}, invalidPasteLine(i+1, "%s must be a whole number between 1 and 999", name)
					}
				case "capo":
					if sheet.capo, ok = wholeNumber(value, 0, 24); !ok {
						return importedSheet{}, invalidPasteLine(i+1, "capo must be a whole number between 0 and 24")
					}
				}
			}
			if name == "notes" {
				sheet.notes = append(sheet.notes, value)
			}
			if name == "offset" {
				if earlier, ok := given[name]; ok {
					return importedSheet{}, invalidPasteLine(i+1, "the offset is already given on line %d", earlier)
				}
				given[name] = i + 1
				if offset, err = offsetMillis(value); err != nil {
					return importedSheet{}, invalidPasteLine(i+1, "%s", err)
				}
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
			cur = importedSection{label: label, cue: cue}
			if cue != nil {
				cur.cuePasteLine = i + 1
			}
			continue
		}
		// Blank lines are dropped at a Section's start, so this is its first Line.
		if len(cur.lines) == 0 && cue != nil {
			if cur.cue != nil && *cur.cue != *cue {
				return importedSheet{}, invalidPasteLine(i+1, "its timestamp differs from the heading's on line %d", cur.cuePasteLine)
			}
			if cur.cue == nil {
				cur.cuePasteLine = i + 1
			}
			cur.cue = cue
		}
		cur.lines = append(cur.lines, importedLine{text: line, pasteLine: i + 1, cue: cue})
	}
	end()
	if err := sheet.shiftCues(offset); err != nil {
		return importedSheet{}, err
	}
	return sheet, nil
}

// shiftCues moves every Cue in the sheet by ms, as the offset directive
// does, or rejects the first that would stop being a Cue, naming its
// paste line.
func (sheet *importedSheet) shiftCues(ms int64) error {
	if ms == 0 {
		return nil
	}
	// Each shifted Cue is new, as an Occurrence's Cue may be its first
	// Line's too, and must move only once.
	shift := func(cue **int64, pasteLine int) error {
		if *cue == nil {
			return nil
		}
		shifted, err := cueMillis(float64(**cue+ms) / 1000)
		if err != nil {
			return invalidPasteLine(pasteLine, "%s", err)
		}
		*cue = &shifted
		return nil
	}
	for i := range sheet.sections {
		sec := &sheet.sections[i]
		if err := shift(&sec.cue, sec.cuePasteLine); err != nil {
			return err
		}
		for j := range sec.lines {
			if err := shift(&sec.lines[j].cue, sec.lines[j].pasteLine); err != nil {
				return err
			}
		}
	}
	return nil
}

// offsetText is a time as a Cue is typed, seconds ("1.5") or minutes and
// two digits of seconds ("0:02"), with an optional sign.
var offsetText = regexp.MustCompile(`^([+-]?)(?:(\d+):([0-5]\d(?:\.\d+)?)|(\d+(?:\.\d+)?))$`)

// offsetMillis reads an offset directive's value into milliseconds,
// positive for later.
func offsetMillis(value string) (int64, error) {
	m := offsetText.FindStringSubmatch(value)
	if m == nil {
		return 0, invalid("the offset must be a time in seconds, like 1.5 or -0:02")
	}
	var seconds float64
	if m[4] != "" {
		seconds, _ = strconv.ParseFloat(m[4], 64)
	} else {
		minutes, _ := strconv.ParseFloat(m[2], 64)
		secs, _ := strconv.ParseFloat(m[3], 64)
		seconds = minutes*60 + secs
	}
	if seconds > maxCue {
		return 0, invalid("the offset can't be more than 24 hours")
	}
	if m[1] == "-" {
		seconds = -seconds
	}
	return millis(seconds), nil
}

var (
	// timestamp is an LRC timestamp: minutes, two digits of seconds and
	// any decimals, in brackets.
	timestamp = regexp.MustCompile(`^\[(\d+):([0-5]\d(?:\.\d+)?)\]`)
	// timestampLike is anything in brackets that looks meant as one: digits,
	// dots and commas around a colon.
	timestampLike = regexp.MustCompile(`^\[[\d.,]*:[\d:.,]*\]`)
)

// cutTimestamp cuts a timestamp such as "[1:02.34]" off the start of a
// line, with the spaces around it, and returns the rest of the line and
// the time in milliseconds, rounded as a typed Cue is. A line without one
// comes back as it is, with no time. Something meant as a timestamp that
// isn't one, one that isn't a Cue, or a second timestamp rejects the line,
// counted from 1.
func cutTimestamp(line string, pasteLine int) (rest string, ms *int64, err error) {
	trimmed := strings.TrimLeftFunc(line, unicode.IsSpace)
	m := timestamp.FindStringSubmatch(trimmed)
	if m == nil {
		if timestampLike.MatchString(trimmed) {
			return "", nil, invalidPasteLine(pasteLine, "a timestamp must be minutes and two digits of seconds, like [1:02] or [1:02.34]")
		}
		return line, nil, nil
	}
	rest = strings.TrimLeftFunc(trimmed[len(m[0]):], unicode.IsSpace)
	if timestampLike.MatchString(rest) {
		return "", nil, invalidPasteLine(pasteLine, "a line can have only one timestamp")
	}
	minutes, _ := strconv.ParseFloat(m[1], 64)
	seconds, _ := strconv.ParseFloat(m[2], 64)
	cue, err := cueMillis(minutes*60 + seconds)
	if err != nil {
		return "", nil, invalidPasteLine(pasteLine, "%s", err)
	}
	return rest, &cue, nil
}

// wholeNumber reads value as a whole number from lo to hi, as the Details
// form takes BPM and capo.
func wholeNumber(value string, lo, hi int) (*int, bool) {
	n, err := strconv.Atoi(value)
	if err != nil || n < lo || n > hi {
		return nil, false
	}
	return &n, true
}

// arrange lays imported Sections out as a Song. It returns the distinct
// Sections and, for each Occurrence in order, the index of its Section.
//
// A Section with Lines is an Occurrence of the most recent earlier Section
// with the same Label and Lines (see sameAs). A heading with no Lines is an Occurrence of the most recent earlier
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
		}
		arrangement = append(arrangement, i)
	}
	return sections, arrangement
}

// sameAs reports whether two imported Sections are the same Section: they
// have Lines, the same Label, ignoring case, and Lines that match once
// trimmed at both ends. Sections without a Label are never the same, as the
// text didn't mark them as one.
func (a importedSection) sameAs(b importedSection) bool {
	if len(a.lines) == 0 || len(b.lines) == 0 || a.label == "" || !strings.EqualFold(a.label, b.label) {
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
