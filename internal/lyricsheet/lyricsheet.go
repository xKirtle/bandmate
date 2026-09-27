// Package lyricsheet owns a Song and its Lyric Sheet as one aggregate and
// exposes intent-level operations on it. All domain rules live here; the HTTP
// layer only maps requests onto these operations.
package lyricsheet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrNotFound means the requested Song doesn't exist.
var ErrNotFound = errors.New("not found")

// InvalidError is a rejected operation. Its message is safe to show the user.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

func invalid(msg string) error { return &InvalidError{Msg: msg} }

// Status is where a Song stands in its lifecycle.
type Status string

const (
	StatusIdea     Status = "idea"
	StatusDrafting Status = "drafting"
	StatusFinished Status = "finished"
)

// Song is the full Song aggregate.
type Song struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	Status    Status    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SongSummary is a Song as shown in the Song list.
type SongSummary struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	Status    Status    `json:"status"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Store reads and changes Songs in the database.
type Store struct {
	db *sql.DB
}

// NewStore returns a Store backed by db.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// timeFormat keeps sub-second precision and sorts correctly as text.
const timeFormat = "2006-01-02T15:04:05.000000000Z"

// CreateSong creates a Song with the given title and Status idea.
func (s *Store) CreateSong(ctx context.Context, title string) (Song, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return Song{}, invalid("title is required")
	}
	now := time.Now().UTC().Format(timeFormat)
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO songs (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
		title, StatusIdea, now, now)
	if err != nil {
		return Song{}, fmt.Errorf("creating song: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, id)
}

// GetSong returns a Song's full aggregate.
func (s *Store) GetSong(ctx context.Context, id int64) (Song, error) {
	var song Song
	var created, updated string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, title, status, created_at, updated_at FROM songs WHERE id = ?`, id).
		Scan(&song.ID, &song.Title, &song.Status, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Song{}, ErrNotFound
	}
	if err != nil {
		return Song{}, fmt.Errorf("reading song: %w", err)
	}
	if song.CreatedAt, err = parseTime(created); err != nil {
		return Song{}, err
	}
	if song.UpdatedAt, err = parseTime(updated); err != nil {
		return Song{}, err
	}
	return song, nil
}

// ListSongs returns every Song, most recently edited first.
func (s *Store) ListSongs(ctx context.Context) ([]SongSummary, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, title, status, updated_at FROM songs ORDER BY updated_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("listing songs: %w", err)
	}
	defer rows.Close()
	list := []SongSummary{}
	for rows.Next() {
		var sum SongSummary
		var updated string
		if err := rows.Scan(&sum.ID, &sum.Title, &sum.Status, &updated); err != nil {
			return nil, err
		}
		if sum.UpdatedAt, err = parseTime(updated); err != nil {
			return nil, err
		}
		list = append(list, sum)
	}
	return list, rows.Err()
}

func parseTime(s string) (time.Time, error) {
	t, err := time.Parse(timeFormat, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("parsing stored time %q: %w", s, err)
	}
	return t, nil
}
