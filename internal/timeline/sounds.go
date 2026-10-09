package timeline

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// Sound is an audio file imported into one Song, placed in Clips like a
// Beat, but without a credit or a library. Its file is kept exactly as
// uploaded (ADR 0003).
type Sound struct {
	ID int64 `json:"id"`
	// Name comes from the file when it's imported, and never changes.
	Name string `json:"name"`
	// FileName is the file's name as uploaded, Size its size in bytes and
	// Duration its length in seconds.
	FileName string  `json:"fileName"`
	Size     int64   `json:"size"`
	Duration float64 `json:"duration"`
	// Peaks is the waveform, as the browser computed it. The Timeline
	// leaves them out; GetSound includes them.
	Peaks []float64 `json:"peaks,omitempty"`
}

// SoundImport is where an imported Sound goes and what it's called, as the
// browser sends it with the file.
type SoundImport struct {
	TrackID int64 `json:"trackId"`
	// Name is the file's title tag, or else its name without its
	// extension. Left blank, it's named as audio.Upload.Name says.
	Name string `json:"name"`
}

// ImportSound makes an uploaded file one of the Song's Sounds, and places
// the whole of it in a new Clip on a Track, after its last Clip, or at 0:00
// if it has none. The file is kept if the Sound is added, and discarded
// otherwise.
func (s *Store) ImportSound(ctx context.Context, songID int64, based songversion.Version, imp SoundImport,
	a audio.Upload, file *audio.Received) (Timeline, error) {
	defer file.Discard()
	if msg := a.Problem(); msg != "" {
		return Timeline{}, domain.Invalid(msg)
	}
	name := a.Name(imp.Name, "Sound")
	peaks, err := json.Marshal(a.Peaks)
	if err != nil {
		return Timeline{}, err
	}
	return s.changeWithFiles(ctx, songID, based, func(tx *sql.Tx, changes *audio.FileChanges) error {
		if err := findTrack(ctx, tx, songID, imp.TrackID); errors.Is(err, domain.ErrNotFound) {
			return domain.Invalid("there's no such Track on this Timeline")
		} else if err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO sounds (song_id, name, file_name, content_type, size, duration,
				peaks, added_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			songID, name, a.FileName, a.MediaType(), file.Size, a.Duration, string(peaks),
			time.Now().UTC().Format(domain.TimeFormat))
		if err != nil {
			return fmt.Errorf("adding sound: %w", err)
		}
		soundID, err := res.LastInsertId()
		if err != nil {
			return err
		}
		start, err := trackEnd(ctx, tx, imp.TrackID)
		if err != nil {
			return err
		}
		changes.Keep(file, soundID)
		return addClip(ctx, tx, songID, imp.TrackID, NewClip{SoundID: &soundID, Tempo: 1, Start: start, Length: a.Duration})
	})
}

// soundsInUse selects the ids of the Sounds some Clip uses.
const soundsInUse = `SELECT sound_id FROM clips WHERE sound_id IS NOT NULL`

// markUnusedSounds notes when the Song's Sounds that no Clip uses any more
// stopped being used, and that those a Clip uses again are in use.
func markUnusedSounds(ctx context.Context, tx *sql.Tx, songID int64) error {
	if _, err := tx.ExecContext(ctx, `UPDATE sounds SET unused_since = ?
		WHERE song_id = ? AND unused_since IS NULL AND id NOT IN (`+soundsInUse+`)`,
		time.Now().UTC().Format(domain.TimeFormat), songID); err != nil {
		return fmt.Errorf("marking unused sounds: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE sounds SET unused_since = NULL
		WHERE song_id = ? AND unused_since IS NOT NULL AND id IN (`+soundsInUse+`)`,
		songID); err != nil {
		return fmt.Errorf("marking used sounds: %w", err)
	}
	return nil
}

// SweepUnusedSounds removes the Sounds no Clip has used since before a
// time, of every Song, with their files. Undo can only place a Sound's Clip
// again within the session it was deleted in, so a Sound unused for long
// enough is gone for good.
func (s *Store) SweepUnusedSounds(ctx context.Context, before time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var ids []int64
	err = query(ctx, tx, `SELECT id FROM sounds WHERE unused_since < ? AND id NOT IN (`+soundsInUse+`)`,
		[]any{before.UTC().Format(domain.TimeFormat)}, func(rows *sql.Rows) error {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
			return nil
		})
	if err != nil {
		return fmt.Errorf("listing unused sounds: %w", err)
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `DELETE FROM sounds WHERE id = ?`, id); err != nil {
			return fmt.Errorf("sweeping sound: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.removeSoundFiles(ids)
	return nil
}

// removeSoundFiles deletes the files of Sounds that aren't in the database.
// A file left behind only takes space, so failures are logged.
func (s *Store) removeSoundFiles(ids []int64) {
	for _, id := range ids {
		if err := s.soundFiles.Remove(id); err != nil {
			log.Printf("deleting sound %d: %v", id, err)
		}
	}
}

// findSound checks that a Sound is one of the Song's.
func findSound(ctx context.Context, tx *sql.Tx, songID, soundID int64) error {
	var found int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM sounds WHERE id = ? AND song_id = ?`, soundID, songID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Invalid("there's no such Sound in this Song")
	}
	if err != nil {
		return fmt.Errorf("reading sound: %w", err)
	}
	return nil
}

// GetSound returns one of a Song's Sounds, with its peaks.
func (s *Store) GetSound(ctx context.Context, songID, soundID int64) (Sound, error) {
	var snd Sound
	var peaks string
	err := s.db.QueryRowContext(ctx, `SELECT id, name, file_name, size, duration, peaks FROM sounds
		WHERE id = ? AND song_id = ?`, soundID, songID).
		Scan(&snd.ID, &snd.Name, &snd.FileName, &snd.Size, &snd.Duration, &peaks)
	if errors.Is(err, sql.ErrNoRows) {
		return Sound{}, domain.ErrNotFound
	}
	if err != nil {
		return Sound{}, fmt.Errorf("reading sound: %w", err)
	}
	if err := json.Unmarshal([]byte(peaks), &snd.Peaks); err != nil {
		return Sound{}, fmt.Errorf("reading sound peaks: %w", err)
	}
	return snd, nil
}

// ServeSound answers a request for one of a Song's Sounds' audio file,
// exactly as uploaded, with Range support. A download is offered to save
// under the file's name as uploaded, rather than played.
func (s *Store) ServeSound(w http.ResponseWriter, r *http.Request, songID, soundID int64, download bool) error {
	var fileName, contentType string
	err := s.db.QueryRowContext(r.Context(), `SELECT file_name, content_type FROM sounds WHERE id = ? AND song_id = ?`,
		soundID, songID).Scan(&fileName, &contentType)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading sound: %w", err)
	}
	if download {
		audio.OfferToSave(w, fileName)
	}
	return s.soundFiles.Serve(w, r, soundID, contentType)
}
