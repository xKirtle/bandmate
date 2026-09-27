// Package timeline owns a Song's Timeline: its Tracks and the Clips on them.
// All its rules live here; the HTTP layer only maps requests onto these
// operations. Every change marks the Song as edited and returns the full,
// updated Timeline.
package timeline

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// Timeline is a Song's audio space, measured in seconds.
type Timeline struct {
	SongID int64 `json:"songId"`
	// Version and UpdatedAt are the Song's, which every Timeline change
	// moves on.
	Version   lyricsheet.Version `json:"version"`
	UpdatedAt time.Time          `json:"updatedAt"`
	// Tracks are top to bottom.
	Tracks []Track `json:"tracks"`
	// Beats are the Beats the Clips play, each once, without their peaks.
	Beats []Beat `json:"beats"`
}

// Track is a named lane on the Timeline holding Clips.
type Track struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	// Clips are in the order they start, and never overlap.
	Clips []Clip `json:"clips"`
}

// Clip is a stretch of a Beat placed on a Track. Trimming it never changes
// the Beat's file.
type Clip struct {
	ID     int64 `json:"id"`
	BeatID int64 `json:"beatId"`
	// Start is where the Clip starts on the Timeline, Offset where in the
	// Beat it starts playing, and Length how long it plays, all in seconds.
	Start  float64 `json:"start"`
	Offset float64 `json:"offset"`
	Length float64 `json:"length"`
}

// Beat is what playing a Clip needs to know about its Beat.
type Beat struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
	BPM   *int   `json:"bpm"`
	// FileName, Size and Duration (in seconds) tell the audio file's
	// versions apart.
	FileName string  `json:"fileName"`
	Size     int64   `json:"size"`
	Duration float64 `json:"duration"`
}

// timeFormat is how songs.updated_at is stored.
const timeFormat = "2006-01-02T15:04:05.000000000Z"

// beatTrackName is the name of the Track a Song's first Beat goes on.
const beatTrackName = "Beat"

// Store reads and changes Timelines.
type Store struct {
	db *sql.DB
}

// NewStore returns a Store backed by db.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Get returns a Song's Timeline.
func (s *Store) Get(ctx context.Context, songID int64) (Timeline, error) {
	// Read in one transaction, so the version matches what's read with it.
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return Timeline{}, err
	}
	defer tx.Rollback()
	return read(ctx, tx, songID)
}

// read returns a Song's Timeline as tx sees it.
func read(ctx context.Context, tx *sql.Tx, songID int64) (Timeline, error) {
	tl := Timeline{SongID: songID, Tracks: []Track{}, Beats: []Beat{}}
	var updated string
	err := tx.QueryRowContext(ctx, `SELECT version, updated_at FROM songs WHERE id = ?`, songID).
		Scan(&tl.Version, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Timeline{}, lyricsheet.ErrNotFound
	}
	if err != nil {
		return Timeline{}, fmt.Errorf("reading song: %w", err)
	}
	if tl.UpdatedAt, err = time.Parse(timeFormat, updated); err != nil {
		return Timeline{}, fmt.Errorf("parsing stored time %q: %w", updated, err)
	}

	trackAt := map[int64]int{}
	err = query(ctx, tx, `SELECT id, name FROM tracks WHERE song_id = ? ORDER BY position, id`, []any{songID},
		func(rows *sql.Rows) error {
			t := Track{Clips: []Clip{}}
			if err := rows.Scan(&t.ID, &t.Name); err != nil {
				return err
			}
			trackAt[t.ID] = len(tl.Tracks)
			tl.Tracks = append(tl.Tracks, t)
			return nil
		})
	if err != nil {
		return Timeline{}, fmt.Errorf("reading tracks: %w", err)
	}

	err = query(ctx, tx, `SELECT c.id, c.track_id, c.beat_id, c.start, c.source_offset, c.length
		FROM clips c JOIN tracks t ON t.id = c.track_id
		WHERE t.song_id = ? ORDER BY c.start, c.id`, []any{songID},
		func(rows *sql.Rows) error {
			var c Clip
			var trackID int64
			if err := rows.Scan(&c.ID, &trackID, &c.BeatID, &c.Start, &c.Offset, &c.Length); err != nil {
				return err
			}
			t := &tl.Tracks[trackAt[trackID]]
			t.Clips = append(t.Clips, c)
			return nil
		})
	if err != nil {
		return Timeline{}, fmt.Errorf("reading clips: %w", err)
	}

	err = query(ctx, tx, `SELECT id, title, bpm, file_name, size, duration FROM beats
		WHERE id IN (SELECT c.beat_id FROM clips c JOIN tracks t ON t.id = c.track_id WHERE t.song_id = ?)
		ORDER BY id`, []any{songID},
		func(rows *sql.Rows) error {
			var b Beat
			var bpm sql.NullInt64
			if err := rows.Scan(&b.ID, &b.Title, &bpm, &b.FileName, &b.Size, &b.Duration); err != nil {
				return err
			}
			if bpm.Valid {
				n := int(bpm.Int64)
				b.BPM = &n
			}
			tl.Beats = append(tl.Beats, b)
			return nil
		})
	if err != nil {
		return Timeline{}, fmt.Errorf("reading beats: %w", err)
	}
	return tl, nil
}

// AddBeat places the whole of a Beat on the Song's beat Track: the topmost
// Track already holding a Clip of a Beat, or else a new Track named "Beat"
// at the bottom. The Clip goes after the Track's last Clip, or at 0:00.
func (s *Store) AddBeat(ctx context.Context, songID int64, based lyricsheet.Version, beatID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		var duration float64
		err := tx.QueryRowContext(ctx, `SELECT duration FROM beats WHERE id = ?`, beatID).Scan(&duration)
		if errors.Is(err, sql.ErrNoRows) {
			return &lyricsheet.InvalidError{Msg: "there's no such Beat in the Beat Library"}
		}
		if err != nil {
			return fmt.Errorf("reading beat: %w", err)
		}
		trackID, err := beatTrack(ctx, tx, songID)
		if err != nil {
			return err
		}
		var start float64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(start + length), 0) FROM clips WHERE track_id = ?`,
			trackID).Scan(&start); err != nil {
			return fmt.Errorf("finding the end of the track: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO clips (track_id, beat_id, start, source_offset, length) VALUES (?, ?, ?, 0, ?)`,
			trackID, beatID, start, duration); err != nil {
			return fmt.Errorf("adding clip: %w", err)
		}
		return nil
	})
}

// beatTrack returns the Song's beat Track, creating it if there is none.
func beatTrack(ctx context.Context, tx *sql.Tx, songID int64) (int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT t.id FROM tracks t
		WHERE t.song_id = ? AND EXISTS (SELECT 1 FROM clips c WHERE c.track_id = t.id AND c.beat_id IS NOT NULL)
		ORDER BY t.position, t.id LIMIT 1`, songID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("finding the beat track: %w", err)
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO tracks (song_id, name, position)
		VALUES (?1, ?2, (SELECT COALESCE(MAX(position) + 1, 0) FROM tracks WHERE song_id = ?1))`,
		songID, beatTrackName)
	if err != nil {
		return 0, fmt.Errorf("adding the beat track: %w", err)
	}
	return res.LastInsertId()
}

// RenameTrack changes a Track's name, which can't be blank.
func (s *Store) RenameTrack(ctx context.Context, songID int64, based lyricsheet.Version, trackID int64, name string) (Timeline, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "a Track's name is required"}
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE tracks SET name = ? WHERE id = ? AND song_id = ?`, name, trackID, songID)
		if err != nil {
			return fmt.Errorf("renaming track: %w", err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if n == 0 {
			return lyricsheet.ErrNotFound
		}
		return nil
	})
}

// change runs one change to a Song's Timeline in a transaction, marks the
// Song as edited, and returns the updated Timeline. If the Song is no longer
// at the version the change was based on, or fn fails, nothing changes.
func (s *Store) change(ctx context.Context, songID int64, based lyricsheet.Version, fn func(tx *sql.Tx) error) (Timeline, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Timeline{}, err
	}
	defer tx.Rollback()
	if err := lyricsheet.Touch(ctx, tx, songID, based); err != nil {
		return Timeline{}, err
	}
	if err := fn(tx); err != nil {
		return Timeline{}, err
	}
	tl, err := read(ctx, tx, songID)
	if err != nil {
		return Timeline{}, err
	}
	return tl, tx.Commit()
}

// query runs a query and calls row for each result row.
func query(ctx context.Context, tx *sql.Tx, stmt string, args []any, row func(*sql.Rows) error) error {
	rows, err := tx.QueryContext(ctx, stmt, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := row(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}
