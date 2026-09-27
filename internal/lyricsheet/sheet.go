package lyricsheet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// LyricSheet is the written side of a Song: its Sections laid out by the
// Arrangement.
type LyricSheet struct {
	Arrangement []Occurrence `json:"arrangement"`
	// Sections holds every Section of the Song, in the Arrangement or not.
	Sections []Section `json:"sections"`
	// Scrapbook lists the ids of the Sections with no Occurrence.
	Scrapbook []int64 `json:"scrapbook"`
}

// Occurrence is one appearance of a Section in the Arrangement.
type Occurrence struct {
	ID        int64 `json:"id"`
	SectionID int64 `json:"sectionId"`
	// Shared means other Occurrences show the same Section, so editing it
	// changes them too.
	Shared bool `json:"shared"`
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
}

// newLine builds a Line from its stored text.
func newLine(id int64, text string) Line {
	lyrics, chords := parseLine(text)
	return Line{ID: id, Text: text, Lyrics: lyrics, Chords: chords, ChordLine: isChordLine(lyrics, chords)}
}

// loadLyricSheet reads a Song's whole Lyric Sheet.
func (s *Store) loadLyricSheet(ctx context.Context, songID int64) (LyricSheet, error) {
	sheet := LyricSheet{Arrangement: []Occurrence{}, Sections: []Section{}, Scrapbook: []int64{}}
	sectionAt := map[int64]int{}
	type place struct{ section, alternate int }
	alternateAt := map[int64]place{}

	err := query(ctx, s.db, `SELECT id, label FROM sections WHERE song_id = ? ORDER BY id`,
		[]any{songID}, func(rows *sql.Rows) error {
			sec := Section{Alternates: []Alternate{}}
			if err := rows.Scan(&sec.ID, &sec.Label); err != nil {
				return err
			}
			sectionAt[sec.ID] = len(sheet.Sections)
			sheet.Sections = append(sheet.Sections, sec)
			return nil
		})
	if err != nil {
		return LyricSheet{}, fmt.Errorf("reading sections: %w", err)
	}

	err = query(ctx, s.db, `SELECT a.id, a.section_id, a.name, a.active
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

	err = query(ctx, s.db, `SELECT l.id, l.alternate_id, l.text
		FROM lines l JOIN alternates a ON a.id = l.alternate_id JOIN sections s ON s.id = a.section_id
		WHERE s.song_id = ? ORDER BY l.alternate_id, l.position`,
		[]any{songID}, func(rows *sql.Rows) error {
			var id, alternateID int64
			var text string
			if err := rows.Scan(&id, &alternateID, &text); err != nil {
				return err
			}
			p := alternateAt[alternateID]
			alt := &sheet.Sections[p.section].Alternates[p.alternate]
			alt.Lines = append(alt.Lines, newLine(id, text))
			return nil
		})
	if err != nil {
		return LyricSheet{}, fmt.Errorf("reading lines: %w", err)
	}

	uses := map[int64]int{}
	err = query(ctx, s.db, `SELECT id, section_id FROM occurrences WHERE song_id = ? ORDER BY position, id`,
		[]any{songID}, func(rows *sql.Rows) error {
			var o Occurrence
			if err := rows.Scan(&o.ID, &o.SectionID); err != nil {
				return err
			}
			uses[o.SectionID]++
			sheet.Arrangement = append(sheet.Arrangement, o)
			return nil
		})
	if err != nil {
		return LyricSheet{}, fmt.Errorf("reading arrangement: %w", err)
	}
	for i := range sheet.Arrangement {
		sheet.Arrangement[i].Shared = uses[sheet.Arrangement[i].SectionID] > 1
	}
	for _, sec := range sheet.Sections {
		if uses[sec.ID] == 0 {
			sheet.Scrapbook = append(sheet.Scrapbook, sec.ID)
		}
	}
	return sheet, nil
}

// queryer is what both *sql.DB and *sql.Tx offer for reading.
type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// query runs a query and calls row for each result row.
func query(ctx context.Context, q queryer, stmt string, args []any, row func(*sql.Rows) error) error {
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

// change runs one Lyric Sheet change on a Song in a transaction, marks the
// Song as edited, and returns the updated Song. If fn fails, nothing changes.
func (s *Store) change(ctx context.Context, songID int64, fn func(tx *sql.Tx) error) (Song, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Song{}, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE songs SET updated_at = ? WHERE id = ?`,
		time.Now().UTC().Format(timeFormat), songID)
	if err != nil {
		return Song{}, fmt.Errorf("touching song: %w", err)
	}
	if err := expectOneRow(res); err != nil {
		return Song{}, err
	}
	if err := fn(tx); err != nil {
		return Song{}, err
	}
	if err := tx.Commit(); err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, songID)
}

// AddSection creates a Section with the given Label, its first (active)
// Alternate, and an Occurrence of it at position in the Arrangement. A nil
// position adds it at the end.
func (s *Store) AddSection(ctx context.Context, songID int64, label string, position *int) (Song, error) {
	return s.change(ctx, songID, func(tx *sql.Tx) error {
		pos, err := arrangementPosition(ctx, tx, songID, position)
		if err != nil {
			return err
		}
		sectionID, err := insert(ctx, tx, `INSERT INTO sections (song_id, label) VALUES (?, ?)`,
			songID, cleanLabel(label))
		if err != nil {
			return fmt.Errorf("adding section: %w", err)
		}
		if _, err := insert(ctx, tx, `INSERT INTO alternates (section_id, active) VALUES (?, 1)`,
			sectionID); err != nil {
			return fmt.Errorf("adding alternate: %w", err)
		}
		return insertOccurrence(ctx, tx, songID, sectionID, pos)
	})
}

// AddOccurrence adds another Occurrence of one of the Song's Sections at
// position in the Arrangement. A nil position adds it at the end.
func (s *Store) AddOccurrence(ctx context.Context, songID, sectionID int64, position *int) (Song, error) {
	return s.change(ctx, songID, func(tx *sql.Tx) error {
		var found int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM sections WHERE id = ? AND song_id = ?`,
			sectionID, songID).Scan(&found); err != nil {
			return err
		}
		if found == 0 {
			return ErrNotFound
		}
		pos, err := arrangementPosition(ctx, tx, songID, position)
		if err != nil {
			return err
		}
		return insertOccurrence(ctx, tx, songID, sectionID, pos)
	})
}

// RemoveOccurrence takes an Occurrence out of the Arrangement. Its Section is
// never deleted: other Occurrences keep showing it, and without any it is in
// the Scrapbook.
func (s *Store) RemoveOccurrence(ctx context.Context, songID, occurrenceID int64) (Song, error) {
	return s.change(ctx, songID, func(tx *sql.Tx) error {
		_, pos, err := findOccurrence(ctx, tx, songID, occurrenceID)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM occurrences WHERE id = ?`, occurrenceID); err != nil {
			return fmt.Errorf("removing occurrence: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE occurrences SET position = position - 1 WHERE song_id = ? AND position > ?`,
			songID, pos); err != nil {
			return fmt.Errorf("closing gap in arrangement: %w", err)
		}
		return nil
	})
}

// Detach points an Occurrence of a shared Section at a new copy of that
// Section. The other Occurrences keep the original.
func (s *Store) Detach(ctx context.Context, songID, occurrenceID int64) (Song, error) {
	return s.change(ctx, songID, func(tx *sql.Tx) error {
		sectionID, _, err := findOccurrence(ctx, tx, songID, occurrenceID)
		if err != nil {
			return err
		}
		var uses int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM occurrences WHERE section_id = ?`,
			sectionID).Scan(&uses); err != nil {
			return err
		}
		if uses < 2 {
			return invalid("only an Occurrence of a shared Section can be Detached")
		}
		copyID, err := copySection(ctx, tx, sectionID)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE occurrences SET section_id = ? WHERE id = ?`,
			copyID, occurrenceID); err != nil {
			return fmt.Errorf("pointing occurrence at copy: %w", err)
		}
		return nil
	})
}

// findOccurrence returns the Section and position of one of a Song's
// Occurrences.
func findOccurrence(ctx context.Context, tx *sql.Tx, songID, occurrenceID int64) (sectionID int64, pos int, err error) {
	err = tx.QueryRowContext(ctx, `SELECT section_id, position FROM occurrences WHERE id = ? AND song_id = ?`,
		occurrenceID, songID).Scan(&sectionID, &pos)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, ErrNotFound
	}
	return sectionID, pos, err
}

// copySection creates a new Section with a Section's Label, all its
// Alternates (the same one active) and all their Lines, and returns its id.
func copySection(ctx context.Context, tx *sql.Tx, sectionID int64) (int64, error) {
	copyID, err := insert(ctx, tx,
		`INSERT INTO sections (song_id, label) SELECT song_id, label FROM sections WHERE id = ?`, sectionID)
	if err != nil {
		return 0, fmt.Errorf("copying section: %w", err)
	}
	var alternates []int64
	err = query(ctx, tx, `SELECT id FROM alternates WHERE section_id = ? ORDER BY id`,
		[]any{sectionID}, func(rows *sql.Rows) error {
			var id int64
			err := rows.Scan(&id)
			alternates = append(alternates, id)
			return err
		})
	if err != nil {
		return 0, fmt.Errorf("reading alternates: %w", err)
	}
	for _, altID := range alternates {
		copyAltID, err := insert(ctx, tx, `INSERT INTO alternates (section_id, name, active)
			SELECT ?, name, active FROM alternates WHERE id = ?`, copyID, altID)
		if err != nil {
			return 0, fmt.Errorf("copying alternate: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO lines (alternate_id, position, text)
			SELECT ?, position, text FROM lines WHERE alternate_id = ? ORDER BY position`,
			copyAltID, altID); err != nil {
			return 0, fmt.Errorf("copying lines: %w", err)
		}
	}
	return copyID, nil
}

// arrangementPosition checks a position to insert at in a Song's
// Arrangement. A nil position means the end.
func arrangementPosition(ctx context.Context, tx *sql.Tx, songID int64, position *int) (int, error) {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM occurrences WHERE song_id = ?`,
		songID).Scan(&count); err != nil {
		return 0, err
	}
	if position == nil {
		return count, nil
	}
	if *position < 0 || *position > count {
		return 0, invalid(fmt.Sprintf("position must be between 0 and %d", count))
	}
	return *position, nil
}

// insertOccurrence puts an Occurrence of a Section at pos in the
// Arrangement, moving the ones from pos on down by one.
func insertOccurrence(ctx context.Context, tx *sql.Tx, songID, sectionID int64, pos int) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE occurrences SET position = position + 1 WHERE song_id = ? AND position >= ?`,
		songID, pos); err != nil {
		return fmt.Errorf("making room in arrangement: %w", err)
	}
	if _, err := insert(ctx, tx,
		`INSERT INTO occurrences (song_id, section_id, position) VALUES (?, ?, ?)`,
		songID, sectionID, pos); err != nil {
		return fmt.Errorf("adding occurrence: %w", err)
	}
	return nil
}

// SetSectionLabel changes a Section's Label. A blank Label removes it.
func (s *Store) SetSectionLabel(ctx context.Context, songID, sectionID int64, label string) (Song, error) {
	return s.change(ctx, songID, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE sections SET label = ? WHERE id = ? AND song_id = ?`,
			cleanLabel(label), sectionID, songID)
		if err != nil {
			return fmt.Errorf("changing label: %w", err)
		}
		return expectOneRow(res)
	})
}

// ReorderArrangement puts a Song's Occurrences in the given order, which must
// list every one of them exactly once.
func (s *Store) ReorderArrangement(ctx context.Context, songID int64, order []int64) (Song, error) {
	return s.change(ctx, songID, func(tx *sql.Tx) error {
		current := map[int64]bool{}
		err := query(ctx, tx, `SELECT id FROM occurrences WHERE song_id = ?`, []any{songID},
			func(rows *sql.Rows) error {
				var id int64
				err := rows.Scan(&id)
				current[id] = true
				return err
			})
		if err != nil {
			return fmt.Errorf("reading arrangement: %w", err)
		}
		errOrder := invalid("the new order must list every Occurrence exactly once")
		if len(order) != len(current) {
			return errOrder
		}
		for _, id := range order {
			if !current[id] {
				return errOrder
			}
			delete(current, id)
		}
		for pos, id := range order {
			if _, err := tx.ExecContext(ctx, `UPDATE occurrences SET position = ? WHERE id = ?`,
				pos, id); err != nil {
				return fmt.Errorf("reordering: %w", err)
			}
		}
		return nil
	})
}

// cleanLabel trims a Label; blank means no Label.
func cleanLabel(label string) string {
	return strings.TrimSpace(label)
}

// insert runs an INSERT and returns the new row's id.
func insert(ctx context.Context, tx *sql.Tx, stmt string, args ...any) (int64, error) {
	res, err := tx.ExecContext(ctx, stmt, args...)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
