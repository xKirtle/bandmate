package timeline

import (
	"context"
	"database/sql"
	"slices"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// SplitClips cuts each of the Clips in two at a time on the Timeline,
// which must cross each, not touch its edge. The Clip becomes the left
// half, ending at the cut, and a new Clip the right half, from the cut on,
// so playing across the cut is as before. Both keep the Clip's source,
// name, Gain, Tempo and Pitch; the left keeps the fade in and the right the fade out,
// each shortened to end at the cut, which gets no Fade. A Clip of Takes
// splits like a Duplicate: the right half gets copies of its Takes,
// sharing their files. If any can't be split, none is.
func (s *Store) SplitClips(ctx context.Context, songID int64, based songversion.Version, clipIDs []int64,
	at float64) (Timeline, error) {
	if len(clipIDs) == 0 {
		return Timeline{}, domain.Invalid("clipIds are required")
	}
	for i, id := range clipIDs {
		if slices.Contains(clipIDs[:i], id) {
			return Timeline{}, domain.Invalid("each Clip can only be split once")
		}
	}
	return s.editTimelineReading(ctx, songID, based,
		func(ctx context.Context, tx *sql.Tx, changes *audio.FileChanges, before Timeline) (edit, error) {
			// The right half of a Clip of Takes gets copies of its Takes,
			// stored with their files before the edit places them.
			copied := make([]splitTakes, len(clipIDs))
			for i, id := range clipIDs {
				_, c, err := before.findClip(id)
				if err != nil {
					return nil, err
				}
				if copied[i].takes, copied[i].active, err = s.copyTakesOf(ctx, tx, changes, c); err != nil {
					return nil, err
				}
			}
			return func(tl Timeline, ids *ids) (Timeline, error) {
				var err error
				for i, id := range clipIDs {
					if tl, err = tl.splitting(id, at, ids.clip(), copied[i]); err != nil {
						return Timeline{}, err
					}
				}
				return tl, nil
			}, nil
		})
}

// splitTakes are the copies of a Clip of Takes' Takes that its right half
// gets, and the one of them it plays: none for a Clip of a Beat or a Sound.
type splitTakes struct {
	takes  []Take
	active *int64
}
