package timeline

import (
	"context"
	"database/sql"
	"fmt"
	"slices"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// ClipTempo is the Tempo to set on one of several Clips at once, as a
// ratio of as recorded.
type ClipTempo struct {
	ClipID int64   `json:"clipId"`
	Tempo  float64 `json:"tempo"`
}

// SetClipTempos sets how fast each of several Clips plays its audio, in one
// step. Each keeps its start and the stretch of its source it plays, so its
// length scales, and its Fades with it, staying on the same audio. Speeding
// a Clip up always fits. One slowed until it runs into the next Clip on its
// Track moves, keeping its start, onto a new Track right below its own,
// named as a Merge names one; those from one Track that no longer fit share
// such a Track where they fit together, else another goes below it. Clips
// that still fit stay put, and nothing else moves. If any Tempo can't be
// set, none is.
func (s *Store) SetClipTempos(ctx context.Context, songID int64, based songversion.Version, tempos []ClipTempo) (Timeline, error) {
	if len(tempos) == 0 {
		return Timeline{}, domain.Invalid("clips are required")
	}
	for i, t := range tempos {
		if slices.ContainsFunc(tempos[:i], func(o ClipTempo) bool { return o.ClipID == t.ClipID }) {
			return Timeline{}, domain.Invalid("each Clip's Tempo can only be set once")
		}
		if err := checkTempo(t.Tempo); err != nil {
			return Timeline{}, err
		}
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		type changed struct {
			clipID int64
			p      placement
		}
		var moving []changed
		for _, t := range tempos {
			p, err := clipPlacement(ctx, tx, songID, t.ClipID)
			if err != nil {
				return err
			}
			p = p.atTempo(t.Tempo)
			fits, err := fitsBeforeNext(ctx, tx, t.ClipID, p)
			if err != nil {
				return err
			}
			if !fits {
				moving = append(moving, changed{t.ClipID, p})
				continue
			}
			if err := store(ctx, tx, t.ClipID, p); err != nil {
				return err
			}
		}
		// In Timeline order, so each new Track takes the earliest that fit.
		slices.SortStableFunc(moving, func(a, b changed) int {
			if a.p.start < b.p.start {
				return -1
			}
			if a.p.start > b.p.start {
				return 1
			}
			return 0
		})
		// The new Tracks below each Track, top to bottom.
		below := map[int64][]int64{}
		for _, m := range moving {
			from := m.p.trackID
			landed := false
			for _, trackID := range below[from] {
				m.p.trackID = trackID
				free, err := isFree(ctx, tx, m.clipID, m.p)
				if err != nil {
					return err
				}
				if free {
					landed = true
					break
				}
			}
			if !landed {
				trackID, err := addTrackBelow(ctx, tx, songID, lastOr(below[from], from))
				if err != nil {
					return err
				}
				below[from] = append(below[from], trackID)
				m.p.trackID = trackID
			}
			if err := store(ctx, tx, m.clipID, m.p); err != nil {
				return err
			}
		}
		return nil
	})
}

// atTempo is p played at another Tempo: from the same start, the same
// stretch of its source, so its length, and its Fades, scale.
func (p placement) atTempo(tempo float64) placement {
	scale := p.tempo / tempo
	p.tempo = tempo
	p.length *= scale
	p.fades = Fades{In: p.fades.In * scale, Out: p.fades.Out * scale}
	return p
}

// fitsBeforeNext tells whether a Clip placed as p ends by the start of the
// next Clip on its Track, if there is one, as the Track is now.
func fitsBeforeNext(ctx context.Context, tx *sql.Tx, clipID int64, p placement) (bool, error) {
	var next sql.NullFloat64
	if err := tx.QueryRowContext(ctx, `SELECT MIN(start) FROM clips WHERE track_id = ? AND id != ? AND start > ?`,
		p.trackID, clipID, p.start+tolerance).Scan(&next); err != nil {
		return false, fmt.Errorf("finding the next clip: %w", err)
	}
	return !next.Valid || p.start+p.length <= next.Float64+tolerance, nil
}

// addTrackBelow adds an empty Track right below one of the Song's, named
// as a Merge names the Track it adds, "Track" and the number of Tracks with
// it, returning its id.
func addTrackBelow(ctx context.Context, tx *sql.Tx, songID, trackID int64) (int64, error) {
	var count, above int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*),
			COALESCE(SUM(position < (SELECT position FROM tracks WHERE id = ?1)
				OR (position = (SELECT position FROM tracks WHERE id = ?1) AND id <= ?1)), 0)
		FROM tracks WHERE song_id = ?2`, trackID, songID).Scan(&count, &above); err != nil {
		return 0, fmt.Errorf("reading tracks: %w", err)
	}
	return insertTrackAt(ctx, tx, songID, fmt.Sprintf("Track %d", count+1), &above, 0, false, false)
}

// lastOr is the last of ids, or else id.
func lastOr(ids []int64, id int64) int64 {
	if len(ids) == 0 {
		return id
	}
	return ids[len(ids)-1]
}

// checkTempo checks that a Clip's Tempo is from MinTempo to MaxTempo.
func checkTempo(tempo float64) error {
	if !(tempo >= MinTempo && tempo <= MaxTempo) {
		return domain.Invalid(fmt.Sprintf("a Clip's Tempo goes from %g%% to %g%%", MinTempo*100, MaxTempo*100))
	}
	return nil
}
