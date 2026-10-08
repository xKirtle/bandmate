// Package songversion is a Song's version: what every change to a Song is
// based on, how a change moves it on, and the refusal of a change based on
// one that's out of date. Every package that changes part of a Song uses it,
// so none of them needs another's just for the version.
package songversion

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/xKirtle/bandmate/internal/domain"
)

// Version counts the changes to a Song: its metadata, Status, Lyric Sheet or
// Timeline. It only guards against overwriting newer work, and is no
// Snapshot: older versions aren't kept.
//
// Every change takes the version it was based on and fails with ErrStale if
// the Song has changed since. Any applies the change regardless.
type Version int64

// Any skips the version check.
const Any Version = 0

// ErrStale means a change was based on a version of the Song that is no
// longer current: the Song changed in the meantime, e.g. from another tab.
// Its code tells it apart from other conflicts, so the client can offer to
// reload the Song.
var ErrStale = domain.CodedConflict("stale", "this Song changed elsewhere, so the change wasn't saved", nil)

// Expect checks that a change based on based can apply to a Song at current,
// failing with ErrStale if not, for a change that writes nothing.
func Expect(based, current Version) error {
	if based != Any && current != based {
		return ErrStale
	}
	return nil
}

// Touch marks a Song as edited within tx, giving it a new version. It fails
// with ErrStale if the Song is no longer at the version the change was based
// on, and domain.ErrNotFound if there is no such Song.
func Touch(ctx context.Context, tx *sql.Tx, songID int64, based Version) error {
	res, err := tx.ExecContext(ctx,
		`UPDATE songs SET updated_at = ?, version = version + 1 WHERE id = ? AND (?3 = 0 OR version = ?3)`,
		time.Now().UTC().Format(domain.TimeFormat), songID, based)
	if err != nil {
		return fmt.Errorf("touching song: %w", err)
	}
	return ExpectCurrent(ctx, tx, res, songID)
}

// ExpectCurrent checks that a write to a Song, guarded by the version it
// was based on, matched the Song. If not, the Song is gone
// (domain.ErrNotFound) or has moved on to a newer version (ErrStale).
func ExpectCurrent(ctx context.Context, db domain.Queryer, res sql.Result, songID int64) error {
	if err := domain.ExpectOneRow(res); !errors.Is(err, domain.ErrNotFound) {
		return err
	}
	var exists bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM songs WHERE id = ?)`, songID).Scan(&exists); err != nil {
		return fmt.Errorf("checking song: %w", err)
	}
	if exists {
		return ErrStale
	}
	return domain.ErrNotFound
}
