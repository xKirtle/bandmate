// Package beats owns the Beat Library: Beats shared by all Songs, with their
// credit and their audio file. All its rules live here; the HTTP layer only
// maps requests onto these operations.
package beats

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// ErrNotFound means the requested Beat doesn't exist.
var ErrNotFound = errors.New("not found")

// InvalidError is a rejected operation. Its message is safe to show the user.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

func invalid(msg string) error { return &InvalidError{Msg: msg} }

// InUseError refuses a change to a Beat that Songs use. Its message, which
// names those Songs, is safe to show the user.
type InUseError struct {
	Msg   string
	Songs []SongTitle
}

func (e *InUseError) Error() string { return e.Msg }

var errTitleRequired = invalid("title is required")

// Beat is an audio file in the Beat Library, with its credit.
type Beat struct {
	ID int64 `json:"id"`
	Details
	// FileName and ContentType describe the file as uploaded, which is kept
	// unchanged.
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	// Size is the file's size in bytes.
	Size int64 `json:"size"`
	// Duration is in seconds.
	Duration float64 `json:"duration"`
	// Peaks is the waveform: the loudest sample of each 1/100 of a second,
	// from 0 to 1, as the browser computed them. The Beat Library list leaves
	// them out.
	Peaks []float64 `json:"peaks,omitempty"`
	// Songs are the Songs using the Beat, which can't be deleted or have its
	// file replaced while there are any.
	Songs     []SongTitle `json:"songs"`
	CreatedAt time.Time   `json:"createdAt"`
	UpdatedAt time.Time   `json:"updatedAt"`
}

// Details are what the user enters about a Beat. Empty text and a nil BPM
// mean "not set"; only the title is required.
type Details struct {
	Title      string `json:"title"`
	Producer   string `json:"producer"`
	SourceLink string `json:"sourceLink"`
	BPM        *int   `json:"bpm"`
	Key        string `json:"key"`
	Notes      string `json:"notes"`
}

// SongTitle names a Song.
type SongTitle struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// Store reads and changes the Beat Library.
type Store struct {
	db    *sql.DB
	files *audio.Files
}

// NewStore returns a Store keeping Beats in db and their audio in files.
func NewStore(db *sql.DB, files *audio.Files) *Store {
	return &Store{db: db, files: files}
}

// timeFormat keeps sub-second precision and sorts correctly as text.
const timeFormat = "2006-01-02T15:04:05.000000000Z"

// Add puts an uploaded file into the Beat Library as a new Beat. The file
// is kept if the Beat is added, and discarded otherwise.
func (s *Store) Add(ctx context.Context, details Details, a audio.Upload, file *audio.Received) (Beat, error) {
	defer file.Discard()
	details, err := details.clean()
	if err != nil {
		return Beat{}, err
	}
	if msg := a.Problem(); msg != "" {
		return Beat{}, invalid(msg)
	}
	peaks, err := json.Marshal(a.Peaks)
	if err != nil {
		return Beat{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Beat{}, err
	}
	defer tx.Rollback()
	now := time.Now().UTC().Format(timeFormat)
	res, err := tx.ExecContext(ctx,
		`INSERT INTO beats (title, producer, source_link, bpm, beat_key, notes,
			file_name, content_type, size, duration, peaks, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		details.Title, details.Producer, details.SourceLink, details.BPM, details.Key, details.Notes,
		a.FileName, a.MediaType(), file.Size, a.Duration, string(peaks), now, now)
	if err != nil {
		return Beat{}, fmt.Errorf("adding beat: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Beat{}, err
	}
	if err := file.Keep(id); err != nil {
		return Beat{}, err
	}
	if err := tx.Commit(); err != nil {
		s.files.Remove(id)
		return Beat{}, err
	}
	return s.Get(ctx, id)
}

// Get returns a Beat with its peaks.
func (s *Store) Get(ctx context.Context, id int64) (Beat, error) {
	b, peaks, err := s.read(ctx, id)
	if err != nil {
		return Beat{}, err
	}
	if err := json.Unmarshal([]byte(peaks), &b.Peaks); err != nil {
		return Beat{}, fmt.Errorf("reading peaks of beat %d: %w", id, err)
	}
	return b, nil
}

// columns are the beats columns scan reads, in its order.
const columns = `id, title, producer, source_link, bpm, beat_key, notes,
	file_name, content_type, size, duration, created_at, updated_at`

// scan reads one row of columns into a Beat, without its Songs. Columns
// selected after them are read into extra.
func scan(row interface{ Scan(...any) error }, extra ...any) (Beat, error) {
	var b Beat
	var bpm sql.NullInt64
	var created, updated string
	err := row.Scan(append([]any{&b.ID, &b.Title, &b.Producer, &b.SourceLink, &bpm, &b.Key, &b.Notes,
		&b.FileName, &b.ContentType, &b.Size, &b.Duration, &created, &updated}, extra...)...)
	if err != nil {
		return Beat{}, err
	}
	if bpm.Valid {
		n := int(bpm.Int64)
		b.BPM = &n
	}
	if b.CreatedAt, err = parseTime(created); err != nil {
		return Beat{}, err
	}
	if b.UpdatedAt, err = parseTime(updated); err != nil {
		return Beat{}, err
	}
	return b, nil
}

// read returns a Beat with the Songs using it, and its peaks as stored.
func (s *Store) read(ctx context.Context, id int64) (Beat, string, error) {
	var peaks string
	b, err := scan(s.db.QueryRowContext(ctx, `SELECT `+columns+`, peaks FROM beats WHERE id = ?`, id), &peaks)
	if errors.Is(err, sql.ErrNoRows) {
		return Beat{}, "", ErrNotFound
	}
	if err != nil {
		return Beat{}, "", fmt.Errorf("reading beat: %w", err)
	}
	if b.Songs, err = s.songsUsing(ctx, id); err != nil {
		return Beat{}, "", err
	}
	return b, peaks, nil
}

// List returns the Beats whose title or producer contains query, ignoring
// case, most recently added first. Their peaks are left out.
func (s *Store) List(ctx context.Context, query string) ([]Beat, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+columns+` FROM beats ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("listing beats: %w", err)
	}
	defer rows.Close()
	// Matched here rather than with SQL LIKE, whose case folding only covers
	// ASCII.
	needle := strings.ToLower(strings.TrimSpace(query))
	list := []Beat{}
	for rows.Next() {
		b, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("listing beats: %w", err)
		}
		if !strings.Contains(strings.ToLower(b.Title), needle) && !strings.Contains(strings.ToLower(b.Producer), needle) {
			continue
		}
		list = append(list, b)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	for i := range list {
		if list[i].Songs, err = s.songsUsing(ctx, list[i].ID); err != nil {
			return nil, err
		}
	}
	return list, nil
}

// Changes is a partial update to a Beat's Details. Fields not Set are
// unchanged.
type Changes struct {
	Title      lyricsheet.Change[string] `json:"title"`
	Producer   lyricsheet.Change[string] `json:"producer"`
	SourceLink lyricsheet.Change[string] `json:"sourceLink"`
	BPM        lyricsheet.Change[*int]   `json:"bpm"`
	Key        lyricsheet.Change[string] `json:"key"`
	Notes      lyricsheet.Change[string] `json:"notes"`
}

// Update changes a Beat's Details. Every change is validated before any is
// written, so a rejected update leaves the Beat as it was.
func (s *Store) Update(ctx context.Context, id int64, changes Changes) (Beat, error) {
	current, err := s.Get(ctx, id)
	if err != nil {
		return Beat{}, err
	}
	d := current.Details
	apply(&d.Title, changes.Title)
	apply(&d.Producer, changes.Producer)
	apply(&d.SourceLink, changes.SourceLink)
	apply(&d.BPM, changes.BPM)
	apply(&d.Key, changes.Key)
	apply(&d.Notes, changes.Notes)
	if d, err = d.clean(); err != nil {
		return Beat{}, err
	}
	if d == current.Details {
		return current, nil
	}
	_, err = s.db.ExecContext(ctx,
		`UPDATE beats SET title = ?, producer = ?, source_link = ?, bpm = ?, beat_key = ?, notes = ?, updated_at = ?
		 WHERE id = ?`,
		d.Title, d.Producer, d.SourceLink, d.BPM, d.Key, d.Notes, time.Now().UTC().Format(timeFormat), id)
	if err != nil {
		return Beat{}, fmt.Errorf("updating beat: %w", err)
	}
	return s.Get(ctx, id)
}

func apply[T any](field *T, c lyricsheet.Change[T]) {
	if c.Set {
		*field = c.Value
	}
}

// ReplaceFile swaps a Beat's audio file for a new upload, keeping its
// Details. It is refused while Songs use the Beat, since their Clips' trims
// would silently shift. The file is kept if it replaces the old one, and
// discarded otherwise.
func (s *Store) ReplaceFile(ctx context.Context, id int64, a audio.Upload, file *audio.Received) (Beat, error) {
	defer file.Discard()
	if msg := a.Problem(); msg != "" {
		return Beat{}, invalid(msg)
	}
	b, _, err := s.read(ctx, id)
	if err != nil {
		return Beat{}, err
	}
	if len(b.Songs) > 0 {
		return Beat{}, inUse(b, "have its file replaced")
	}
	peaks, err := json.Marshal(a.Peaks)
	if err != nil {
		return Beat{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Beat{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx,
		`UPDATE beats SET file_name = ?, content_type = ?, size = ?, duration = ?, peaks = ?, updated_at = ?
		 WHERE id = ?`,
		a.FileName, a.MediaType(), file.Size, a.Duration, string(peaks), time.Now().UTC().Format(timeFormat), id)
	if err != nil {
		return Beat{}, fmt.Errorf("replacing beat file: %w", err)
	}
	// If the commit then fails, the new file is in place with the old
	// details; that is rare enough, and the Beat still plays.
	if err := file.Keep(id); err != nil {
		return Beat{}, err
	}
	if err := tx.Commit(); err != nil {
		return Beat{}, err
	}
	return s.Get(ctx, id)
}

// Delete removes a Beat and its audio file. It is refused while Songs use
// the Beat.
func (s *Store) Delete(ctx context.Context, id int64) error {
	b, _, err := s.read(ctx, id)
	if err != nil {
		return err
	}
	if len(b.Songs) > 0 {
		return inUse(b, "be deleted")
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM beats WHERE id = ?`, id); err != nil {
		return fmt.Errorf("deleting beat: %w", err)
	}
	// The Beat is gone either way; a file left behind only takes space.
	if err := s.files.Remove(id); err != nil {
		log.Printf("deleting beat %d: %v", id, err)
	}
	return nil
}

// ServeFile answers a request for a Beat's audio file, with Range support.
func (s *Store) ServeFile(w http.ResponseWriter, r *http.Request, id int64) error {
	var contentType string
	err := s.db.QueryRowContext(r.Context(), `SELECT content_type FROM beats WHERE id = ?`, id).Scan(&contentType)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading beat: %w", err)
	}
	return s.files.Serve(w, r, id, contentType)
}

// songsUsing lists the Songs with a Clip of the Beat on their Timeline, in
// the order they were created.
func (s *Store) songsUsing(ctx context.Context, id int64) ([]SongTitle, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, title FROM songs WHERE id IN (
			SELECT t.song_id FROM clips c JOIN tracks t ON t.id = c.track_id WHERE c.beat_id = ?)
		ORDER BY id`, id)
	if err != nil {
		return nil, fmt.Errorf("listing songs using beat %d: %w", id, err)
	}
	defer rows.Close()
	songs := []SongTitle{}
	for rows.Next() {
		var song SongTitle
		if err := rows.Scan(&song.ID, &song.Title); err != nil {
			return nil, err
		}
		songs = append(songs, song)
	}
	return songs, rows.Err()
}

func inUse(b Beat, change string) error {
	titles := make([]string, len(b.Songs))
	for i, song := range b.Songs {
		titles[i] = song.Title
	}
	return &InUseError{
		Msg:   fmt.Sprintf("“%s” can't %s while these Songs use it: %s", b.Title, change, strings.Join(titles, ", ")),
		Songs: b.Songs,
	}
}

// clean trims the Details and checks them.
func (d Details) clean() (Details, error) {
	d.Title = strings.TrimSpace(d.Title)
	d.Producer = strings.TrimSpace(d.Producer)
	d.SourceLink = strings.TrimSpace(d.SourceLink)
	d.Key = strings.TrimSpace(d.Key)
	if d.Title == "" {
		return d, errTitleRequired
	}
	if d.BPM != nil && (*d.BPM < 1 || *d.BPM > 999) {
		return d, invalid("bpm must be between 1 and 999")
	}
	if d.SourceLink != "" {
		u, err := url.Parse(d.SourceLink)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return d, invalid("source link must be a web address starting with http:// or https://")
		}
	}
	return d, nil
}

func parseTime(s string) (time.Time, error) {
	t, err := time.Parse(timeFormat, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("parsing stored time %q: %w", s, err)
	}
	return t, nil
}
