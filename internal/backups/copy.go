package backups

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/xKirtle/bandmate/internal/db"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// songTable is a table holding rows that belong to a Song, or to the Beat
// Library, and which of them go in a Backup: where picks them from the live
// database, attached as "live", given a Song's id as its one parameter for
// a Song's tables, and nothing for the Beat Library's. Detached Takes, and
// Sounds no Clip uses, are kept only for undo, which never outlasts a
// session, so a Backup leaves them out.
type songTable struct {
	name  string
	where string
	// shared rows, i.e. Beats, may already be in the Backup from another
	// Song.
	shared bool
}

// songTables lists, parents first, every table holding a Song's rows.
var songTables = []songTable{
	{name: "songs", where: `id = ?1`},
	{name: "sections", where: `song_id = ?1`},
	{name: "alternates", where: `section_id IN (SELECT id FROM live.sections WHERE song_id = ?1)`},
	{name: "lines", where: `alternate_id IN (SELECT a.id FROM live.alternates a
		JOIN live.sections s ON s.id = a.section_id WHERE s.song_id = ?1)`},
	{name: "masters", where: `song_id = ?1`},
	{name: "covers", where: `song_id = ?1`},
	{name: "loops", where: `song_id = ?1`},
	{name: "tracks", where: `song_id = ?1`},
	{name: "beats", shared: true, where: `id IN (SELECT c.beat_id FROM live.clips c
		JOIN live.tracks t ON t.id = c.track_id WHERE t.song_id = ?1)`},
	{name: "sounds", where: `id IN (SELECT c.sound_id FROM live.clips c
		JOIN live.tracks t ON t.id = c.track_id WHERE t.song_id = ?1)`},
	{name: "clips", where: `track_id IN (SELECT id FROM live.tracks WHERE song_id = ?1)`},
	{name: "takes", where: `clip_id IN (SELECT c.id FROM live.clips c
		JOIN live.tracks t ON t.id = c.track_id WHERE t.song_id = ?1)`},
}

// notCopied are the tables holding nothing of a Song: the schema's own
// bookkeeping, and the Backups.
var notCopied = map[string]bool{"schema_migrations": true, "sqlite_sequence": true, "backups": true}

// songFile is a kind of file a Song's rows, or the Beat Library's, use: the
// directory such files are kept in under the data directory, and the query
// listing, from the Backup's database given the same parameters as the
// tables, the ids they're kept under.
type songFile struct{ dir, ids string }

// songFiles lists the files a Song's rows use.
var songFiles = func() []songFile {
	files := []songFile{
		{"audio/beats", `SELECT id FROM main.beats`},
		{"audio/masters", `SELECT id FROM main.masters WHERE song_id = ?1`},
		{"audio/takes", `SELECT id FROM main.takes WHERE song_id = ?1`},
		{"audio/sounds", `SELECT id FROM main.sounds WHERE song_id = ?1`},
	}
	for _, p := range lyricsheet.CoverPictures {
		files = append(files, songFile{"covers/" + string(p), `SELECT id FROM main.covers WHERE song_id = ?1`})
	}
	return files
}()

// copyAttempts is how often a Song's copy, or the Beat Library's, is tried
// before giving up: a file removed between reading the rows and keeping
// their files, e.g. a Cover just replaced, means reading them again.
const copyAttempts = 3

// errFileGone means a file the rows copied use was removed meanwhile.
var errFileGone = errors.New("a file was removed while it was backed up")

// beatLibraryTables picks every Beat: the whole Beat Library, some of which
// may already be in the Backup from a Song.
var beatLibraryTables = []songTable{{name: "beats", shared: true, where: `TRUE`}}

// beatLibraryFiles lists the files the Beat Library's rows use.
var beatLibraryFiles = []songFile{{"audio/beats", `SELECT id FROM main.beats`}}

// copyContents makes, in staging, a database holding the Songs with ids,
// and the whole Beat Library if beatLibrary is set, laid out with their
// files like a data directory, and returns how many Songs it holds.
func (s *Store) copyContents(ctx context.Context, staging string, ids []int64, beatLibrary bool) (int, error) {
	backup, err := db.Open(ctx, staging)
	if err != nil {
		return 0, fmt.Errorf("making backup database: %w", err)
	}
	defer backup.Close()
	conn, err := backup.Conn(ctx)
	if err != nil {
		return 0, err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `ATTACH DATABASE ? AS live`, filepath.Join(s.dataDir, db.FileName)); err != nil {
		return 0, fmt.Errorf("reading the database: %w", err)
	}
	columns, err := tableColumns(ctx, conn)
	if err != nil {
		return 0, err
	}
	copied := 0
	for _, id := range ids {
		found, err := s.copyRows(ctx, conn, staging, columns, songTables, songFiles, id)
		if err != nil {
			return 0, fmt.Errorf("backing up song %d: %w", id, err)
		}
		if found {
			copied++
		}
	}
	if beatLibrary {
		if _, err := s.copyRows(ctx, conn, staging, columns, beatLibraryTables, beatLibraryFiles); err != nil {
			return 0, fmt.Errorf("backing up the beat library: %w", err)
		}
	}
	if _, err := conn.ExecContext(ctx, `DETACH DATABASE live`); err != nil {
		return 0, err
	}
	// One file, with nothing left in a write-ahead log beside it.
	if _, err := conn.ExecContext(ctx, `PRAGMA journal_mode = DELETE`); err != nil {
		return 0, err
	}
	return copied, nil
}

// copyRows copies the rows tables pick, given args, with the files they
// use, trying again if a file is removed meanwhile. It tells whether a Song
// was there to copy: whether the first table, unless shared, picked a row.
func (s *Store) copyRows(ctx context.Context, conn *sql.Conn, staging string, columns map[string]string,
	tables []songTable, files []songFile, args ...any) (bool, error) {
	for attempt := 1; ; attempt++ {
		found, err := s.copyOnce(ctx, conn, staging, columns, tables, files, args)
		if !errors.Is(err, errFileGone) || attempt == copyAttempts {
			return found, err
		}
	}
}

// tableColumns lists the columns of each table a Backup holds, as both databases have them,
// being at the same schema. It refuses a database with a table it doesn't
// know, which a migration added without saying whether a Backup holds it.
func tableColumns(ctx context.Context, conn *sql.Conn) (map[string]string, error) {
	known := map[string]bool{}
	for _, t := range songTables {
		known[t.name] = true
	}
	rows, err := conn.QueryContext(ctx, `SELECT name FROM live.sqlite_master WHERE type = 'table'`)
	if err != nil {
		return nil, err
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return nil, err
		}
		tables = append(tables, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, name := range tables {
		if !known[name] && !notCopied[name] {
			return nil, fmt.Errorf("table %s is neither backed up nor left out", name)
		}
	}
	columns := map[string]string{}
	for _, t := range songTables {
		rows, err := conn.QueryContext(ctx, `SELECT name FROM main.pragma_table_info(?)`, t.name)
		if err != nil {
			return nil, err
		}
		var names []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				rows.Close()
				return nil, err
			}
			names = append(names, `"`+name+`"`)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		columns[t.name] = strings.Join(names, ", ")
	}
	return columns, nil
}

// copyOnce copies the rows tables pick in one transaction, so they're all
// read from one snapshot of the live database, e.g. a whole Song, and links
// in the files they use before committing. It tells whether the first
// table, unless shared, picked a row; if it picked none, nothing is copied.
func (s *Store) copyOnce(ctx context.Context, conn *sql.Conn, staging string, columns map[string]string,
	tables []songTable, files []songFile, args []any) (bool, error) {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	// A Clip and its active Take refer to each other, so their references
	// are checked once both are in.
	if _, err := tx.ExecContext(ctx, `PRAGMA defer_foreign_keys = ON`); err != nil {
		return false, err
	}
	for i, t := range tables {
		insert := "INSERT INTO"
		if t.shared {
			insert = "INSERT OR IGNORE INTO"
		}
		cols := columns[t.name]
		res, err := tx.ExecContext(ctx, fmt.Sprintf(`%s main.%s (%s) SELECT %s FROM live.%s WHERE %s`,
			insert, t.name, cols, cols, t.name, t.where), args...)
		if err != nil {
			return false, fmt.Errorf("copying %s: %w", t.name, err)
		}
		if i == 0 && !t.shared {
			n, err := res.RowsAffected()
			if err != nil {
				return false, err
			}
			if n == 0 {
				return false, nil
			}
		}
	}
	linked, err := s.linkFiles(ctx, tx, staging, files, args)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		for _, path := range linked {
			os.Remove(path)
		}
		return false, err
	}
	return true, nil
}

// linkFiles puts the files listed by files, given args, into staging, at
// the paths they have in the data directory, and returns those it put
// there. A Beat already there, from another Song, or from the Beat Library,
// is left as it is.
func (s *Store) linkFiles(ctx context.Context, tx *sql.Tx, staging string, files []songFile, args []any) ([]string, error) {
	var linked []string
	for _, f := range files {
		ids, err := queryIDs(ctx, tx, f.ids, args...)
		if err != nil {
			return linked, err
		}
		if len(ids) == 0 {
			continue
		}
		if err := os.MkdirAll(filepath.Join(staging, f.dir), 0o755); err != nil {
			return linked, err
		}
		for _, id := range ids {
			name := strconv.FormatInt(id, 10)
			to := filepath.Join(staging, f.dir, name)
			if _, err := os.Stat(to); err == nil {
				continue
			}
			if err := linkOrCopy(filepath.Join(s.dataDir, f.dir, name), to); err != nil {
				if errors.Is(err, os.ErrNotExist) {
					return linked, errFileGone
				}
				return linked, err
			}
			linked = append(linked, to)
		}
	}
	return linked, nil
}

// querier runs queries, in a transaction or not.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// queryIDs lists the ids query selects.
func queryIDs(ctx context.Context, q querier, query string, args ...any) ([]int64, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// linkOrCopy puts the file at from at to as well: a hard link, which takes
// no space and keeps the file as it is now even if it's replaced, or a copy
// where the file system can't link it.
func linkOrCopy(from, to string) error {
	err := os.Link(from, to)
	if err == nil || errors.Is(err, os.ErrNotExist) {
		return err
	}
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(to)
		return err
	}
	return dst.Close()
}
