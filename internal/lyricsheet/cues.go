package lyricsheet

import (
	"context"
	"database/sql"
	"fmt"
	"math"
)

// cueMillis turns a Cue in seconds into the milliseconds it's kept as.
func cueMillis(seconds float64) (int64, error) {
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0, invalid("a Cue must be a time in seconds")
	}
	ms := int64(math.Round(seconds * 1000))
	if ms < 0 {
		return 0, invalid("a Cue can't be before the start of the Timeline")
	}
	return ms, nil
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
// starts on the Timeline. It may lie past the last Clip.
func (s *Store) SetOccurrenceCue(ctx context.Context, songID int64, based Version, occurrenceID int64, seconds float64) (Song, error) {
	ms, err := cueMillis(seconds)
	if err != nil {
		return Song{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return writeOccurrenceCue(ctx, tx, songID, occurrenceID, sql.NullInt64{Int64: ms, Valid: true})
	})
}

// ClearOccurrenceCue removes an Occurrence's Cue.
func (s *Store) ClearOccurrenceCue(ctx context.Context, songID int64, based Version, occurrenceID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return writeOccurrenceCue(ctx, tx, songID, occurrenceID, sql.NullInt64{})
	})
}

func writeOccurrenceCue(ctx context.Context, tx *sql.Tx, songID, occurrenceID int64, ms sql.NullInt64) error {
	res, err := tx.ExecContext(ctx, `UPDATE occurrences SET cue_ms = ? WHERE id = ? AND song_id = ?`,
		ms, occurrenceID, songID)
	if err != nil {
		return fmt.Errorf("setting occurrence cue: %w", err)
	}
	return expectOneRow(res)
}
