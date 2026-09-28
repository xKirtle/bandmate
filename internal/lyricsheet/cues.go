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
	return millis(seconds), nil
}

// SetLineCue gives a Line a Cue within one Occurrence: the time, in seconds,
// where it's sung there. The Line may be in any of the Section's Alternates,
// but can't be blank. An Occurrence has no Cue of its own: it starts where
// its first Line is cued (ADR 0009).
func (s *Store) SetLineCue(ctx context.Context, songID int64, based Version, occurrenceID, lineID int64, seconds float64) (Song, error) {
	ms, err := cueMillis(seconds)
	if err != nil {
		return Song{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return writeLineCue(ctx, tx, songID, occurrenceID, lineID, sql.NullInt64{Int64: ms, Valid: true})
	})
}

// ClearLineCue removes a Line's Cue within one Occurrence.
func (s *Store) ClearLineCue(ctx context.Context, songID int64, based Version, occurrenceID, lineID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return writeLineCue(ctx, tx, songID, occurrenceID, lineID, sql.NullInt64{})
	})
}

// writeLineCue sets or, with a null ms, clears a Line's Cue within one of a
// Song's Occurrences. The Line must be in the Occurrence's Section, and
// can't be blank to be given a Cue.
func writeLineCue(ctx context.Context, tx *sql.Tx, songID, occurrenceID, lineID int64, ms sql.NullInt64) error {
	text, err := findOccurrenceLine(ctx, tx, songID, occurrenceID, lineID)
	if err != nil {
		return err
	}
	if !ms.Valid {
		if _, err := tx.ExecContext(ctx, `DELETE FROM line_cues WHERE occurrence_id = ? AND line_id = ?`,
			occurrenceID, lineID); err != nil {
			return fmt.Errorf("clearing line cue: %w", err)
		}
		return nil
	}
	if blank(text) {
		return invalid("a blank Line can't have a Cue")
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO line_cues (occurrence_id, line_id, cue_ms) VALUES (?, ?, ?)
		ON CONFLICT (occurrence_id, line_id) DO UPDATE SET cue_ms = excluded.cue_ms`,
		occurrenceID, lineID, ms); err != nil {
		return fmt.Errorf("setting line cue: %w", err)
	}
	return nil
}

// ClearOccurrenceCues removes all an Occurrence's Line Cues, dormant ones
// included.
func (s *Store) ClearOccurrenceCues(ctx context.Context, songID int64, based Version, occurrenceID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, _, err := findOccurrence(ctx, tx, songID, occurrenceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM line_cues WHERE occurrence_id = ?`, occurrenceID); err != nil {
			return fmt.Errorf("clearing line cues: %w", err)
		}
		return nil
	})
}

// ClearCues removes every Cue in a Song, dormant ones included.
func (s *Store) ClearCues(ctx context.Context, songID int64, based Version) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM line_cues
			WHERE occurrence_id IN (SELECT id FROM occurrences WHERE song_id = ?)`, songID); err != nil {
			return fmt.Errorf("clearing line cues: %w", err)
		}
		return nil
	})
}

// CueValue is one Cue to restore: a Line's Cue within an Occurrence. A nil
// Cue means none.
type CueValue struct {
	OccurrenceID int64
	LineID       int64
	Cue          *float64
}

// RestoreCues sets each Cue given to its value, in seconds, or clears it,
// and leaves every other Cue alone. It puts back what another Cue edit
// changed, e.g. to undo it.
func (s *Store) RestoreCues(ctx context.Context, songID int64, based Version, values []CueValue) (Song, error) {
	ms := make([]sql.NullInt64, len(values))
	for i, v := range values {
		if v.Cue == nil {
			continue
		}
		m, err := cueMillis(*v.Cue)
		if err != nil {
			return Song{}, err
		}
		ms[i] = sql.NullInt64{Int64: m, Valid: true}
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		for i, v := range values {
			if err := writeLineCue(ctx, tx, songID, v.OccurrenceID, v.LineID, ms[i]); err != nil {
				return err
			}
		}
		return nil
	})
}

// ShiftCues moves every Cue in a Song that lies in [start, end), in
// seconds, by the seconds given, dormant ones included. It's how Cues
// follow a Clip that was moved. None may end up before the start of the
// Timeline, or the shift is refused.
func (s *Store) ShiftCues(ctx context.Context, songID int64, based Version, start, end, by float64) (Song, error) {
	if end <= start {
		return Song{}, invalid("the span must end after it starts")
	}
	startMs, endMs := millis(start), millis(end)
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		var low, high sql.NullInt64
		err := tx.QueryRowContext(ctx, `SELECT MIN(lc.cue_ms), MAX(lc.cue_ms)
			FROM line_cues lc JOIN occurrences o ON o.id = lc.occurrence_id
			WHERE o.song_id = ? AND lc.cue_ms >= ? AND lc.cue_ms < ?`, songID, startMs, endMs).Scan(&low, &high)
		if err != nil {
			return fmt.Errorf("finding cues to shift: %w", err)
		}
		if !low.Valid {
			return nil
		}
		// Checked in seconds, as a shift far out of range overflows milliseconds.
		for _, ms := range []int64{low.Int64, high.Int64} {
			if _, err := cueMillis(float64(ms)/1000 + by); err != nil {
				return err
			}
		}
		delta := millis(by)
		if _, err := tx.ExecContext(ctx, `UPDATE line_cues SET cue_ms = cue_ms + ?
			WHERE occurrence_id IN (SELECT id FROM occurrences WHERE song_id = ?) AND cue_ms >= ? AND cue_ms < ?`,
			delta, songID, startMs, endMs); err != nil {
			return fmt.Errorf("shifting line cues: %w", err)
		}
		return nil
	})
}

// millis turns seconds into whole milliseconds, as Cues are kept, without
// checking they make a Cue.
func millis(seconds float64) int64 {
	return int64(math.Round(seconds * 1000))
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

// blank is whether a Line's text is empty or only spaces, so has nothing to
// cue.
func blank(text string) bool {
	return strings.TrimSpace(text) == ""
}
