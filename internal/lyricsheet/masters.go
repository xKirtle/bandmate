package lyricsheet

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
)

// Master is a finished recording of a Song made elsewhere, attached to the
// Song as a result rather than placed on the Timeline.
type Master struct {
	ID int64 `json:"id"`
	// Name tells a Song's Masters apart, e.g. "Radio edit". It starts as the
	// file's name.
	Name string `json:"name"`
	// Main marks the Song's main Master: exactly one of its Masters is.
	Main  bool   `json:"main"`
	Notes string `json:"notes"`
	// FileName and ContentType describe the file as uploaded, which is kept
	// unchanged.
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	// Size is the file's size in bytes.
	Size int64 `json:"size"`
	// Duration is in seconds.
	Duration float64 `json:"duration"`
	// Peaks is the waveform, as the browser computed it. The Song aggregate
	// leaves them out; GetMaster includes them.
	Peaks   []float64 `json:"peaks,omitempty"`
	AddedAt time.Time `json:"addedAt"`
}

// MasterDetails are what the user enters about a Master.
type MasterDetails struct {
	// Name defaults to the file's name without its extension.
	Name  string `json:"name"`
	Notes string `json:"notes"`
}

var errMasterNameRequired = invalid("a Master's name is required")

// AddMaster attaches an uploaded file to a Song as a new Master. A Song's
// first Master is its main one. The file is kept if the Master is added,
// and discarded otherwise. The Song's Status is left alone: whether it is
// finished is for the user to say.
func (s *Store) AddMaster(ctx context.Context, songID int64, based Version, details MasterDetails, up audio.Upload, file *audio.Received) (Song, error) {
	defer file.Discard()
	if msg := up.Problem(); msg != "" {
		return Song{}, invalid(msg)
	}
	name := strings.TrimSpace(details.Name)
	if name == "" {
		name = strings.TrimSpace(strings.TrimSuffix(up.FileName, filepath.Ext(up.FileName)))
	}
	if name == "" {
		name = "Master"
	}
	peaks, err := json.Marshal(up.Peaks)
	if err != nil {
		return Song{}, err
	}
	var kept int64
	err = s.changeTx(ctx, songID, based, func(tx *sql.Tx) error {
		var hasMain bool
		if err := tx.QueryRowContext(ctx,
			`SELECT EXISTS (SELECT 1 FROM masters WHERE song_id = ? AND main = 1)`, songID).Scan(&hasMain); err != nil {
			return fmt.Errorf("checking main master: %w", err)
		}
		id, err := insert(ctx, tx,
			`INSERT INTO masters (song_id, name, main, notes, file_name, content_type, size, duration, peaks, added_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			songID, name, !hasMain, details.Notes, up.FileName, up.MediaType(), file.Size, up.Duration,
			string(peaks), time.Now().UTC().Format(timeFormat))
		if err != nil {
			return fmt.Errorf("adding master: %w", err)
		}
		// Kept last, so nothing after it can fail but the commit.
		if err := file.Keep(id); err != nil {
			return err
		}
		kept = id
		return nil
	})
	if err != nil {
		if kept != 0 {
			s.masterFiles.Remove(kept)
		}
		return Song{}, err
	}
	return s.GetSong(ctx, songID)
}

// masterColumns are the masters columns scanMaster reads, in its order.
const masterColumns = `id, name, main, notes, file_name, content_type, size, duration, added_at`

// scanMaster reads one row of masterColumns. Columns selected after them
// are read into extra.
func scanMaster(row interface{ Scan(...any) error }, extra ...any) (Master, error) {
	var m Master
	var added string
	err := row.Scan(append([]any{&m.ID, &m.Name, &m.Main, &m.Notes, &m.FileName, &m.ContentType, &m.Size,
		&m.Duration, &added}, extra...)...)
	if err != nil {
		return Master{}, err
	}
	if m.AddedAt, err = parseTime(added); err != nil {
		return Master{}, err
	}
	return m, nil
}

// loadMasters reads a Song's Masters, without their peaks, in the order
// they were added.
func loadMasters(ctx context.Context, q queryer, songID int64) ([]Master, error) {
	masters := []Master{}
	err := query(ctx, q, `SELECT `+masterColumns+` FROM masters WHERE song_id = ? ORDER BY id`, []any{songID},
		func(rows *sql.Rows) error {
			m, err := scanMaster(rows)
			if err != nil {
				return err
			}
			masters = append(masters, m)
			return nil
		})
	if err != nil {
		return nil, fmt.Errorf("reading masters: %w", err)
	}
	return masters, nil
}

// GetMaster returns one of a Song's Masters, with its peaks.
func (s *Store) GetMaster(ctx context.Context, songID, masterID int64) (Master, error) {
	var peaks string
	m, err := scanMaster(s.db.QueryRowContext(ctx,
		`SELECT `+masterColumns+`, peaks FROM masters WHERE id = ? AND song_id = ?`, masterID, songID), &peaks)
	if errors.Is(err, sql.ErrNoRows) {
		return Master{}, ErrNotFound
	}
	if err != nil {
		return Master{}, fmt.Errorf("reading master: %w", err)
	}
	if err := json.Unmarshal([]byte(peaks), &m.Peaks); err != nil {
		return Master{}, fmt.Errorf("reading peaks of master %d: %w", masterID, err)
	}
	return m, nil
}

// MasterChanges is a partial update to a Master's details. Fields not Set
// are unchanged.
type MasterChanges struct {
	Name  Change[string] `json:"name"`
	Notes Change[string] `json:"notes"`
}

// UpdateMaster changes a Master's name or notes.
func (s *Store) UpdateMaster(ctx context.Context, songID int64, based Version, masterID int64, changes MasterChanges) (Song, error) {
	var sets []string
	var args []any
	if c := changes.Name; c.Set {
		name := strings.TrimSpace(c.Value)
		if name == "" {
			return Song{}, errMasterNameRequired
		}
		sets, args = append(sets, "name = ?"), append(args, name)
	}
	if c := changes.Notes; c.Set {
		sets, args = append(sets, "notes = ?"), append(args, c.Value)
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if len(sets) == 0 {
			return findMaster(ctx, tx, songID, masterID)
		}
		res, err := tx.ExecContext(ctx, `UPDATE masters SET `+strings.Join(sets, ", ")+` WHERE id = ? AND song_id = ?`,
			append(args, masterID, songID)...)
		if err != nil {
			return fmt.Errorf("updating master: %w", err)
		}
		return expectOneRow(res)
	})
}

// MakeMainMaster makes a Master the Song's main one, in place of the one
// before.
func (s *Store) MakeMainMaster(ctx context.Context, songID int64, based Version, masterID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if err := findMaster(ctx, tx, songID, masterID); err != nil {
			return err
		}
		// Cleared first: a Song never has two main Masters, even for a moment.
		if _, err := tx.ExecContext(ctx, `UPDATE masters SET main = 0 WHERE song_id = ? AND main = 1`, songID); err != nil {
			return fmt.Errorf("changing main master: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE masters SET main = 1 WHERE id = ?`, masterID); err != nil {
			return fmt.Errorf("changing main master: %w", err)
		}
		return nil
	})
}

// DeleteMaster removes a Master and its file. If it was the main Master,
// the earliest added of the others becomes main.
func (s *Store) DeleteMaster(ctx context.Context, songID int64, based Version, masterID int64) (Song, error) {
	err := s.changeTx(ctx, songID, based, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM masters WHERE id = ? AND song_id = ?`, masterID, songID)
		if err != nil {
			return fmt.Errorf("deleting master: %w", err)
		}
		if err := expectOneRow(res); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx,
			`UPDATE masters SET main = 1
			 WHERE id = (SELECT MIN(id) FROM masters WHERE song_id = ?1)
			   AND NOT EXISTS (SELECT 1 FROM masters WHERE song_id = ?1 AND main = 1)`, songID)
		if err != nil {
			return fmt.Errorf("choosing main master: %w", err)
		}
		return nil
	})
	if err != nil {
		return Song{}, err
	}
	s.removeMasterFiles([]int64{masterID})
	return s.GetSong(ctx, songID)
}

// ServeMaster answers a request for a Master's audio file, with Range
// support. A download is offered to save under the uploaded file's name
// rather than played.
func (s *Store) ServeMaster(w http.ResponseWriter, r *http.Request, songID, masterID int64, download bool) error {
	var fileName, contentType string
	err := s.db.QueryRowContext(r.Context(),
		`SELECT file_name, content_type FROM masters WHERE id = ? AND song_id = ?`, masterID, songID).
		Scan(&fileName, &contentType)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading master: %w", err)
	}
	if download {
		audio.OfferToSave(w, fileName)
	}
	return s.masterFiles.Serve(w, r, masterID, contentType)
}

// removeMasterFiles deletes the files of Masters already gone from the
// database. A file left behind only takes space, so failures are logged.
func (s *Store) removeMasterFiles(ids []int64) {
	for _, id := range ids {
		if err := s.masterFiles.Remove(id); err != nil {
			log.Printf("deleting master %d: %v", id, err)
		}
	}
}

// findMaster checks a Master belongs to the Song.
func findMaster(ctx context.Context, q queryer, songID, masterID int64) error {
	var exists bool
	if err := q.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM masters WHERE id = ? AND song_id = ?)`,
		masterID, songID).Scan(&exists); err != nil {
		return fmt.Errorf("finding master: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}
