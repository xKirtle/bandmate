// Package lyricsheet owns a Song, with its Lyric Sheet and Masters, as one
// aggregate and exposes intent-level operations on it. All domain rules
// live here; the HTTP layer only maps requests onto these operations.
package lyricsheet

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
)

// ErrNotFound means the requested Song, or the part of it asked for, doesn't
// exist.
var ErrNotFound = errors.New("not found")

// ErrStale means a change was based on a version of the Song that is no
// longer current: the Song changed in the meantime, e.g. from another tab.
var ErrStale = errors.New("this Song changed elsewhere, so the change wasn't saved")

// InvalidError is a rejected operation. Its message is safe to show the user.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

func invalid(msg string) error { return &InvalidError{Msg: msg} }

// ConflictError is an operation the Song's current state doesn't allow. Its
// message is safe to show the user.
type ConflictError struct{ Msg string }

func (e *ConflictError) Error() string { return e.Msg }

func conflict(msg string) error { return &ConflictError{Msg: msg} }

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

// Version counts the changes to a Song: its metadata, Status or Lyric Sheet.
// It only guards against overwriting newer work, and is no Snapshot: older
// versions aren't kept.
//
// Every change takes the version it was based on and fails with ErrStale if
// the Song has changed since. AnyVersion applies the change regardless.
type Version int64

// AnyVersion skips the version check.
const AnyVersion Version = 0

// Song is the full Song aggregate.
type Song struct {
	ID      int64   `json:"id"`
	Version Version `json:"version"`
	Title   string  `json:"title"`
	Status  Status  `json:"status"`
	// Key, BPM, Capo and Tuning record how to play the Song. Empty text and
	// nil numbers mean "not set".
	Key    string `json:"key"`
	BPM    *int   `json:"bpm"`
	Capo   *int   `json:"capo"`
	Tuning string `json:"tuning"`
	Notes  string `json:"notes"`
	// ShowChords is whether the Lyric Sheet shows Chords; it hides them on
	// purpose, without removing them from the Lines.
	ShowChords bool      `json:"showChords"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
	LyricSheet
	// Masters are in the order they were added.
	Masters []Master `json:"masters"`
}

// SongSummary is a Song as shown in the Song list.
type SongSummary struct {
	ID     int64  `json:"id"`
	Title  string `json:"title"`
	Status Status `json:"status"`
	// Key and BPM are as on the Song: "" and nil when not set.
	Key       string    `json:"key"`
	BPM       *int      `json:"bpm"`
	HasMaster bool      `json:"hasMaster"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Store reads and changes Songs in the database.
type Store struct {
	db          *sql.DB
	masterFiles *audio.Files
}

// NewStore returns a Store backed by db, keeping Masters' audio in
// masterFiles.
func NewStore(db *sql.DB, masterFiles *audio.Files) *Store {
	return &Store{db: db, masterFiles: masterFiles}
}

// timeFormat keeps sub-second precision and sorts correctly as text.
const timeFormat = "2006-01-02T15:04:05.000000000Z"

// CreateSong creates a Song with the given title and Status idea.
func (s *Store) CreateSong(ctx context.Context, title string) (Song, error) {
	id, err := insertSong(ctx, s.db, title)
	if err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, id)
}

// execer is what both *sql.DB and *sql.Tx offer for writing.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// insertSong creates a Song with the given title and Status idea, and
// returns its id.
func insertSong(ctx context.Context, db execer, title string) (int64, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return 0, errTitleRequired
	}
	now := time.Now().UTC().Format(timeFormat)
	id, err := insert(ctx, db,
		`INSERT INTO songs (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
		title, StatusIdea, now, now)
	if err != nil {
		return 0, fmt.Errorf("creating song: %w", err)
	}
	return id, nil
}

// GetSong returns a Song's full aggregate.
func (s *Store) GetSong(ctx context.Context, id int64) (Song, error) {
	var song Song
	var bpm, capo sql.NullInt64
	var created, updated string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, version, title, status, song_key, bpm, capo, tuning, notes, show_chords, created_at, updated_at
		 FROM songs WHERE id = ?`, id).
		Scan(&song.ID, &song.Version, &song.Title, &song.Status, &song.Key, &bpm, &capo, &song.Tuning, &song.Notes,
			&song.ShowChords, &created, &updated)
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
	if song.Masters, err = loadMasters(ctx, s.db, id); err != nil {
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
	// HasMaster keeps the Songs with at least one Master (true) or with
	// none (false).
	HasMaster *bool
}

// ListSongs returns the Songs matching filter, most recently edited first.
func (s *Store) ListSongs(ctx context.Context, filter SongFilter) ([]SongSummary, error) {
	conditions, args := []string{"1"}, []any{}
	if filter.Status != "" {
		if !filter.Status.valid() {
			return nil, errUnknownStatus
		}
		conditions, args = append(conditions, "status = ?"), append(args, filter.Status)
	}
	if filter.HasMaster != nil {
		conditions, args = append(conditions, "has_master = ?"), append(args, *filter.HasMaster)
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, title, status, song_key, bpm, has_master, updated_at FROM (
		   SELECT *, EXISTS (SELECT 1 FROM masters WHERE masters.song_id = songs.id) AS has_master FROM songs
		 ) WHERE `+strings.Join(conditions, " AND ")+`
		 ORDER BY updated_at DESC, id DESC`, args...)
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
		var bpm sql.NullInt64
		var updated string
		if err := rows.Scan(&sum.ID, &sum.Title, &sum.Status, &sum.Key, &bpm, &sum.HasMaster, &updated); err != nil {
			return nil, err
		}
		sum.BPM = intOrNil(bpm)
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
	// ShowChords can't be null: it is either on or off.
	ShowChords Change[*bool] `json:"showChords"`
}

// UpdateSong applies changes to a Song. Every change is validated before
// anything is written, so a rejected update leaves the Song as it was.
func (s *Store) UpdateSong(ctx context.Context, id int64, based Version, changes SongChanges) (Song, error) {
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
	if c := changes.ShowChords; c.Set {
		if c.Value == nil {
			return Song{}, invalid("showChords must be true or false")
		}
		set("show_chords", *c.Value)
	}
	if len(sets) == 0 {
		song, err := s.GetSong(ctx, id)
		if err == nil && based != AnyVersion && song.Version != based {
			return Song{}, ErrStale
		}
		return song, err
	}
	return s.change(ctx, id, based, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx,
			`UPDATE songs SET `+strings.Join(sets, ", ")+` WHERE id = ?`, append(args, id)...)
		if err != nil {
			return fmt.Errorf("updating song: %w", err)
		}
		return nil
	})
}

// DeleteSong removes a Song. Everything the Song owns references it with
// ON DELETE CASCADE, so it goes too, and so do its Masters' files.
func (s *Store) DeleteSong(ctx context.Context, id int64, based Version) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	masters, err := masterIDs(ctx, tx, id)
	if err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM songs WHERE id = ? AND (?2 = 0 OR version = ?2)`, id, based)
	if err != nil {
		return fmt.Errorf("deleting song: %w", err)
	}
	if err := expectCurrent(ctx, tx, res, id); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.removeMasterFiles(masters)
	return nil
}

// expectCurrent checks that a write to a Song, guarded by the version it
// was based on, matched the Song. If not, the Song is gone (ErrNotFound) or
// has moved on to a newer version (ErrStale).
func expectCurrent(ctx context.Context, db queryer, res sql.Result, id int64) error {
	if err := expectOneRow(res); !errors.Is(err, ErrNotFound) {
		return err
	}
	var exists bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM songs WHERE id = ?)`, id).Scan(&exists); err != nil {
		return fmt.Errorf("checking song: %w", err)
	}
	if exists {
		return ErrStale
	}
	return ErrNotFound
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
