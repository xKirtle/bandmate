package lyricsheet

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"maps"
	"slices"
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
	// LineCues maps Line ids to when each is sung in this Occurrence, in
	// seconds to the millisecond. An Occurrence has no Cue of its own: it
	// starts where its first Line is cued (ADR 0009). It holds the Cues of
	// Lines in every Alternate of the Section: those of inactive Alternates
	// lie dormant (ADR 0007).
	LineCues map[int64]float64 `json:"lineCues"`
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

	// Where each Section is in the Scrapbook, should it have no Occurrence.
	scrapbookAt := map[int64]int64{}
	err := query(ctx, s.db, `SELECT id, label, scrapbook_position FROM sections WHERE song_id = ? ORDER BY id`,
		[]any{songID}, func(rows *sql.Rows) error {
			sec := Section{Alternates: []Alternate{}}
			var at int64
			if err := rows.Scan(&sec.ID, &sec.Label, &at); err != nil {
				return err
			}
			scrapbookAt[sec.ID] = at
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
			o.LineCues = map[int64]float64{}
			uses[o.SectionID]++
			sheet.Arrangement = append(sheet.Arrangement, o)
			return nil
		})
	if err != nil {
		return LyricSheet{}, fmt.Errorf("reading arrangement: %w", err)
	}
	occurrenceAt := map[int64]int{}
	for i := range sheet.Arrangement {
		sheet.Arrangement[i].Shared = uses[sheet.Arrangement[i].SectionID] > 1
		occurrenceAt[sheet.Arrangement[i].ID] = i
	}
	err = query(ctx, s.db, `SELECT c.occurrence_id, c.line_id, c.cue_ms
		FROM line_cues c JOIN occurrences o ON o.id = c.occurrence_id WHERE o.song_id = ?`,
		[]any{songID}, func(rows *sql.Rows) error {
			var occurrenceID, lineID, ms int64
			if err := rows.Scan(&occurrenceID, &lineID, &ms); err != nil {
				return err
			}
			sheet.Arrangement[occurrenceAt[occurrenceID]].LineCues[lineID] = float64(ms) / 1000
			return nil
		})
	if err != nil {
		return LyricSheet{}, fmt.Errorf("reading line cues: %w", err)
	}
	for _, sec := range sheet.Sections {
		if uses[sec.ID] == 0 {
			sheet.Scrapbook = append(sheet.Scrapbook, sec.ID)
		}
	}
	slices.SortStableFunc(sheet.Scrapbook, func(a, b int64) int {
		return cmp.Compare(scrapbookAt[a], scrapbookAt[b])
	})
	return sheet, nil
}

// queryer is what both *sql.DB and *sql.Tx offer for reading.
type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
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

// change runs one change on a Song in a transaction, marks the Song as edited
// with a new version, and returns the updated Song. If the Song is no longer
// at the version the change was based on, or fn fails, nothing changes.
func (s *Store) change(ctx context.Context, songID int64, based Version, fn func(tx *sql.Tx) error) (Song, error) {
	if err := s.changeTx(ctx, songID, based, fn); err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, songID)
}

// changeTx is change without reading the Song back, for changes with work
// to do once they're committed.
func (s *Store) changeTx(ctx context.Context, songID int64, based Version, fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := Touch(ctx, tx, songID, based); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// Touch marks a Song as edited within tx, giving it a new version, for a
// change to part of the Song kept elsewhere (e.g. its Timeline). It fails
// with ErrStale if the Song is no longer at the version the change was based
// on, and ErrNotFound if there is no such Song.
func Touch(ctx context.Context, tx *sql.Tx, songID int64, based Version) error {
	res, err := tx.ExecContext(ctx,
		`UPDATE songs SET updated_at = ?, version = version + 1 WHERE id = ? AND (?3 = 0 OR version = ?3)`,
		time.Now().UTC().Format(timeFormat), songID, based)
	if err != nil {
		return fmt.Errorf("touching song: %w", err)
	}
	return expectCurrent(ctx, tx, res, songID)
}

// AddSection creates a Section with the given Label, its first (active)
// Alternate, and an Occurrence of it at position in the Arrangement. A nil
// position adds it at the end.
func (s *Store) AddSection(ctx context.Context, songID int64, based Version, label string, position *int) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		pos, err := arrangementPosition(ctx, tx, songID, position)
		if err != nil {
			return err
		}
		sectionID, _, err := insertSection(ctx, tx, songID, label)
		if err != nil {
			return err
		}
		_, err = insertOccurrence(ctx, tx, songID, sectionID, pos)
		return err
	})
}

// AddToScrapbook creates a Section with the given Label and its first
// (active) Alternate, with no Occurrence, so it starts in the Scrapbook.
func (s *Store) AddToScrapbook(ctx context.Context, songID int64, based Version, label string) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		sectionID, _, err := insertSection(ctx, tx, songID, label)
		if err != nil {
			return err
		}
		return toScrapbookEnd(ctx, tx, songID, sectionID)
	})
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

// DeleteSection permanently deletes a Section in the Scrapbook, with its
// Alternates and Lines. A Section still in the Arrangement can't be deleted.
func (s *Store) DeleteSection(ctx context.Context, songID int64, based Version, sectionID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		uses, err := findSection(ctx, tx, songID, sectionID)
		if err != nil {
			return err
		}
		if uses > 0 {
			return conflict("only a Section in the Scrapbook can be deleted; remove it from the Arrangement first")
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM sections WHERE id = ?`, sectionID); err != nil {
			return fmt.Errorf("deleting section: %w", err)
		}
		return nil
	})
}

// insertSection creates a Section with its first (active) Alternate and
// returns both their ids.
func insertSection(ctx context.Context, tx *sql.Tx, songID int64, label string) (sectionID, alternateID int64, err error) {
	sectionID, err = insert(ctx, tx, `INSERT INTO sections (song_id, label) VALUES (?, ?)`,
		songID, cleanLabel(label))
	if err != nil {
		return 0, 0, fmt.Errorf("adding section: %w", err)
	}
	alternateID, err = insert(ctx, tx, `INSERT INTO alternates (section_id, active) VALUES (?, 1)`,
		sectionID)
	if err != nil {
		return 0, 0, fmt.Errorf("adding alternate: %w", err)
	}
	return sectionID, alternateID, nil
}

// AddOccurrence adds another Occurrence of one of the Song's Sections at
// position in the Arrangement. A nil position adds it at the end.
func (s *Store) AddOccurrence(ctx context.Context, songID int64, based Version, sectionID int64, position *int) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, err := findSection(ctx, tx, songID, sectionID); err != nil {
			return err
		}
		pos, err := arrangementPosition(ctx, tx, songID, position)
		if err != nil {
			return err
		}
		_, err = insertOccurrence(ctx, tx, songID, sectionID, pos)
		return err
	})
}

// RemoveOccurrence takes an Occurrence out of the Arrangement. Other
// Occurrences of its Section keep showing it, and without any it goes to the
// end of the Scrapbook, unless nothing is written in it: then it is deleted,
// as there's nothing to keep.
func (s *Store) RemoveOccurrence(ctx context.Context, songID int64, based Version, occurrenceID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		sectionID, pos, err := findOccurrence(ctx, tx, songID, occurrenceID)
		if err != nil {
			return err
		}
		return removeOccurrence(ctx, tx, songID, occurrenceID, sectionID, pos)
	})
}

// MoveOccurrenceToScrapbook takes an Occurrence out of the Arrangement and
// puts its Section at the end of the Scrapbook. A shared Section is Detached
// first, so a copy goes to the Scrapbook and the other Occurrences keep the
// original. Nothing is kept if nothing is written in it.
func (s *Store) MoveOccurrenceToScrapbook(ctx context.Context, songID int64, based Version, occurrenceID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		sectionID, pos, err := findOccurrence(ctx, tx, songID, occurrenceID)
		if err != nil {
			return err
		}
		uses, err := findSection(ctx, tx, songID, sectionID)
		if err != nil {
			return err
		}
		empty, err := sectionEmpty(ctx, tx, sectionID)
		if err != nil {
			return err
		}
		if uses > 1 && !empty {
			// Its Cues belong to the Occurrence, which goes, so the copy has none.
			copyID, _, err := copySection(ctx, tx, sectionID)
			if err != nil {
				return err
			}
			if err := toScrapbookEnd(ctx, tx, songID, copyID); err != nil {
				return err
			}
		}
		return removeOccurrence(ctx, tx, songID, occurrenceID, sectionID, pos)
	})
}

// removeOccurrence deletes an Occurrence at pos in the Arrangement. Without
// any other Occurrence, its Section goes to the end of the Scrapbook, or is
// deleted if nothing is written in it.
func removeOccurrence(ctx context.Context, tx *sql.Tx, songID, occurrenceID, sectionID int64, pos int) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM occurrences WHERE id = ?`, occurrenceID); err != nil {
		return fmt.Errorf("removing occurrence: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE occurrences SET position = position - 1 WHERE song_id = ? AND position > ?`,
		songID, pos); err != nil {
		return fmt.Errorf("closing gap in arrangement: %w", err)
	}
	uses, err := findSection(ctx, tx, songID, sectionID)
	if err != nil || uses > 0 {
		return err
	}
	empty, err := sectionEmpty(ctx, tx, sectionID)
	if err != nil {
		return err
	}
	if !empty {
		return toScrapbookEnd(ctx, tx, songID, sectionID)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sections WHERE id = ?`, sectionID); err != nil {
		return fmt.Errorf("deleting empty section: %w", err)
	}
	return nil
}

// sectionEmpty reports whether nothing is written in any of a Section's
// Alternates: they have no Lines, or only blank ones.
func sectionEmpty(ctx context.Context, tx *sql.Tx, sectionID int64) (bool, error) {
	empty := true
	err := query(ctx, tx, `SELECT l.text FROM lines l JOIN alternates a ON a.id = l.alternate_id
		WHERE a.section_id = ?`, []any{sectionID}, func(rows *sql.Rows) error {
		var text string
		if err := rows.Scan(&text); err != nil {
			return err
		}
		empty = empty && blank(text)
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("reading section lines: %w", err)
	}
	return empty, nil
}

// Detach points an Occurrence of a shared Section at a new copy of that
// Section. The other Occurrences keep the original. Its Cues go with it.
func (s *Store) Detach(ctx context.Context, songID int64, based Version, occurrenceID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
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
		copyID, lineCopies, err := copySection(ctx, tx, sectionID)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE occurrences SET section_id = ? WHERE id = ?`,
			copyID, occurrenceID); err != nil {
			return fmt.Errorf("pointing occurrence at copy: %w", err)
		}
		// The Occurrence's Line Cues, dormant ones included, go over to the
		// copy's Lines.
		for lineID, copyLineID := range lineCopies {
			if _, err := tx.ExecContext(ctx, `UPDATE line_cues SET line_id = ? WHERE occurrence_id = ? AND line_id = ?`,
				copyLineID, occurrenceID, lineID); err != nil {
				return fmt.Errorf("moving line cues to copy: %w", err)
			}
		}
		return nil
	})
}

// findSection checks a Section belongs to a Song and returns how many
// Occurrences it has.
func findSection(ctx context.Context, tx *sql.Tx, songID, sectionID int64) (uses int, err error) {
	err = tx.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM occurrences WHERE section_id = s.id)
		FROM sections s WHERE s.id = ? AND s.song_id = ?`, sectionID, songID).Scan(&uses)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return uses, err
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
// Alternates (the same one active) and all their Lines. It returns the new
// Section's id, and the id of each Line's copy by the id of the Line.
func copySection(ctx context.Context, tx *sql.Tx, sectionID int64) (int64, map[int64]int64, error) {
	copyID, err := insert(ctx, tx,
		`INSERT INTO sections (song_id, label) SELECT song_id, label FROM sections WHERE id = ?`, sectionID)
	if err != nil {
		return 0, nil, fmt.Errorf("copying section: %w", err)
	}
	alternates, err := alternatesOf(ctx, tx, sectionID)
	if err != nil {
		return 0, nil, err
	}
	lineCopies := map[int64]int64{}
	for _, altID := range alternates {
		copyAltID, err := insert(ctx, tx, `INSERT INTO alternates (section_id, name, active)
			SELECT ?, name, active FROM alternates WHERE id = ?`, copyID, altID)
		if err != nil {
			return 0, nil, fmt.Errorf("copying alternate: %w", err)
		}
		copies, err := copyLines(ctx, tx, altID, copyAltID)
		if err != nil {
			return 0, nil, err
		}
		maps.Copy(lineCopies, copies)
	}
	return copyID, lineCopies, nil
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

// copyLines copies all of an Alternate's Lines into another Alternate, and
// returns the id of each Line's copy by the id of the Line.
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
// Arrangement, moving the ones from pos on down by one, and returns its id.
func insertOccurrence(ctx context.Context, tx *sql.Tx, songID, sectionID int64, pos int) (int64, error) {
	if _, err := tx.ExecContext(ctx,
		`UPDATE occurrences SET position = position + 1 WHERE song_id = ? AND position >= ?`,
		songID, pos); err != nil {
		return 0, fmt.Errorf("making room in arrangement: %w", err)
	}
	id, err := insert(ctx, tx,
		`INSERT INTO occurrences (song_id, section_id, position) VALUES (?, ?, ?)`,
		songID, sectionID, pos)
	if err != nil {
		return 0, fmt.Errorf("adding occurrence: %w", err)
	}
	return id, nil
}

// SetSectionLabel changes a Section's Label. A blank Label removes it.
func (s *Store) SetSectionLabel(ctx context.Context, songID int64, based Version, sectionID int64, label string) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
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
func (s *Store) ReorderArrangement(ctx context.Context, songID int64, based Version, order []int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
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
func insert(ctx context.Context, db execer, stmt string, args ...any) (int64, error) {
	res, err := db.ExecContext(ctx, stmt, args...)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
