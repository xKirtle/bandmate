package lyricsheet

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/domain"
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

// loadLyricSheet reads a Song's whole Lyric Sheet.
func (s *Store) loadLyricSheet(ctx context.Context, songID int64) (LyricSheet, error) {
	sheet := LyricSheet{Arrangement: []int64{}, Sections: []Section{}, Scrapbook: []int64{}}
	sectionAt := map[int64]int{}
	type place struct{ section, alternate int }
	alternateAt := map[int64]place{}

	// Where each Section is in the Arrangement, or else in the Scrapbook.
	arrangementAt := map[int64]int64{}
	scrapbookAt := map[int64]int64{}
	err := query(ctx, s.db, `SELECT id, label, position, scrapbook_position FROM sections WHERE song_id = ? ORDER BY id`,
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

	err = query(ctx, s.db, `SELECT l.id, l.alternate_id, l.text, l.cue_ms
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

// change runs one change on a Song in a transaction, marks the Song as edited
// with a new version, and returns the updated Song. If the Song is no longer
// at the version the change was based on, or fn fails, nothing changes.
func (s *Store) change(ctx context.Context, songID int64, based Version, fn func(tx *sql.Tx) error) (Song, error) {
	return s.changeWithFiles(ctx, songID, based, func(tx *sql.Tx, _ *audio.FileChanges) error {
		return fn(tx)
	})
}

// changeWithFiles is change for a change with files to keep, link or
// remove, which fn adds to changes. They're changed only once the change is
// committed.
func (s *Store) changeWithFiles(ctx context.Context, songID int64, based Version,
	fn func(tx *sql.Tx, changes *audio.FileChanges) error) (Song, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Song{}, err
	}
	defer tx.Rollback()
	if err := Touch(ctx, tx, songID, based); err != nil {
		return Song{}, err
	}
	var changes audio.FileChanges
	if err := fn(tx, &changes); err != nil {
		return Song{}, err
	}
	if err := changes.Commit(tx.Commit); err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, songID)
}

// Touch marks a Song as edited within tx, giving it a new version, for a
// change to part of the Song kept elsewhere (e.g. its Timeline). It fails
// with ErrStale if the Song is no longer at the version the change was based
// on, and domain.ErrNotFound if there is no such Song.
func Touch(ctx context.Context, tx *sql.Tx, songID int64, based Version) error {
	res, err := tx.ExecContext(ctx,
		`UPDATE songs SET updated_at = ?, version = version + 1 WHERE id = ? AND (?3 = 0 OR version = ?3)`,
		time.Now().UTC().Format(domain.TimeFormat), songID, based)
	if err != nil {
		return fmt.Errorf("touching song: %w", err)
	}
	return expectCurrent(ctx, tx, res, songID)
}

// AddSection creates a Section with the given Label and its first (active)
// Alternate at position in the Arrangement. A nil position adds it at the
// end.
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
		return placeSection(ctx, tx, songID, sectionID, pos)
	})
}

// AddToScrapbook creates a Section with the given Label and its first
// (active) Alternate, outside the Arrangement, so it starts in the Scrapbook.
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
		pos, err := findSection(ctx, tx, songID, sectionID)
		if err != nil {
			return err
		}
		if pos.Valid {
			return domain.Conflict("only a Section in the Scrapbook can be deleted; remove it from the Arrangement first")
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

// AddToArrangement puts one of the Song's Sections in the Scrapbook into the
// Arrangement at position. A nil position adds it at the end. A Section
// appears at most once (ADR 0010), so one already in the Arrangement is
// refused: a Duplicate of it can be added instead.
func (s *Store) AddToArrangement(ctx context.Context, songID int64, based Version, sectionID int64, position *int) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		at, err := findSection(ctx, tx, songID, sectionID)
		if err != nil {
			return err
		}
		if at.Valid {
			return domain.Conflict("that Section is already in the Lyric Sheet; Duplicate it instead")
		}
		pos, err := arrangementPosition(ctx, tx, songID, position)
		if err != nil {
			return err
		}
		return placeSection(ctx, tx, songID, sectionID, pos)
	})
}

// DuplicateSection puts a Duplicate of one of the Song's Sections at position
// in the Arrangement: an independent copy with its Label and every Alternate
// (names, Lines and Chords, the same one active), but none of its Cues, as
// the copy is sung at another time. A nil position adds it at the end.
func (s *Store) DuplicateSection(ctx context.Context, songID int64, based Version, sectionID int64, position *int) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, err := findSection(ctx, tx, songID, sectionID); err != nil {
			return err
		}
		pos, err := arrangementPosition(ctx, tx, songID, position)
		if err != nil {
			return err
		}
		copyID, err := copySection(ctx, tx, sectionID)
		if err != nil {
			return err
		}
		return placeSection(ctx, tx, songID, copyID, pos)
	})
}

// RemoveFromArrangement takes a Section out of the Arrangement, both from its
// actions and by dropping it on the Scrapbook. It goes to the end of the
// Scrapbook, unless nothing is written in it: then it is deleted, as there's
// nothing to keep. It keeps its Cues, dormant ones included, for when it's
// put back (ADR 0010).
func (s *Store) RemoveFromArrangement(ctx context.Context, songID int64, based Version, sectionID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		pos, err := findSection(ctx, tx, songID, sectionID)
		if err != nil {
			return err
		}
		if !pos.Valid {
			return domain.Conflict("that Section isn't in the Lyric Sheet")
		}
		if err := leaveArrangement(ctx, tx, songID, sectionID, pos.Int64); err != nil {
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
	})
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

// copySection creates a new Section with a Section's Label, all its
// Alternates (the same one active) and all their Lines, without Cues, and
// returns the new Section's id. The copy isn't in the Arrangement yet.
func copySection(ctx context.Context, tx *sql.Tx, sectionID int64) (int64, error) {
	copyID, err := insert(ctx, tx,
		`INSERT INTO sections (song_id, label) SELECT song_id, label FROM sections WHERE id = ?`, sectionID)
	if err != nil {
		return 0, fmt.Errorf("copying section: %w", err)
	}
	alternates, err := alternatesOf(ctx, tx, sectionID)
	if err != nil {
		return 0, err
	}
	for _, altID := range alternates {
		copyAltID, err := insert(ctx, tx, `INSERT INTO alternates (section_id, name, active)
			SELECT ?, name, active FROM alternates WHERE id = ?`, copyID, altID)
		if err != nil {
			return 0, fmt.Errorf("copying alternate: %w", err)
		}
		if _, err := copyLines(ctx, tx, altID, copyAltID); err != nil {
			return 0, err
		}
	}
	return copyID, nil
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
func (s *Store) SetSectionLabel(ctx context.Context, songID int64, based Version, sectionID int64, label string) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE sections SET label = ? WHERE id = ? AND song_id = ?`,
			cleanLabel(label), sectionID, songID)
		if err != nil {
			return fmt.Errorf("changing label: %w", err)
		}
		return domain.ExpectOneRow(res)
	})
}

// ReorderArrangement puts the Sections in a Song's Arrangement in the given
// order, which must list every one of them exactly once.
func (s *Store) ReorderArrangement(ctx context.Context, songID int64, based Version, order []int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		current := map[int64]bool{}
		err := query(ctx, tx, `SELECT id FROM sections WHERE song_id = ? AND position IS NOT NULL`, []any{songID},
			func(rows *sql.Rows) error {
				var id int64
				err := rows.Scan(&id)
				current[id] = true
				return err
			})
		if err != nil {
			return fmt.Errorf("reading arrangement: %w", err)
		}
		errOrder := domain.Invalid("the new order must list every Section in the Lyric Sheet exactly once")
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
			if _, err := tx.ExecContext(ctx, `UPDATE sections SET position = ? WHERE id = ?`,
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
