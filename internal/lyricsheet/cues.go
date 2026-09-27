package lyricsheet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
)

// maxCue is the latest a Cue can be, in seconds: far past any Song, and
// well within what milliseconds can hold.
const maxCue = 24 * 60 * 60

// cueMillis turns a Cue in seconds into the milliseconds it's kept as.
func cueMillis(seconds float64) (int64, error) {
	switch {
	case math.IsNaN(seconds):
		return 0, invalid("a Cue must be a time in seconds")
	case seconds < 0:
		return 0, invalid("a Cue can't be before the start of the Timeline")
	case seconds > maxCue:
		return 0, invalid("a Cue can't be more than 24 hours into the Timeline")
	}
	return int64(math.Round(seconds * 1000)), nil
}

// cueSeconds turns a stored Cue back into seconds, or nil for none.
func cueSeconds(ms sql.NullInt64) *float64 {
	if !ms.Valid {
		return nil
	}
	s := float64(ms.Int64) / 1000
	return &s
}

// SetOccurrenceCue gives an Occurrence a Cue: the time, in seconds, where it
// starts on the Timeline. It may lie past the last Clip. If the
// Occurrence's first Line has a Cue, it moves to the same time.
func (s *Store) SetOccurrenceCue(ctx context.Context, songID int64, based Version, occurrenceID int64, seconds float64) (Song, error) {
	ms, err := cueMillis(seconds)
	if err != nil {
		return Song{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if err := writeOccurrenceCue(ctx, tx, songID, occurrenceID, sql.NullInt64{Int64: ms, Valid: true}); err != nil {
			return err
		}
		first, err := firstLine(ctx, tx, occurrenceID)
		if err != nil || first == 0 {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE line_cues SET cue_ms = ? WHERE occurrence_id = ? AND line_id = ?`,
			ms, occurrenceID, first); err != nil {
			return fmt.Errorf("moving first line's cue: %w", err)
		}
		return nil
	})
}

// ClearOccurrenceCue removes an Occurrence's Cue.
func (s *Store) ClearOccurrenceCue(ctx context.Context, songID int64, based Version, occurrenceID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return writeOccurrenceCue(ctx, tx, songID, occurrenceID, sql.NullInt64{})
	})
}

// writeOccurrenceCue sets or, with a null ms, clears one of a Song's
// Occurrence Cues.
func writeOccurrenceCue(ctx context.Context, tx *sql.Tx, songID, occurrenceID int64, ms sql.NullInt64) error {
	res, err := tx.ExecContext(ctx, `UPDATE occurrences SET cue_ms = ? WHERE id = ? AND song_id = ?`,
		ms, occurrenceID, songID)
	if err != nil {
		return fmt.Errorf("setting occurrence cue: %w", err)
	}
	return expectOneRow(res)
}

// SetLineCue gives a Line a Cue within one Occurrence: the time, in seconds,
// where it's sung there. The Line may be in any of the Section's Alternates,
// but can't be blank. Cueing the Occurrence's first Line cues the
// Occurrence too, so the two always agree.
func (s *Store) SetLineCue(ctx context.Context, songID int64, based Version, occurrenceID, lineID int64, seconds float64) (Song, error) {
	ms, err := cueMillis(seconds)
	if err != nil {
		return Song{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		text, err := findOccurrenceLine(ctx, tx, songID, occurrenceID, lineID)
		if err != nil {
			return err
		}
		if blank(text) {
			return invalid("a blank Line can't have a Cue")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO line_cues (occurrence_id, line_id, cue_ms) VALUES (?, ?, ?)
			ON CONFLICT (occurrence_id, line_id) DO UPDATE SET cue_ms = excluded.cue_ms`,
			occurrenceID, lineID, ms); err != nil {
			return fmt.Errorf("setting line cue: %w", err)
		}
		first, err := firstLine(ctx, tx, occurrenceID)
		if err != nil || first != lineID {
			return err
		}
		return writeOccurrenceCue(ctx, tx, songID, occurrenceID, sql.NullInt64{Int64: ms, Valid: true})
	})
}

// ClearLineCue removes a Line's Cue within one Occurrence. The Occurrence's
// own Cue stays, even when it's the first Line's.
func (s *Store) ClearLineCue(ctx context.Context, songID int64, based Version, occurrenceID, lineID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, err := findOccurrenceLine(ctx, tx, songID, occurrenceID, lineID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM line_cues WHERE occurrence_id = ? AND line_id = ?`,
			occurrenceID, lineID); err != nil {
			return fmt.Errorf("clearing line cue: %w", err)
		}
		return nil
	})
}

// findOccurrenceLine checks an Occurrence belongs to a Song and a Line to
// any Alternate of its Section, and returns the Line's text.
func findOccurrenceLine(ctx context.Context, tx *sql.Tx, songID, occurrenceID, lineID int64) (string, error) {
	sectionID, _, err := findOccurrence(ctx, tx, songID, occurrenceID)
	if err != nil {
		return "", err
	}
	var text string
	err = tx.QueryRowContext(ctx, `SELECT l.text FROM lines l JOIN alternates a ON a.id = l.alternate_id
		WHERE l.id = ? AND a.section_id = ?`, lineID, sectionID).Scan(&text)
	if errors.Is(err, sql.ErrNoRows) {
		return "", invalid("that Line isn't in this Occurrence's Section")
	}
	return text, err
}

// firstLine returns the id of an Occurrence's first Line: the first of its
// active Alternate that can take a Cue, or 0 if there's none.
func firstLine(ctx context.Context, tx *sql.Tx, occurrenceID int64) (int64, error) {
	var first int64
	err := query(ctx, tx, `SELECT l.id, l.text FROM lines l
		JOIN alternates a ON a.id = l.alternate_id AND a.active = 1
		JOIN occurrences o ON o.section_id = a.section_id
		WHERE o.id = ? ORDER BY l.position`,
		[]any{occurrenceID}, func(rows *sql.Rows) error {
			var id int64
			var text string
			if err := rows.Scan(&id, &text); err != nil {
				return err
			}
			if first == 0 && !blank(text) {
				first = id
			}
			return nil
		})
	if err != nil {
		return 0, fmt.Errorf("finding first line: %w", err)
	}
	return first, nil
}

// blank is whether a Line's text is empty or only spaces, so has nothing to
// cue.
func blank(text string) bool {
	return strings.TrimSpace(text) == ""
}
