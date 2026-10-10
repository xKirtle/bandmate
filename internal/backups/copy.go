package backups

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/xKirtle/bandmate/internal/db"
	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songfiles"
)

// songTable is a table holding rows that belong to a Song, or to the Beat
// Library, and which of them go in a Backup, or come back on a Restore:
// where picks them from the database they're copied from, attached as
// "src" (the live one when backing up, the Backup's when restoring), given
// a Song's id as its one parameter for a Song's tables, and nothing for the
// Beat Library's. Detached Takes, and Sounds no Clip uses, are kept only
// for undo, which never outlasts a session, so a Backup leaves them out.
type songTable struct {
	name  string
	where string
	// shared rows, i.e. Folders, Tags and Beats, may already be in the
	// Backup from another Song.
	shared bool
	// replacedInPlace lists, for a table whose rows a Restore can replace
	// and whose replaced rows keep their place, i.e. Beats, the columns
	// they take from the Backup. A Song replaced is made anew instead.
	replacedInPlace []string
	// matchedBy names, for a table whose rows a Restore matches to those
	// already in Bandmate by a column rather than by identity, i.e. Folders
	// and Tags by their folded names (see ADR 0015), that column. A row
	// matched is used as it is, and one with no match is added, as is one
	// whose match went with a Song replaced, as a Tag goes with the last
	// Song carrying it, keeping that match's id and name.
	matchedBy string
}

// songTables lists, parents first, every table holding a Song's rows.
var songTables = []songTable{
	// A Song's Folder, which other Songs may sit in too.
	{name: "folders", shared: true, matchedBy: "folded",
		where: `id IN (SELECT folder_id FROM src.songs WHERE id = ?1)`},
	{name: "songs", where: `id = ?1`},
	{name: "sections", where: `song_id = ?1`},
	{name: "alternates", where: `section_id IN (SELECT id FROM src.sections WHERE song_id = ?1)`},
	{name: "lines", where: `alternate_id IN (SELECT a.id FROM src.alternates a
		JOIN src.sections s ON s.id = a.section_id WHERE s.song_id = ?1)`},
	{name: "masters", where: `song_id = ?1`},
	{name: "covers", where: `song_id = ?1`},
	{name: "loops", where: `song_id = ?1`},
	{name: "tracks", where: `song_id = ?1`},
	// A Song's Tags, which other Songs may carry too.
	{name: "tags", shared: true, matchedBy: "folded",
		where: `id IN (SELECT tag_id FROM src.song_tags WHERE song_id = ?1)`},
	{name: "song_tags", where: `song_id = ?1`},
	// A Beat replaced keeps its place in every Song using it, and its audio,
	// taking the Backup's Details: its title, credit (producer and source
	// link), BPM, Key and Notes.
	{name: "beats", shared: true,
		replacedInPlace: []string{"title", "producer", "source_link", "bpm", "beat_key", "notes"},
		where: `id IN (SELECT c.beat_id FROM src.clips c
		JOIN src.tracks t ON t.id = c.track_id WHERE t.song_id = ?1)`},
	{name: "sounds", where: `id IN (SELECT c.sound_id FROM src.clips c
		JOIN src.tracks t ON t.id = c.track_id WHERE t.song_id = ?1)`},
	{name: "clips", where: `track_id IN (SELECT id FROM src.tracks WHERE song_id = ?1)`},
	{name: "takes", where: `clip_id IN (SELECT c.id FROM src.clips c
		JOIN src.tracks t ON t.id = c.track_id WHERE t.song_id = ?1)`},
}

// notCopied are the tables holding nothing of a Song: the schema's own
// bookkeeping, the Bandmate that last ran on the database, and the Backups.
var notCopied = map[string]bool{
	"schema_migrations": true, "sqlite_sequence": true, "bandmate_version": true, "backups": true,
}

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
var beatLibraryFiles = []songfiles.Kind{{Dir: songfiles.Beats.Dir, Table: songfiles.Beats.Table, IDs: `SELECT id FROM main.beats`}}

// chosenBeatsTables picks the Beats chosen, by their ids as a JSON array,
// some of which may already be in the Backup from a Song.
var chosenBeatsTables = []songTable{{name: "beats", shared: true, where: `id IN (SELECT value FROM json_each(?1))`}}

// chosenBeatsFiles lists the files the chosen Beats' rows use.
var chosenBeatsFiles = []songfiles.Kind{{Dir: songfiles.Beats.Dir, Table: songfiles.Beats.Table,
	IDs: `SELECT id FROM main.beats WHERE id IN (SELECT value FROM json_each(?1))`}}

// held is how many Songs and Beats a Backup holds.
type held struct{ songs, beats int }

// copyContents makes, in staging, a database holding the Songs with songIDs,
// with the Beats their Clips use, and the Beats with beatIDs, or the whole
// Beat Library if beatLibrary is set, laid out with their files like a data
// directory, and returns how many Songs and Beats it holds.
func (s *Store) copyContents(ctx context.Context, staging string, songIDs, beatIDs []int64, beatLibrary bool) (held, error) {
	var h held
	backup, err := db.Open(ctx, staging)
	if err != nil {
		return h, fmt.Errorf("making backup database: %w", err)
	}
	defer backup.Close()
	conn, err := backup.Conn(ctx)
	if err != nil {
		return h, err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `ATTACH DATABASE ? AS src`, filepath.Join(s.dataDir, db.FileName)); err != nil {
		return h, fmt.Errorf("reading the database: %w", err)
	}
	columns, err := tableColumns(ctx, conn)
	if err != nil {
		return h, err
	}
	for _, id := range songIDs {
		found, err := s.copyRows(ctx, conn, staging, columns, songTables, songfiles.Kinds, id)
		if err != nil {
			return h, fmt.Errorf("backing up song %d: %w", id, err)
		}
		if found {
			h.songs++
		}
	}
	if beatLibrary {
		if _, err := s.copyRows(ctx, conn, staging, columns, beatLibraryTables, beatLibraryFiles); err != nil {
			return h, fmt.Errorf("backing up the beat library: %w", err)
		}
	}
	if len(beatIDs) > 0 {
		picked, err := json.Marshal(beatIDs)
		if err != nil {
			return h, err
		}
		if _, err := s.copyRows(ctx, conn, staging, columns, chosenBeatsTables, chosenBeatsFiles, string(picked)); err != nil {
			return h, fmt.Errorf("backing up the beats picked: %w", err)
		}
	}
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM main.beats`).Scan(&h.beats); err != nil {
		return h, err
	}
	if _, err := conn.ExecContext(ctx, `DETACH DATABASE src`); err != nil {
		return h, err
	}
	// One file, with nothing left in a write-ahead log beside it.
	if _, err := conn.ExecContext(ctx, `PRAGMA journal_mode = DELETE`); err != nil {
		return h, err
	}
	return h, nil
}

// copyRows copies the rows tables pick, given args, with the files they
// use, trying again if a file is removed meanwhile. It tells whether a Song
// was there to copy: whether the first table not shared picked a row.
func (s *Store) copyRows(ctx context.Context, conn *sql.Conn, staging string, columns map[string][]string,
	tables []songTable, files []songfiles.Kind, args ...any) (bool, error) {
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
func tableColumns(ctx context.Context, conn *sql.Conn) (map[string][]string, error) {
	known := map[string]bool{}
	for _, t := range songTables {
		known[t.name] = true
	}
	rows, err := conn.QueryContext(ctx, `SELECT name FROM src.sqlite_master WHERE type = 'table'`)
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
	columns := map[string][]string{}
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
			names = append(names, name)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		columns[t.name] = names
	}
	return columns, nil
}

// columnList lists columns for a statement, quoted.
func columnList(columns []string) string {
	quoted := make([]string, len(columns))
	for i, c := range columns {
		quoted[i] = `"` + c + `"`
	}
	return strings.Join(quoted, ", ")
}

// copyOnce copies the rows tables pick in one transaction, so they're all
// read from one snapshot of the live database, e.g. a whole Song, and links
// in the files they use before committing. It tells whether the first
// table not shared picked a row; if it picked none, nothing is copied.
func (s *Store) copyOnce(ctx context.Context, conn *sql.Conn, staging string, columns map[string][]string,
	tables []songTable, files []songfiles.Kind, args []any) (bool, error) {
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
	songCounted := false
	for _, t := range tables {
		insert := "INSERT INTO"
		if t.shared {
			insert = "INSERT OR IGNORE INTO"
		}
		list := columnList(columns[t.name])
		res, err := tx.ExecContext(ctx, fmt.Sprintf(`%s main.%s (%s) SELECT %s FROM src.%s WHERE %s`,
			insert, t.name, list, list, t.name, t.where), args...)
		if err != nil {
			return false, fmt.Errorf("copying %s: %w", t.name, err)
		}
		if !songCounted && !t.shared {
			songCounted = true
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
func (s *Store) linkFiles(ctx context.Context, tx *sql.Tx, staging string, files []songfiles.Kind, args []any) ([]string, error) {
	var linked []string
	for _, f := range files {
		ids, err := queryIDs(ctx, tx, f.IDs, args...)
		if err != nil {
			return linked, err
		}
		if len(ids) == 0 {
			continue
		}
		if err := os.MkdirAll(filepath.Join(staging, f.Dir), 0o755); err != nil {
			return linked, err
		}
		for _, id := range ids {
			name := strconv.FormatInt(id, 10)
			to := filepath.Join(staging, f.Dir, name)
			if _, err := os.Stat(to); err == nil {
				continue
			}
			if err := linkOrCopy(filepath.Join(s.dataDir, f.Dir, name), to); err != nil {
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

// queryIDs lists the ids query selects.
func queryIDs(ctx context.Context, q domain.Queryer, query string, args ...any) ([]int64, error) {
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
