package backups

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strconv"

	"github.com/xKirtle/bandmate/internal/songfiles"
)

// errNotABackup refuses an upload that isn't a Backup's file at all.
var errNotABackup = &InvalidError{"the file isn't a Bandmate Backup"}

// zipSignature starts a zip file, so a file starting with it that can't be
// read as one is a damaged Backup rather than something else.
var zipSignature = []byte("PK\x03\x04")

// Upload keeps a Backup's file, downloaded from this install or another,
// to restore from like one made here. It's named as it was made: when, and
// what it holds. A file that isn't a Backup, is damaged, or was made by a
// newer Bandmate is refused whole, and nothing is kept.
func (s *Store) Upload(ctx context.Context, body io.Reader) (Backup, error) {
	file, err := os.CreateTemp(s.dir, makingPrefix+"*"+FileExtension)
	if err != nil {
		return Backup{}, fmt.Errorf("receiving backup: %w", err)
	}
	defer os.Remove(file.Name())
	size, err := io.Copy(file, body)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return Backup{}, fmt.Errorf("receiving backup: %w", err)
	}
	b, err := s.check(ctx, file.Name())
	if err != nil {
		return Backup{}, err
	}
	b.Size = size
	return s.keep(ctx, file.Name(), b)
}

// check reads the Backup's file at path whole, refusing it if it isn't a
// Backup, is damaged, or was made by a newer Bandmate, and returns the
// Backup it is, as made.
func (s *Store) check(ctx context.Context, path string) (Backup, error) {
	m, entries, err := readEntries(path)
	if err != nil {
		return Backup{}, err
	}
	r, err := s.openFile(ctx, path)
	if err != nil {
		return Backup{}, err
	}
	defer r.close()
	if err := r.checkDatabase(ctx); err != nil {
		return Backup{}, err
	}
	b := Backup{CreatedAt: m.CreatedAt.UTC(), AllSongs: m.AllSongs, BeatLibrary: m.BeatLibrary}
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM songs`).Scan(&b.Songs); err != nil {
		return Backup{}, damagedBy(err)
	}
	if b.Songs != m.Songs {
		return Backup{}, damagedBy(fmt.Errorf("it holds %d songs, and says it holds %d", b.Songs, m.Songs))
	}
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM beats`).Scan(&b.Beats); err != nil {
		return Backup{}, damagedBy(err)
	}
	if m.Beats != nil && b.Beats != *m.Beats {
		return Backup{}, damagedBy(fmt.Errorf("it holds %d beats, and says it holds %d", b.Beats, *m.Beats))
	}
	if b.Songs == 0 && b.Beats == 0 && !b.BeatLibrary {
		return Backup{}, damagedBy(errors.New("it holds neither Songs nor Beats"))
	}
	if err := r.checkFiles(ctx, entries); err != nil {
		return Backup{}, err
	}
	return b, nil
}

// readEntries reads every entry of the Backup's file at path, checking
// each is as it was written, and returns its manifest and the names of its
// entries.
func readEntries(path string) (manifest, map[string]bool, error) {
	var m manifest
	file, err := zip.OpenReader(path)
	if err != nil {
		if looksLikeZip(path) {
			return m, nil, damagedBy(err)
		}
		return m, nil, errNotABackup
	}
	defer file.Close()
	entries := map[string]bool{}
	for _, f := range file.File {
		entries[f.Name] = true
	}
	if !entries[manifestName] {
		return m, nil, errNotABackup
	}
	for _, f := range file.File {
		if err := readEntry(f); err != nil {
			return m, nil, damagedBy(fmt.Errorf("reading %s: %w", f.Name, err))
		}
	}
	src, err := file.Open(manifestName)
	if err != nil {
		return m, nil, damagedBy(err)
	}
	defer src.Close()
	if err := json.NewDecoder(src).Decode(&m); err != nil {
		return m, nil, damagedBy(fmt.Errorf("reading %s: %w", manifestName, err))
	}
	if m.CreatedAt.IsZero() {
		return m, nil, damagedBy(fmt.Errorf("%s doesn't say when it was made", manifestName))
	}
	return m, entries, nil
}

// readEntry reads an entry to its end, which checks it against its checksum.
func readEntry(f *zip.File) error {
	src, err := f.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	_, err = io.Copy(io.Discard, src)
	return err
}

// looksLikeZip tells whether the file at path starts as a zip does.
func looksLikeZip(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	start := make([]byte, len(zipSignature))
	if _, err := io.ReadFull(file, start); err != nil {
		return false
	}
	return bytes.Equal(start, zipSignature)
}

// checkDatabase checks the Backup's database is whole and keeps the
// database's rules.
func (r *openedBackup) checkDatabase(ctx context.Context) error {
	var result string
	if err := r.db.QueryRowContext(ctx, `PRAGMA integrity_check(1)`).Scan(&result); err != nil {
		return damagedBy(err)
	}
	if result != "ok" {
		return damagedBy(errors.New(result))
	}
	rows, err := r.db.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		return damagedBy(err)
	}
	defer rows.Close()
	if rows.Next() {
		return damagedBy(errors.New("a row refers to one it doesn't hold"))
	}
	return rows.Err()
}

// checkFiles checks the Backup's file holds every file its rows use, of
// every Song and Beat.
func (r *openedBackup) checkFiles(ctx context.Context, entries map[string]bool) error {
	songs, err := queryIDs(ctx, r.db, `SELECT id FROM songs`)
	if err != nil {
		return damagedBy(err)
	}
	need := func(files []songfiles.Kind, args ...any) error {
		for _, f := range files {
			ids, err := queryIDs(ctx, r.db, f.IDs, args...)
			if err != nil {
				return damagedBy(err)
			}
			for _, id := range ids {
				if name := path.Join(f.Dir, strconv.FormatInt(id, 10)); !entries[name] {
					return damagedBy(fmt.Errorf("%s is missing", name))
				}
			}
		}
		return nil
	}
	for _, song := range songs {
		if err := need(songfiles.Kinds, song); err != nil {
			return err
		}
	}
	return need(beatLibraryFiles)
}
