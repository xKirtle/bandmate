package lyricsheet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/xKirtle/bandmate/internal/domain"
)

// maxCue is the latest a Cue can be, in seconds: far past any Song, and
// well within what milliseconds can hold.
const maxCue = 24 * 60 * 60

// cueMillis turns a Cue in seconds into the milliseconds it's kept as.
func cueMillis(seconds float64) (int64, error) {
	switch {
	case math.IsNaN(seconds):
		return 0, domain.Invalid("a Cue must be a time in seconds")
	case seconds < 0:
		return 0, domain.Invalid("a Cue can't be before the start of the Timeline")
	case seconds > maxCue:
		return 0, domain.Invalid("a Cue can't be more than 24 hours into the Timeline")
	}
	return millis(seconds), nil
}

// SetLineCue gives a Line a Cue: the time, in seconds, where it's sung. The
// Line may be in any of its Section's Alternates, but can't be blank, and
// its Section must be in the Arrangement. A Section has no Cue of its own:
// it starts where its first Line is cued (ADR 0009).
func (s *Store) SetLineCue(ctx context.Context, songID int64, based Version, lineID int64, seconds float64) (Song, error) {
	ms, err := cueMillis(seconds)
	if err != nil {
		return Song{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		// A Line in the Scrapbook keeps the Cue it had (ADR 0010), but isn't
		// given a new one there.
		_, inArrangement, err := findLine(ctx, tx, songID, lineID)
		if err != nil {
			return err
		}
		if !inArrangement {
			return domain.Conflict("a Line in the Scrapbook can't be given a Cue")
		}
		return writeLineCue(ctx, tx, songID, lineID, sql.NullInt64{Int64: ms, Valid: true})
	})
}

// ClearLineCue removes a Line's Cue.
func (s *Store) ClearLineCue(ctx context.Context, songID int64, based Version, lineID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return writeLineCue(ctx, tx, songID, lineID, sql.NullInt64{})
	})
}

// writeLineCue sets or, with a null ms, clears the Cue of one of a Song's
// Lines, wherever it is. To be given a Cue, the Line can't be blank.
func writeLineCue(ctx context.Context, tx *sql.Tx, songID, lineID int64, ms sql.NullInt64) error {
	text, _, err := findLine(ctx, tx, songID, lineID)
	if err != nil {
		return err
	}
	if ms.Valid && blank(text) {
		return domain.Invalid("a blank Line can't have a Cue")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE lines SET cue_ms = ? WHERE id = ?`, ms, lineID); err != nil {
		return fmt.Errorf("writing line cue: %w", err)
	}
	return nil
}

// ClearSectionCues removes the Cues of all a Section's Lines, dormant ones
// included.
func (s *Store) ClearSectionCues(ctx context.Context, songID int64, based Version, sectionID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, err := findSection(ctx, tx, songID, sectionID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE lines SET cue_ms = NULL WHERE cue_ms IS NOT NULL AND alternate_id IN
			(SELECT id FROM alternates WHERE section_id = ?)`, sectionID); err != nil {
			return fmt.Errorf("clearing line cues: %w", err)
		}
		return nil
	})
}

// ClearCues removes every Cue in a Song, dormant ones included.
func (s *Store) ClearCues(ctx context.Context, songID int64, based Version) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE lines SET cue_ms = NULL
			WHERE cue_ms IS NOT NULL AND id IN (`+songLines+`)`, songID); err != nil {
			return fmt.Errorf("clearing line cues: %w", err)
		}
		return nil
	})
}

// songLines selects the ids of all a Song's Lines, given the Song's id.
const songLines = `SELECT l.id FROM lines l JOIN alternates a ON a.id = l.alternate_id
	JOIN sections s ON s.id = a.section_id WHERE s.song_id = ?`

// CueValue is one Cue to restore: a Line's. A nil Cue means none.
type CueValue struct {
	LineID int64
	Cue    *float64
}

// RestoreCues sets each Cue given to its value, in seconds, or clears it,
// and leaves every other Cue alone. It puts back what another Cue edit
// changed, e.g. to undo it, so a Line in the Scrapbook may be given back
// the Cue it kept there.
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
			if err := writeLineCue(ctx, tx, songID, v.LineID, ms[i]); err != nil {
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
		return Song{}, domain.Invalid("the span must end after it starts")
	}
	startMs, endMs := millis(start), millis(end)
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		var low, high sql.NullInt64
		err := tx.QueryRowContext(ctx, `SELECT MIN(cue_ms), MAX(cue_ms) FROM lines
			WHERE id IN (`+songLines+`) AND cue_ms >= ? AND cue_ms < ?`, songID, startMs, endMs).Scan(&low, &high)
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
		if _, err := tx.ExecContext(ctx, `UPDATE lines SET cue_ms = cue_ms + ?
			WHERE id IN (`+songLines+`) AND cue_ms >= ? AND cue_ms < ?`,
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

// findLine checks a Line belongs to one of a Song's Sections, and returns
// its text and whether its Section is in the Arrangement.
func findLine(ctx context.Context, tx *sql.Tx, songID, lineID int64) (text string, inArrangement bool, err error) {
	err = tx.QueryRowContext(ctx, `SELECT l.text, s.position IS NOT NULL
		FROM lines l JOIN alternates a ON a.id = l.alternate_id JOIN sections s ON s.id = a.section_id
		WHERE l.id = ? AND s.song_id = ?`, lineID, songID).Scan(&text, &inArrangement)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, domain.ErrNotFound
	}
	return text, inArrangement, err
}

// blank is whether a Line's text is empty or only spaces, so has nothing to
// cue.
func blank(text string) bool {
	return strings.TrimSpace(text) == ""
}
