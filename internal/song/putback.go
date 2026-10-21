package song

import (
	"context"

	"github.com/xKirtle/bandmate/internal/songversion"
)

// PutSheetBack makes a Song's Lyric Sheet and Scrapbook a copy of them as
// they were, in one change, as Undo and Redo do (ADR 0019). It's restoring
// a Snapshot without the Snapshot: rows still there keep their ids, and a
// Line still there its Cue as it is now; rows the copy brings back come
// back with their ids and Cues; rows it doesn't hold are deleted. It takes
// no Snapshot of its own, but starts an editing session like any change
// to the sheet. A copy that isn't a sheet of this Song is refused.
func (s *Store) PutSheetBack(ctx context.Context, songID int64, based songversion.Version, sheet LyricSheet) (Song, error) {
	return s.editSheet(ctx, songID, based, noReason, func(current LyricSheet, _ *ids) (LyricSheet, error) {
		// The copy comes from outside, so it's checked as given too, Cues
		// it won't put back included.
		if err := checkChange(current, sheet); err != nil {
			return LyricSheet{}, err
		}
		return keepCurrentCues(current, sheet), nil
	})
}

// keepCurrentCues is a copy of a sheet as it was, put back over current,
// with each Line still in current given the Cue it has there: Cues' own
// history is kept in the browser. A Line the copy brings back keeps the
// Cue it had.
func keepCurrentCues(current, copied LyricSheet) LyricSheet {
	now := indexSheet(current).lines
	sheet := cloneSheet(copied)
	for _, sec := range sheet.Sections {
		for _, alt := range sec.Alternates {
			for i, l := range alt.Lines {
				if was, there := now[l.ID]; there {
					alt.Lines[i].Cue = copyCue(was.Cue)
				}
			}
		}
	}
	return sheet
}
