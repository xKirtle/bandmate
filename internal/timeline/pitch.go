package timeline

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"slices"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// ClipPitch is the Pitch to set on one of several Clips at once, in
// semitones.
type ClipPitch struct {
	ClipID int64    `json:"clipId"`
	Pitch  *float64 `json:"pitch"`
}

// SetClipPitches sets how many semitones each of several Clips' audio is
// moved up or down, in one step. Nothing else about a Clip changes: it
// keeps its place, its length, its Tempo and its Fades. If any Pitch can't
// be set, none is.
func (s *Store) SetClipPitches(ctx context.Context, songID int64, based songversion.Version, pitches []ClipPitch) (Timeline, error) {
	if len(pitches) == 0 {
		return Timeline{}, domain.Invalid("clips are required")
	}
	for i, p := range pitches {
		if slices.ContainsFunc(pitches[:i], func(o ClipPitch) bool { return o.ClipID == p.ClipID }) {
			return Timeline{}, domain.Invalid("each Clip's Pitch can only be set once")
		}
		if p.Pitch == nil {
			return Timeline{}, domain.Invalid("each Clip's pitch is required")
		}
		if err := checkPitch(*p.Pitch); err != nil {
			return Timeline{}, err
		}
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		for _, p := range pitches {
			if _, err := clipPlacement(ctx, tx, songID, p.ClipID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE clips SET pitch = ? WHERE id = ?`, *p.Pitch, p.ClipID); err != nil {
				return fmt.Errorf("setting pitch: %w", err)
			}
		}
		return nil
	})
}

// checkPitch checks that a Clip's Pitch is a whole number of semitones from
// MinPitch to MaxPitch.
func checkPitch(pitch float64) error {
	if !(pitch >= MinPitch && pitch <= MaxPitch) || pitch != math.Trunc(pitch) {
		return domain.Invalid(fmt.Sprintf("a Clip's Pitch is a whole number of semitones from %d to +%d", MinPitch, MaxPitch))
	}
	return nil
}
