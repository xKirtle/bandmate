package timeline

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
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
	// extension. Left blank, it's the file's name without its extension.
	Name string `json:"name"`
}

// ImportSound makes an uploaded file one of the Song's Sounds, and places
// the whole of it in a new Clip on a Track, after its last Clip, or at 0:00
// if it has none. The file is kept if the Sound is added, and discarded
// otherwise.
func (s *Store) ImportSound(ctx context.Context, songID int64, based lyricsheet.Version, imp SoundImport,
	a audio.Upload, file *audio.Received) (Timeline, error) {
	defer file.Discard()
	if msg := a.Problem(); msg != "" {
		return Timeline{}, &lyricsheet.InvalidError{Msg: msg}
	}
	name := strings.TrimSpace(imp.Name)
	if name == "" {
		name = strings.TrimSpace(strings.TrimSuffix(a.FileName, filepath.Ext(a.FileName)))
	}
	if name == "" {
		// A name that's all extension, e.g. ".m4a".
		name = strings.TrimSpace(a.FileName)
	}
	if name == "" {
		name = "Sound"
	}
	peaks, err := json.Marshal(a.Peaks)
	if err != nil {
		return Timeline{}, err
	}
	var kept int64
	tl, err := s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if err := findTrack(ctx, tx, songID, imp.TrackID); errors.Is(err, lyricsheet.ErrNotFound) {
			return &lyricsheet.InvalidError{Msg: "there's no such Track on this Timeline"}
		} else if err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO sounds (song_id, name, file_name, content_type, size, duration,
				peaks, added_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			songID, name, a.FileName, a.MediaType(), file.Size, a.Duration, string(peaks),
			time.Now().UTC().Format(timeFormat))
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
		if err := addClip(ctx, tx, songID, imp.TrackID,
			NewClip{SoundID: &soundID, Start: start, Length: a.Duration}); err != nil {
			return err
		}
		// Kept last, so nothing after it can fail but the commit.
		if err := file.Keep(soundID); err != nil {
			return err
		}
		kept = soundID
		return nil
	})
	if err != nil && kept != 0 {
		if err := s.soundFiles.Remove(kept); err != nil {
			log.Printf("deleting sound %d: %v", kept, err)
		}
	}
	return tl, err
}

// findSound checks that a Sound is one of the Song's.
func findSound(ctx context.Context, tx *sql.Tx, songID, soundID int64) error {
	var found int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM sounds WHERE id = ? AND song_id = ?`, soundID, songID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return &lyricsheet.InvalidError{Msg: "there's no such Sound in this Song"}
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
		return Sound{}, lyricsheet.ErrNotFound
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
		return lyricsheet.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading sound: %w", err)
	}
	if download {
		audio.OfferToSave(w, fileName)
	}
	return s.soundFiles.Serve(w, r, soundID, contentType)
}
