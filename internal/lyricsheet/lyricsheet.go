// Package lyricsheet owns a Song and its Lyric Sheet as one aggregate and
// exposes intent-level operations on it. All domain rules live here; the HTTP
// layer only maps requests onto these operations.
package lyricsheet

import (
	"context"
	"database/sql"
	"encoding/json"
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

var (
	errTitleRequired = invalid("title is required")
	errUnknownStatus = invalid("status must be idea, drafting or finished")
)

// Status is where a Song stands in its lifecycle.
type Status string

const (
	StatusIdea     Status = "idea"
	StatusDrafting Status = "drafting"
	StatusFinished Status = "finished"
)

func (s Status) valid() bool {
	switch s {
	case StatusIdea, StatusDrafting, StatusFinished:
		return true
	}
	return false
}

// Song is the full Song aggregate.
type Song struct {
	ID     int64  `json:"id"`
	Title  string `json:"title"`
	Status Status `json:"status"`
	// Key, BPM, Capo and Tuning record how to play the Song. Empty text and
	// nil numbers mean "not set".
	Key       string    `json:"key"`
	BPM       *int      `json:"bpm"`
	Capo      *int      `json:"capo"`
	Tuning    string    `json:"tuning"`
	Notes     string    `json:"notes"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	LyricSheet
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
		return Song{}, errTitleRequired
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
	var bpm, capo sql.NullInt64
	var created, updated string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, title, status, song_key, bpm, capo, tuning, notes, created_at, updated_at
		 FROM songs WHERE id = ?`, id).
		Scan(&song.ID, &song.Title, &song.Status, &song.Key, &bpm, &capo, &song.Tuning, &song.Notes,
			&created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Song{}, ErrNotFound
	}
	if err != nil {
		return Song{}, fmt.Errorf("reading song: %w", err)
	}
	song.BPM, song.Capo = intOrNil(bpm), intOrNil(capo)
	if song.CreatedAt, err = parseTime(created); err != nil {
		return Song{}, err
	}
	if song.UpdatedAt, err = parseTime(updated); err != nil {
		return Song{}, err
	}
	if song.LyricSheet, err = s.loadLyricSheet(ctx, id); err != nil {
		return Song{}, err
	}
	return song, nil
}

// SongFilter narrows the Song list. Zero fields don't filter.
type SongFilter struct {
	Status Status
	// Title keeps Songs whose title contains it, ignoring case and
	// surrounding spaces.
	Title string
}

// ListSongs returns the Songs matching filter, most recently edited first.
func (s *Store) ListSongs(ctx context.Context, filter SongFilter) ([]SongSummary, error) {
	where, args := "", []any{}
	if filter.Status != "" {
		if !filter.Status.valid() {
			return nil, errUnknownStatus
		}
		where, args = "WHERE status = ?", append(args, filter.Status)
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, title, status, updated_at FROM songs `+where+` ORDER BY updated_at DESC, id DESC`, args...)
	if err != nil {
		return nil, fmt.Errorf("listing songs: %w", err)
	}
	defer rows.Close()
	// Titles are matched here rather than with SQL LIKE, whose case folding
	// only covers ASCII ("canção" wouldn't find "CANÇÃO").
	needle := strings.ToLower(strings.TrimSpace(filter.Title))
	list := []SongSummary{}
	for rows.Next() {
		var sum SongSummary
		var updated string
		if err := rows.Scan(&sum.ID, &sum.Title, &sum.Status, &updated); err != nil {
			return nil, err
		}
		if !strings.Contains(strings.ToLower(sum.Title), needle) {
			continue
		}
		if sum.UpdatedAt, err = parseTime(updated); err != nil {
			return nil, err
		}
		list = append(list, sum)
	}
	return list, rows.Err()
}

// Change is one field of a partial update. It is Set only when the field was
// sent; a JSON null sets it to the zero value, which clears optional fields.
type Change[T any] struct {
	Set   bool
	Value T
}

func (c *Change[T]) UnmarshalJSON(b []byte) error {
	c.Set = true
	return json.Unmarshal(b, &c.Value)
}

// SongChanges is a partial update to a Song. Fields not Set are unchanged.
type SongChanges struct {
	Title  Change[string] `json:"title"`
	Status Change[Status] `json:"status"`
	Key    Change[string] `json:"key"`
	BPM    Change[*int]   `json:"bpm"`
	Capo   Change[*int]   `json:"capo"`
	Tuning Change[string] `json:"tuning"`
	Notes  Change[string] `json:"notes"`
}

// UpdateSong applies changes to a Song. Every change is validated before
// anything is written, so a rejected update leaves the Song as it was.
func (s *Store) UpdateSong(ctx context.Context, id int64, changes SongChanges) (Song, error) {
	var sets []string
	var args []any
	set := func(column string, value any) {
		sets, args = append(sets, column+" = ?"), append(args, value)
	}
	if c := changes.Title; c.Set {
		title := strings.TrimSpace(c.Value)
		if title == "" {
			return Song{}, errTitleRequired
		}
		set("title", title)
	}
	if c := changes.Status; c.Set {
		if !c.Value.valid() {
			return Song{}, errUnknownStatus
		}
		set("status", c.Value)
	}
	if c := changes.Key; c.Set {
		set("song_key", strings.TrimSpace(c.Value))
	}
	if c := changes.BPM; c.Set {
		if c.Value != nil && (*c.Value < 1 || *c.Value > 999) {
			return Song{}, invalid("bpm must be between 1 and 999")
		}
		set("bpm", c.Value)
	}
	if c := changes.Capo; c.Set {
		if c.Value != nil && (*c.Value < 0 || *c.Value > 24) {
			return Song{}, invalid("capo must be between 0 and 24")
		}
		set("capo", c.Value)
	}
	if c := changes.Tuning; c.Set {
		set("tuning", strings.TrimSpace(c.Value))
	}
	if c := changes.Notes; c.Set {
		set("notes", c.Value)
	}
	if len(sets) == 0 {
		return s.GetSong(ctx, id)
	}
	set("updated_at", time.Now().UTC().Format(timeFormat))
	res, err := s.db.ExecContext(ctx,
		`UPDATE songs SET `+strings.Join(sets, ", ")+` WHERE id = ?`, append(args, id)...)
	if err != nil {
		return Song{}, fmt.Errorf("updating song: %w", err)
	}
	if err := expectOneRow(res); err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, id)
}

// DeleteSong removes a Song. Everything the Song owns references it with
// ON DELETE CASCADE, so it goes too.
func (s *Store) DeleteSong(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM songs WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting song: %w", err)
	}
	return expectOneRow(res)
}

// expectOneRow turns a write that matched no Song into ErrNotFound.
func expectOneRow(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func intOrNil(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}

func parseTime(s string) (time.Time, error) {
	t, err := time.Parse(timeFormat, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("parsing stored time %q: %w", s, err)
	}
	return t, nil
}
