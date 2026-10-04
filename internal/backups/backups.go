// Package backups makes and keeps Backups: copies of chosen Songs, the
// Beat Library, or both, kept in Bandmate to restore from and downloadable
// as one file (ADR 0013). A Backup's file is a zip laid out like a data directory: a Bandmate database
// holding only the chosen rows, at this Bandmate's schema, beside the audio
// files and Covers' pictures those rows use, under the same paths as in the
// data directory.
package backups

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/db"
)

// ErrNotFound means the requested Backup doesn't exist.
var ErrNotFound = errors.New("not found")

// InvalidError is a rejected request. Its message is safe to show the user.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

// Dir is where Backups are kept, inside the data directory, so copying the
// data directory copies them too.
const Dir = "backups"

// FileExtension ends a Backup's file name when it's downloaded.
const FileExtension = ".bandmate"

// manifestName is the entry describing a Backup in its file, for whoever
// reads the file without its row: when it was made and what it holds.
const manifestName = "backup.json"

// makingPrefix marks a Backup still being made: its staging directory and
// its file before it's kept.
const makingPrefix = ".making-"

// timeFormat is how times are stored, as elsewhere in the database.
const timeFormat = "2006-01-02T15:04:05.000000000Z"

// Backup is a Backup kept in Bandmate.
type Backup struct {
	ID        int64     `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	// Songs is how many Songs it holds.
	Songs int `json:"songs"`
	// AllSongs tells whether its Songs are every Song there was.
	AllSongs bool `json:"allSongs"`
	// BeatLibrary tells whether it holds the whole Beat Library. With
	// AllSongs, it's Everything.
	BeatLibrary bool `json:"beatLibrary"`
	// Size is its file's size in bytes.
	Size int64 `json:"size"`
}

// Contents is what a new Backup holds: every Song, the Songs picked, or
// none, and the whole Beat Library or not. Every Song and the Beat Library
// is Everything.
type Contents struct {
	AllSongs    bool    `json:"allSongs"`
	Songs       []int64 `json:"songs"`
	BeatLibrary bool    `json:"beatLibrary"`
}

// Store makes and keeps the Backups of the data directory it's opened on.
type Store struct {
	db      *sql.DB
	dataDir string
	dir     string
	now     func() time.Time
}

// Open returns the Backups kept in dataDir, whose database is conn. Backups
// left half-made by a crash are removed.
func Open(conn *sql.DB, dataDir string, now func() time.Time) (*Store, error) {
	dir := filepath.Join(dataDir, Dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating backups directory: %w", err)
	}
	leftovers, err := filepath.Glob(filepath.Join(dir, makingPrefix+"*"))
	if err != nil {
		return nil, err
	}
	for _, path := range leftovers {
		os.RemoveAll(path)
	}
	return &Store{db: conn, dataDir: dataDir, dir: dir, now: now}, nil
}

// List returns the Backups, newest first.
func (s *Store) List(ctx context.Context) ([]Backup, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, songs, all_songs, beat_library, size, created_at FROM backups ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Backup{}
	for rows.Next() {
		b, err := scanBackup(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, b)
	}
	return list, rows.Err()
}

func (s *Store) get(ctx context.Context, id int64) (Backup, error) {
	b, err := scanBackup(s.db.QueryRowContext(ctx,
		`SELECT id, songs, all_songs, beat_library, size, created_at FROM backups WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	return b, err
}

func scanBackup(row interface{ Scan(...any) error }) (Backup, error) {
	var b Backup
	var created string
	if err := row.Scan(&b.ID, &b.Songs, &b.AllSongs, &b.BeatLibrary, &b.Size, &created); err != nil {
		return b, err
	}
	t, err := time.Parse(timeFormat, created)
	if err != nil {
		return b, fmt.Errorf("reading when backup %d was made: %w", b.ID, err)
	}
	b.CreatedAt = t
	return b, nil
}

// Serve offers a Backup's file to save, named after when it was made.
func (s *Store) Serve(w http.ResponseWriter, r *http.Request, id int64) error {
	b, err := s.get(r.Context(), id)
	if err != nil {
		return err
	}
	file, err := os.Open(s.path(id))
	if err != nil {
		return fmt.Errorf("opening backup file: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("opening backup file: %w", err)
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	audio.OfferToSave(w, "Bandmate Backup "+b.CreatedAt.Format("2006-01-02 15-04-05")+" UTC"+FileExtension)
	http.ServeContent(w, r, "", info.ModTime(), file)
	return nil
}

func (s *Store) path(id int64) string {
	return filepath.Join(s.dir, strconv.FormatInt(id, 10))
}

// Make makes a Backup of contents and keeps it. Each Song, and the Beat
// Library, is copied in one read of the database, so an edit made meanwhile
// is in its copy entirely or not at all, and nothing is locked while it's
// made. A Song deleted while it's made is left out.
func (s *Store) Make(ctx context.Context, contents Contents) (Backup, error) {
	ids, err := s.songsIn(ctx, contents)
	if err != nil {
		return Backup{}, err
	}
	staging, err := os.MkdirTemp(s.dir, makingPrefix+"*")
	if err != nil {
		return Backup{}, fmt.Errorf("making backup: %w", err)
	}
	defer os.RemoveAll(staging)

	copied, err := s.copyContents(ctx, staging, ids, contents.BeatLibrary)
	if err != nil {
		return Backup{}, err
	}
	if copied == 0 && !contents.BeatLibrary {
		return Backup{}, &InvalidError{"the Songs picked have been deleted"}
	}
	b := Backup{CreatedAt: s.now().UTC(), Songs: copied, AllSongs: contents.AllSongs, BeatLibrary: contents.BeatLibrary}
	file, err := os.CreateTemp(s.dir, makingPrefix+"*"+FileExtension)
	if err != nil {
		return Backup{}, fmt.Errorf("making backup: %w", err)
	}
	defer os.Remove(file.Name())
	b.Size, err = pack(file, staging, manifest{
		CreatedAt: b.CreatedAt, Songs: b.Songs, AllSongs: b.AllSongs, BeatLibrary: b.BeatLibrary,
	})
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return Backup{}, fmt.Errorf("packing backup: %w", err)
	}
	return s.keep(ctx, file.Name(), b)
}

// songsIn lists the ids of the Songs contents picks, refusing a pick of
// nothing, of all Songs where there are none, of a Song that doesn't exist,
// or of nothing but an empty Beat Library.
func (s *Store) songsIn(ctx context.Context, contents Contents) ([]int64, error) {
	ids, err := s.songsPicked(ctx, contents)
	if err != nil || len(ids) > 0 {
		return ids, err
	}
	var beats int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM beats`).Scan(&beats); err != nil {
		return nil, err
	}
	if beats == 0 {
		return nil, &InvalidError{"there's nothing to back up"}
	}
	return ids, nil
}

// songsPicked lists the ids of the Songs contents picks, which may be none
// only beside the Beat Library.
func (s *Store) songsPicked(ctx context.Context, contents Contents) ([]int64, error) {
	if contents.AllSongs {
		if len(contents.Songs) > 0 {
			return nil, &InvalidError{"pick all Songs or some, not both"}
		}
		ids, err := queryIDs(ctx, s.db, `SELECT id FROM songs ORDER BY id`)
		if err != nil {
			return nil, err
		}
		if len(ids) == 0 && !contents.BeatLibrary {
			return nil, &InvalidError{"there are no Songs to back up"}
		}
		return ids, nil
	}
	if len(contents.Songs) == 0 {
		if !contents.BeatLibrary {
			return nil, &InvalidError{"pick at least one Song, or the Beat Library"}
		}
		return nil, nil
	}
	seen := map[int64]bool{}
	ids := []int64{}
	for _, id := range contents.Songs {
		if seen[id] {
			continue
		}
		seen[id] = true
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM songs WHERE id = ?`, id).Scan(&exists); err != nil {
			return nil, err
		}
		if exists == 0 {
			return nil, &InvalidError{"a Song picked doesn't exist"}
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// keep stores the Backup's file, made at path, under the id its row gets.
func (s *Store) keep(ctx context.Context, path string, b Backup) (Backup, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return b, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `INSERT INTO backups (songs, all_songs, beat_library, size, created_at) VALUES (?, ?, ?, ?, ?)`,
		b.Songs, b.AllSongs, b.BeatLibrary, b.Size, b.CreatedAt.Format(timeFormat))
	if err != nil {
		return b, err
	}
	if b.ID, err = res.LastInsertId(); err != nil {
		return b, err
	}
	if err := os.Rename(path, s.path(b.ID)); err != nil {
		return b, fmt.Errorf("keeping backup: %w", err)
	}
	if err := tx.Commit(); err != nil {
		os.Remove(s.path(b.ID))
		return b, err
	}
	return b, nil
}

// manifest describes a Backup inside its file.
type manifest struct {
	CreatedAt   time.Time `json:"createdAt"`
	Songs       int       `json:"songs"`
	AllSongs    bool      `json:"allSongs"`
	BeatLibrary bool      `json:"beatLibrary"`
}

// pack writes the zip of the staging directory, with the manifest first,
// and returns its size. Audio and pictures are stored as they are, being
// compressed already; the database is compressed.
func pack(w io.Writer, staging string, m manifest) (int64, error) {
	counted := &counter{w: w}
	zw := zip.NewWriter(counted)
	entry, err := zw.CreateHeader(&zip.FileHeader{Name: manifestName, Method: zip.Deflate, Modified: m.CreatedAt})
	if err != nil {
		return 0, err
	}
	if err := json.NewEncoder(entry).Encode(m); err != nil {
		return 0, err
	}
	err = filepath.WalkDir(staging, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(staging, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rel)
		method := zip.Store
		if name == db.FileName {
			method = zip.Deflate
		}
		entry, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: method, Modified: m.CreatedAt})
		if err != nil {
			return err
		}
		src, err := os.Open(path)
		if err != nil {
			return err
		}
		defer src.Close()
		_, err = io.Copy(entry, src)
		return err
	})
	if err != nil {
		return 0, err
	}
	if err := zw.Close(); err != nil {
		return 0, err
	}
	return counted.n, nil
}

// counter counts the bytes written through it.
type counter struct {
	w io.Writer
	n int64
}

func (c *counter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	return n, err
}
