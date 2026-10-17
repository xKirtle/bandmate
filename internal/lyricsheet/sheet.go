package lyricsheet

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// LyricSheet is the written side of a Song: its Sections laid out by the
// Arrangement.
type LyricSheet struct {
	// Arrangement lists the ids of the Sections in the Lyric Sheet, in order.
	// Each appears at most once (ADR 0010).
	Arrangement []int64 `json:"arrangement"`
	// Sections holds every Section of the Song, in the Arrangement or not.
	Sections []Section `json:"sections"`
	// Scrapbook lists the ids of the Sections not in the Arrangement.
	Scrapbook []int64 `json:"scrapbook"`
}

// Section is a block of Lines with an optional Label.
type Section struct {
	ID int64 `json:"id"`
	// Label is free text; "" means no Label.
	Label string `json:"label"`
	// Alternates are in the order they were created; exactly one is Active.
	Alternates []Alternate `json:"alternates"`
}

// Alternate is one competing version of a Section's Lines.
type Alternate struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
	Lines  []Line `json:"lines"`
}

// Line is one line of an Alternate. Its ID survives edits to its text.
type Line struct {
	ID int64 `json:"id"`
	// Text is the Line as written, with Chords inline in ChordPro style
	// ("Hel[Am]lo"). Lyrics and Chords are Text parsed.
	Text   string  `json:"text"`
	Lyrics string  `json:"lyrics"`
	Chords []Chord `json:"chords"`
	// ChordLine means the Line holds only Chords, e.g. for an intro or solo.
	ChordLine bool `json:"chordLine"`
	// Cue is when the Line is sung on the Timeline, in seconds to the
	// millisecond; nil means none. A Section has no Cue of its own: it
	// starts where its first Line is cued (ADR 0009). The Cue of a Line of
	// an inactive Alternate lies dormant (ADR 0007).
	Cue *float64 `json:"cue"`
}

// newLine builds a Line from its stored text and Cue.
func newLine(id int64, text string, cueMs sql.NullInt64) Line {
	lyrics, chords := parseLine(text)
	line := Line{ID: id, Text: text, Lyrics: lyrics, Chords: chords, ChordLine: isChordLine(lyrics, chords)}
	if cueMs.Valid {
		cue := float64(cueMs.Int64) / 1000
		line.Cue = &cue
	}
	return line
}

// loadLyricSheet reads a Song's whole Lyric Sheet through q.
func loadLyricSheet(ctx context.Context, q domain.Queryer, songID int64) (LyricSheet, error) {
	sheet := LyricSheet{Arrangement: []int64{}, Sections: []Section{}, Scrapbook: []int64{}}
	sectionAt := map[int64]int{}
	type place struct{ section, alternate int }
	alternateAt := map[int64]place{}

	// Where each Section is in the Arrangement, or else in the Scrapbook.
	arrangementAt := map[int64]int64{}
	scrapbookAt := map[int64]int64{}
	err := query(ctx, q, `SELECT id, label, position, scrapbook_position FROM sections WHERE song_id = ? ORDER BY id`,
		[]any{songID}, func(rows *sql.Rows) error {
			sec := Section{Alternates: []Alternate{}}
			var pos sql.NullInt64
			var at int64
			if err := rows.Scan(&sec.ID, &sec.Label, &pos, &at); err != nil {
				return err
			}
			if pos.Valid {
				arrangementAt[sec.ID] = pos.Int64
				sheet.Arrangement = append(sheet.Arrangement, sec.ID)
			} else {
				scrapbookAt[sec.ID] = at
				sheet.Scrapbook = append(sheet.Scrapbook, sec.ID)
			}
			sectionAt[sec.ID] = len(sheet.Sections)
			sheet.Sections = append(sheet.Sections, sec)
			return nil
		})
	if err != nil {
		return LyricSheet{}, fmt.Errorf("reading sections: %w", err)
	}

	err = query(ctx, q, `SELECT a.id, a.section_id, a.name, a.active
		FROM alternates a JOIN sections s ON s.id = a.section_id
		WHERE s.song_id = ? ORDER BY a.id`,
		[]any{songID}, func(rows *sql.Rows) error {
			alt := Alternate{Lines: []Line{}}
			var sectionID int64
			if err := rows.Scan(&alt.ID, &sectionID, &alt.Name, &alt.Active); err != nil {
				return err
			}
			sec := &sheet.Sections[sectionAt[sectionID]]
			alternateAt[alt.ID] = place{sectionAt[sectionID], len(sec.Alternates)}
			sec.Alternates = append(sec.Alternates, alt)
			return nil
		})
	if err != nil {
		return LyricSheet{}, fmt.Errorf("reading alternates: %w", err)
	}

	err = query(ctx, q, `SELECT l.id, l.alternate_id, l.text, l.cue_ms
		FROM lines l JOIN alternates a ON a.id = l.alternate_id JOIN sections s ON s.id = a.section_id
		WHERE s.song_id = ? ORDER BY l.alternate_id, l.position`,
		[]any{songID}, func(rows *sql.Rows) error {
			var id, alternateID int64
			var text string
			var cueMs sql.NullInt64
			if err := rows.Scan(&id, &alternateID, &text, &cueMs); err != nil {
				return err
			}
			p := alternateAt[alternateID]
			alt := &sheet.Sections[p.section].Alternates[p.alternate]
			alt.Lines = append(alt.Lines, newLine(id, text, cueMs))
			return nil
		})
	if err != nil {
		return LyricSheet{}, fmt.Errorf("reading lines: %w", err)
	}

	slices.SortStableFunc(sheet.Arrangement, func(a, b int64) int {
		return cmp.Compare(arrangementAt[a], arrangementAt[b])
	})
	slices.SortStableFunc(sheet.Scrapbook, func(a, b int64) int {
		return cmp.Compare(scrapbookAt[a], scrapbookAt[b])
	})
	return sheet, nil
}

// query runs a query and calls row for each result row.
func query(ctx context.Context, q domain.Queryer, stmt string, args []any, row func(*sql.Rows) error) error {
	rows, err := q.QueryContext(ctx, stmt, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := row(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

// change runs one change on a Song through songversion.Change and returns
// the Song as committed. If the Song is no longer at the version the change
// was based on, or fn fails, nothing changes.
func (s *Store) change(ctx context.Context, songID int64, based songversion.Version, fn func(tx *sql.Tx) error) (Song, error) {
	return s.changeWithFiles(ctx, songID, based, func(tx *sql.Tx, _ *audio.FileChanges) error {
		return fn(tx)
	})
}

// changeWithFiles is change for a change with files to keep, link or
// remove, which fn adds to changes.
func (s *Store) changeWithFiles(ctx context.Context, songID int64, based songversion.Version,
	fn func(tx *sql.Tx, changes *audio.FileChanges) error) (Song, error) {
	if err := songversion.Change(ctx, s.db, songID, based, fn); err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, songID)
}

// changeSheetWith is changeSheet for a change made as a pure change to the
// sheet, edit, which editSheet checks and writes.
func (s *Store) changeSheetWith(ctx context.Context, songID int64, based songversion.Version,
	edit func(sheet LyricSheet, ids *ids) (LyricSheet, error)) (Song, error) {
	return s.changeSheet(ctx, songID, based, func(tx *sql.Tx) error {
		return editSheet(ctx, tx, songID, edit)
	})
}

// AddSection creates a Section with the given Label and its first (active)
// Alternate at position in the Arrangement. A nil position adds it at the
// end.
func (s *Store) AddSection(ctx context.Context, songID int64, based songversion.Version, label string, position *int) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, ids *ids) (LyricSheet, error) {
		return addSection(sheet, ids, label, position)
	})
}

// addSection is AddSection's change to the sheet.
func addSection(sheet LyricSheet, ids *ids, label string, position *int) (LyricSheet, error) {
	sec := newSection(ids, label)
	arrangement, err := placeAt(sheet.Arrangement, sec.ID, position)
	if err != nil {
		return LyricSheet{}, err
	}
	sheet.Arrangement = arrangement
	sheet.Sections = append(sheet.Sections, sec)
	return sheet, nil
}

// newSection is a new Section with the given Label and its first, active,
// Alternate, with no Lines.
func newSection(ids *ids, label string) Section {
	return Section{ID: ids.section(), Label: cleanLabel(label),
		Alternates: []Alternate{{ID: ids.alternate(), Active: true, Lines: []Line{}}}}
}

// placeAt is an Arrangement with a Section not in it put at position, the
// ones from there on moving down by one. A nil position puts it at the end.
func placeAt(arrangement []int64, sectionID int64, position *int) ([]int64, error) {
	pos := len(arrangement)
	if position != nil {
		if *position < 0 || *position > len(arrangement) {
			return nil, domain.Invalid(fmt.Sprintf("position must be between 0 and %d", len(arrangement)))
		}
		pos = *position
	}
	return slices.Insert(arrangement, pos, sectionID), nil
}

// AddToScrapbook creates a Section with the given Label and its first
// (active) Alternate, outside the Arrangement, so it starts in the Scrapbook.
func (s *Store) AddToScrapbook(ctx context.Context, songID int64, based songversion.Version, label string) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, ids *ids) (LyricSheet, error) {
		return addToScrapbook(sheet, ids, label)
	})
}

// addToScrapbook is AddToScrapbook's change to the sheet.
func addToScrapbook(sheet LyricSheet, ids *ids, label string) (LyricSheet, error) {
	sec := newSection(ids, label)
	sheet.Scrapbook = append(sheet.Scrapbook, sec.ID)
	sheet.Sections = append(sheet.Sections, sec)
	return sheet, nil
}

// toScrapbookEnd puts a Section coming into the Scrapbook at its end.
func toScrapbookEnd(ctx context.Context, tx *sql.Tx, songID, sectionID int64) error {
	if _, err := tx.ExecContext(ctx, `UPDATE sections SET scrapbook_position =
		(SELECT COALESCE(MAX(scrapbook_position), 0) + 1 FROM sections WHERE song_id = ?) WHERE id = ?`,
		songID, sectionID); err != nil {
		return fmt.Errorf("putting section at end of scrapbook: %w", err)
	}
	return nil
}

// DeleteSection deletes a Section in the Scrapbook, with its Alternates and
// Lines, having taken a Snapshot naming it first. A Section still in the
// Arrangement can't be deleted.
func (s *Store) DeleteSection(ctx context.Context, songID int64, based songversion.Version, sectionID int64) (Song, error) {
	return s.changeBefore(ctx, songID, based, BeforeDeleting, func(tx *sql.Tx) (string, func() error, error) {
		sheet, err := loadLyricSheet(ctx, tx, songID)
		if err != nil {
			return "", nil, err
		}
		name := ""
		if sec, err := sheetSection(sheet, sectionID); err == nil {
			name = sectionName(*sec)
		}
		// A refusal comes before the Snapshot is taken.
		if _, err := deleteSection(sheet, sectionID); err != nil {
			return "", nil, err
		}
		return name, func() error {
			return editSheet(ctx, tx, songID, func(sheet LyricSheet, _ *ids) (LyricSheet, error) {
				return deleteSection(sheet, sectionID)
			})
		}, nil
	})
}

// deleteSection is DeleteSection's change to the sheet.
func deleteSection(sheet LyricSheet, sectionID int64) (LyricSheet, error) {
	if _, err := sheetSection(sheet, sectionID); err != nil {
		return LyricSheet{}, err
	}
	if slices.Contains(sheet.Arrangement, sectionID) {
		return LyricSheet{}, domain.Conflict("only a Section in the Scrapbook can be deleted; remove it from the Arrangement first")
	}
	sheet.Scrapbook = without(sheet.Scrapbook, sectionID)
	sheet.Sections = slices.DeleteFunc(sheet.Sections, func(s Section) bool { return s.ID == sectionID })
	return sheet, nil
}

// AddToArrangement puts one of the Song's Sections in the Scrapbook into the
// Arrangement at position. A nil position adds it at the end. A Section
// appears at most once (ADR 0010), so one already in the Arrangement is
// refused: a Duplicate of it can be added instead.
func (s *Store) AddToArrangement(ctx context.Context, songID int64, based songversion.Version, sectionID int64, position *int) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, _ *ids) (LyricSheet, error) {
		return addToArrangement(sheet, sectionID, position)
	})
}

// addToArrangement is AddToArrangement's change to the sheet.
func addToArrangement(sheet LyricSheet, sectionID int64, position *int) (LyricSheet, error) {
	if _, err := sheetSection(sheet, sectionID); err != nil {
		return LyricSheet{}, err
	}
	if slices.Contains(sheet.Arrangement, sectionID) {
		return LyricSheet{}, domain.Conflict("that Section is already in the Lyric Sheet; Duplicate it instead")
	}
	arrangement, err := placeAt(sheet.Arrangement, sectionID, position)
	if err != nil {
		return LyricSheet{}, err
	}
	sheet.Arrangement = arrangement
	sheet.Scrapbook = without(sheet.Scrapbook, sectionID)
	return sheet, nil
}

// sheetSection is one of a sheet's Sections, by id: domain.ErrNotFound if
// it isn't the sheet's.
func sheetSection(sheet LyricSheet, sectionID int64) (*Section, error) {
	for i := range sheet.Sections {
		if sheet.Sections[i].ID == sectionID {
			return &sheet.Sections[i], nil
		}
	}
	return nil, domain.ErrNotFound
}

// without is ids with id taken out.
func without(ids []int64, id int64) []int64 {
	return slices.DeleteFunc(ids, func(i int64) bool { return i == id })
}

// DuplicateSection puts a Duplicate of one of the Song's Sections at position
// in the Arrangement: an independent copy with its Label and every Alternate
// (names, Lines and Chords, the same one active), but none of its Cues, as
// the copy is sung at another time. A nil position adds it at the end.
func (s *Store) DuplicateSection(ctx context.Context, songID int64, based songversion.Version, sectionID int64, position *int) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, ids *ids) (LyricSheet, error) {
		return duplicateSection(sheet, ids, sectionID, position)
	})
}

// duplicateSection is DuplicateSection's change to the sheet.
func duplicateSection(sheet LyricSheet, ids *ids, sectionID int64, position *int) (LyricSheet, error) {
	sec, err := sheetSection(sheet, sectionID)
	if err != nil {
		return LyricSheet{}, err
	}
	dup := Section{ID: ids.section(), Label: sec.Label, Alternates: make([]Alternate, len(sec.Alternates))}
	for i, alt := range sec.Alternates {
		copied := Alternate{ID: ids.alternate(), Name: alt.Name, Active: alt.Active, Lines: make([]Line, len(alt.Lines))}
		for j, l := range alt.Lines {
			copied.Lines[j] = newLine(ids.line(), l.Text, sql.NullInt64{})
		}
		dup.Alternates[i] = copied
	}
	arrangement, err := placeAt(sheet.Arrangement, dup.ID, position)
	if err != nil {
		return LyricSheet{}, err
	}
	sheet.Arrangement = arrangement
	sheet.Sections = append(sheet.Sections, dup)
	return sheet, nil
}

// RemoveFromArrangement takes a Section out of the Arrangement, both from its
// actions and by dropping it on the Scrapbook. It goes to the end of the
// Scrapbook, unless nothing is written in it: then it is deleted, as there's
// nothing to keep. It keeps its Cues, dormant ones included, for when it's
// put back (ADR 0010).
func (s *Store) RemoveFromArrangement(ctx context.Context, songID int64, based songversion.Version, sectionID int64) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, _ *ids) (LyricSheet, error) {
		return removeFromArrangement(sheet, sectionID)
	})
}

// removeFromArrangement is RemoveFromArrangement's change to the sheet.
func removeFromArrangement(sheet LyricSheet, sectionID int64) (LyricSheet, error) {
	sec, err := sheetSection(sheet, sectionID)
	if err != nil {
		return LyricSheet{}, err
	}
	if !slices.Contains(sheet.Arrangement, sectionID) {
		return LyricSheet{}, domain.Conflict("that Section isn't in the Lyric Sheet")
	}
	sheet.Arrangement = without(sheet.Arrangement, sectionID)
	if sectionEmpty(*sec) {
		sheet.Sections = slices.DeleteFunc(sheet.Sections, func(s Section) bool { return s.ID == sectionID })
	} else {
		sheet.Scrapbook = append(sheet.Scrapbook, sectionID)
	}
	return sheet, nil
}

// leaveArrangement takes the Section at pos out of the Arrangement, closing
// the gap it leaves.
func leaveArrangement(ctx context.Context, tx *sql.Tx, songID, sectionID, pos int64) error {
	if _, err := tx.ExecContext(ctx, `UPDATE sections SET position = NULL WHERE id = ?`, sectionID); err != nil {
		return fmt.Errorf("removing section from arrangement: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE sections SET position = position - 1 WHERE song_id = ? AND position > ?`,
		songID, pos); err != nil {
		return fmt.Errorf("closing gap in arrangement: %w", err)
	}
	return nil
}

// sectionEmpty reports whether nothing is written in any of a Section's
// Alternates: they have no Lines, or only blank ones.
func sectionEmpty(sec Section) bool {
	for _, alt := range sec.Alternates {
		for _, l := range alt.Lines {
			if !blank(l.Text) {
				return false
			}
		}
	}
	return true
}

// findSection checks a Section belongs to a Song and returns its position
// in the Arrangement, which is null while it's in the Scrapbook.
func findSection(ctx context.Context, tx *sql.Tx, songID, sectionID int64) (pos sql.NullInt64, err error) {
	err = tx.QueryRowContext(ctx, `SELECT position FROM sections WHERE id = ? AND song_id = ?`,
		sectionID, songID).Scan(&pos)
	if errors.Is(err, sql.ErrNoRows) {
		return sql.NullInt64{}, domain.ErrNotFound
	}
	return pos, err
}

// alternatesOf returns the ids of a Section's Alternates, in the order they
// were created.
func alternatesOf(ctx context.Context, tx *sql.Tx, sectionID int64) ([]int64, error) {
	var alternates []int64
	err := query(ctx, tx, `SELECT id FROM alternates WHERE section_id = ? ORDER BY id`,
		[]any{sectionID}, func(rows *sql.Rows) error {
			var id int64
			err := rows.Scan(&id)
			alternates = append(alternates, id)
			return err
		})
	if err != nil {
		return nil, fmt.Errorf("reading alternates: %w", err)
	}
	return alternates, nil
}

// copyLines copies all of an Alternate's Lines, without their Cues, into
// another Alternate, and returns the id of each Line's copy by the id of the
// Line.
func copyLines(ctx context.Context, tx *sql.Tx, fromID, toID int64) (map[int64]int64, error) {
	var lines []int64
	err := query(ctx, tx, `SELECT id FROM lines WHERE alternate_id = ? ORDER BY position`,
		[]any{fromID}, func(rows *sql.Rows) error {
			var id int64
			err := rows.Scan(&id)
			lines = append(lines, id)
			return err
		})
	if err != nil {
		return nil, fmt.Errorf("reading lines: %w", err)
	}
	copies := make(map[int64]int64, len(lines))
	for _, lineID := range lines {
		copies[lineID], err = insert(ctx, tx, `INSERT INTO lines (alternate_id, position, text)
			SELECT ?, position, text FROM lines WHERE id = ?`, toID, lineID)
		if err != nil {
			return nil, fmt.Errorf("copying line: %w", err)
		}
	}
	return copies, nil
}

// arrangementPosition checks a position to insert at in a Song's
// Arrangement. A nil position means the end.
func arrangementPosition(ctx context.Context, tx *sql.Tx, songID int64, position *int) (int, error) {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM sections WHERE song_id = ? AND position IS NOT NULL`,
		songID).Scan(&count); err != nil {
		return 0, err
	}
	if position == nil {
		return count, nil
	}
	if *position < 0 || *position > count {
		return 0, domain.Invalid(fmt.Sprintf("position must be between 0 and %d", count))
	}
	return *position, nil
}

// placeSection puts a Section not in the Arrangement at pos in it, moving
// the ones from pos on down by one.
func placeSection(ctx context.Context, tx *sql.Tx, songID, sectionID int64, pos int) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE sections SET position = position + 1 WHERE song_id = ? AND position >= ?`,
		songID, pos); err != nil {
		return fmt.Errorf("making room in arrangement: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE sections SET position = ? WHERE id = ?`, pos, sectionID); err != nil {
		return fmt.Errorf("adding section to arrangement: %w", err)
	}
	return nil
}

// SetSectionLabel changes a Section's Label. A blank Label removes it.
func (s *Store) SetSectionLabel(ctx context.Context, songID int64, based songversion.Version, sectionID int64, label string) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, _ *ids) (LyricSheet, error) {
		return setSectionLabel(sheet, sectionID, label)
	})
}

// setSectionLabel is SetSectionLabel's change to the sheet.
func setSectionLabel(sheet LyricSheet, sectionID int64, label string) (LyricSheet, error) {
	sec, err := sheetSection(sheet, sectionID)
	if err != nil {
		return LyricSheet{}, err
	}
	sec.Label = cleanLabel(label)
	return sheet, nil
}

// ReorderArrangement puts the Sections in a Song's Arrangement in the given
// order, which must list every one of them exactly once.
func (s *Store) ReorderArrangement(ctx context.Context, songID int64, based songversion.Version, order []int64) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, _ *ids) (LyricSheet, error) {
		return reorderArrangement(sheet, order)
	})
}

// reorderArrangement is ReorderArrangement's change to the sheet.
func reorderArrangement(sheet LyricSheet, order []int64) (LyricSheet, error) {
	sorted, current := slices.Sorted(slices.Values(order)), slices.Sorted(slices.Values(sheet.Arrangement))
	if !slices.Equal(sorted, current) {
		return LyricSheet{}, domain.Invalid("the new order must list every Section in the Lyric Sheet exactly once")
	}
	sheet.Arrangement = slices.Clone(order)
	return sheet, nil
}

// cleanLabel trims a Label; blank means no Label.
func cleanLabel(label string) string {
	return strings.TrimSpace(label)
}

// insert runs an INSERT and returns the new row's id.
func insert(ctx context.Context, db execer, stmt string, args ...any) (int64, error) {
	res, err := db.ExecContext(ctx, stmt, args...)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
