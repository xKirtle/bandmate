package backups

import (
	"context"
	"database/sql"
	"fmt"
	"os"

	"github.com/xKirtle/bandmate/internal/songfiles"
)

// PutDemoBack restores the Demo from file, the built-in Backup's file
// holding the Demo Song and the Demo Beat its Clips use (ADR 0020), and
// returns the Demo Song's id. It replaces the Demo in Bandmate, whatever it
// is now, so the Demo is always as this Bandmate built it. What it restores
// is marked as the Demo, which leaves it out of every list, count and
// Backup of the user's Songs and Beats. A file holding other than one Song
// is refused.
func (s *Store) PutDemoBack(ctx context.Context, file []byte) (int64, error) {
	// Two at once would each delete the Demo before restoring their own.
	s.demo.Lock()
	defer s.demo.Unlock()
	// Named as a Backup being made, so one left by a crash is removed.
	f, err := os.CreateTemp(s.dir, makingPrefix+"*"+FileExtension)
	if err != nil {
		return 0, fmt.Errorf("putting the demo back: %w", err)
	}
	defer os.Remove(f.Name())
	_, err = f.Write(file)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return 0, fmt.Errorf("putting the demo back: %w", err)
	}
	r, err := s.openFile(ctx, f.Name())
	if err != nil {
		return 0, fmt.Errorf("opening the built-in demo: %w", err)
	}
	defer r.Close()
	songs, err := queryIDs(ctx, r.db, `SELECT id FROM songs`)
	if err != nil {
		return 0, err
	}
	if len(songs) != 1 {
		return 0, fmt.Errorf("the built-in demo holds %d songs, not one", len(songs))
	}
	restored, err := r.restore(ctx, Picks{Songs: songs}, Replace{}, true)
	if err != nil {
		return 0, fmt.Errorf("putting the demo back: %w", err)
	}
	return restored.Songs[0].ID, nil
}

// clearDemo deletes the Demo Song, with everything it owns, and the Demo
// Beat, and returns the files they had, as paths in the data directory, to
// remove once that's committed. A Demo Beat a Song of the user's somehow
// uses is theirs from then on, so it's kept, and shows in the Beat Library.
func clearDemo(ctx context.Context, tx *sql.Tx) ([]string, error) {
	songs, err := queryIDs(ctx, tx, `SELECT id FROM main.songs WHERE demo`)
	if err != nil {
		return nil, err
	}
	files, err := filesOwnedBy(ctx, tx, songs)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM main.songs WHERE demo`); err != nil {
		return nil, fmt.Errorf("clearing the demo song: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE main.beats SET demo = 0
		WHERE demo AND id IN (SELECT beat_id FROM main.clips WHERE beat_id IS NOT NULL)`); err != nil {
		return nil, fmt.Errorf("keeping the demo beat a song uses: %w", err)
	}
	beats, err := queryIDs(ctx, tx, `SELECT id FROM main.beats WHERE demo`)
	if err != nil {
		return nil, err
	}
	for _, id := range beats {
		files = append(files, dataPath(songfiles.Beats, id))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM main.beats WHERE demo`); err != nil {
		return nil, fmt.Errorf("clearing the demo beat: %w", err)
	}
	return files, nil
}

// markDemo marks the Songs and Beats just restored as the Demo. Each gets
// an identity of its own, so a Restore never takes a Song or Beat it brings
// back for the Demo, even one restored from a copy of the built-in Backup.
func markDemo(ctx context.Context, tx *sql.Tx) error {
	for _, table := range []string{"songs", "beats"} {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf(`UPDATE main.%[1]s
			SET demo = 1, identity = lower(hex(randomblob(16)))
			WHERE id IN (SELECT new FROM temp.restored WHERE tbl = '%[1]s')`, table)); err != nil {
			return fmt.Errorf("marking the demo: %w", err)
		}
	}
	return nil
}
