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
// name and Gain; the left keeps the fade in and the right the fade out,
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
	return s.changeWithFiles(ctx, songID, based, func(tx *sql.Tx, changes *audio.FileChanges) error {
		for _, id := range clipIDs {
			if err := s.splitClip(ctx, tx, changes, songID, id, at); err != nil {
				return err
			}
		}
		return nil
	})
}

// splitClip cuts one of the Song's Clips in two at a time, as SplitClips
// does, with the Take files to link added to changes.
func (s *Store) splitClip(ctx context.Context, tx *sql.Tx, changes *audio.FileChanges, songID, clipID int64, at float64) error {
	p, err := clipPlacement(ctx, tx, songID, clipID)
	if err != nil {
		return err
	}
	cut := at - p.start
	if cut <= tolerance || cut >= p.length-tolerance {
		return domain.Invalid("a Clip is only split where the playhead crosses it")
	}
	right := p
	right.start, right.offset, right.length = at, p.sourceAt(at), p.length-cut
	right.fades = Fades{In: 0, Out: min(p.fades.Out, right.length)}
	left := p
	left.length = cut
	left.fades = Fades{In: min(p.fades.In, cut), Out: 0}
	// The left half only shrinks, so it's clear of the others, and the
	// right half plays where the Clip did.
	if err := store(ctx, tx, clipID, left); err != nil {
		return err
	}
	return s.insertCopy(ctx, tx, changes, right)
}
