package backups

import (
	"archive/zip"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/xKirtle/bandmate/internal/db"
)

// Song is a Song a Backup holds, by its id there, or one a Restore brought
// back, by its id here.
type Song struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// keptBothSuffix ends the title of a Song or Beat a Restore added alongside
// the same one already in Bandmate.
const keptBothSuffix = " (restored)"

// Songs lists the Songs a Backup holds, by title.
func (s *Store) Songs(ctx context.Context, id int64) ([]Song, error) {
	r, err := s.openBackup(ctx, id)
	if err != nil {
		return nil, err
	}
	defer r.close()
	rows, err := r.db.QueryContext(ctx, `SELECT id, title FROM songs ORDER BY title COLLATE NOCASE, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Song{}
	for rows.Next() {
		var song Song
		if err := rows.Scan(&song.ID, &song.Title); err != nil {
			return nil, err
		}
		list = append(list, song)
	}
	return list, rows.Err()
}

// Restore brings back the Songs a Backup holds with ids, each with the
// Beats its Clips use, and returns them, by title. They're copied in with
// fresh ids, all of them or, if anything fails, none. A Song or Beat
// already in Bandmate (the same one, by its identity) is kept: the restored
// one is added alongside, titled as restored, with an identity of its own,
// and a restored Song plays the Beats restored with it.
func (s *Store) Restore(ctx context.Context, id int64, songs []int64) ([]Song, error) {
	if len(songs) == 0 {
		return nil, &InvalidError{"pick at least one Song to restore"}
	}
	r, err := s.openBackup(ctx, id)
	if err != nil {
		return nil, err
	}
	defer r.close()
	picked := []int64{}
	for _, song := range songs {
		if slices.Contains(picked, song) {
			continue
		}
		var exists int
		if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM songs WHERE id = ?`, song).Scan(&exists); err != nil {
			return nil, err
		}
		if exists == 0 {
			return nil, &InvalidError{"a Song picked isn't in the Backup"}
		}
		picked = append(picked, song)
		if err := r.unpackFiles(ctx, song); err != nil {
			return nil, fmt.Errorf("restoring song %d: %w", song, err)
		}
	}
	// Done with on its own: from here it's read attached to the live database.
	if err := r.db.Close(); err != nil {
		return nil, err
	}
	r.db = nil
	return s.copyIn(ctx, r.staging, picked)
}

// openedBackup is a Backup's database, brought up to this Bandmate's schema
// in a staging directory, beside the files unpacked from it.
type openedBackup struct {
	file    *zip.ReadCloser
	staging string
	db      *sql.DB
}

// openBackup unpacks a Backup's database into a staging directory and runs
// the migrations on it, leaving the Backup's file as it is.
func (s *Store) openBackup(ctx context.Context, id int64) (*openedBackup, error) {
	if _, err := s.get(ctx, id); err != nil {
		return nil, err
	}
	file, err := zip.OpenReader(s.path(id))
	if err != nil {
		return nil, fmt.Errorf("opening backup file: %w", err)
	}
	r := &openedBackup{file: file}
	if r.staging, err = os.MkdirTemp(s.dir, makingPrefix+"*"); err != nil {
		r.close()
		return nil, fmt.Errorf("restoring backup: %w", err)
	}
	if err := r.unpack(db.FileName, filepath.Join(r.staging, db.FileName)); err != nil {
		r.close()
		return nil, fmt.Errorf("unpacking backup database: %w", err)
	}
	if r.db, err = db.Open(ctx, r.staging); err != nil {
		r.close()
		return nil, fmt.Errorf("opening backup database: %w", err)
	}
	return r, nil
}

func (r *openedBackup) close() {
	if r.db != nil {
		r.db.Close()
	}
	r.file.Close()
	if r.staging != "" {
		os.RemoveAll(r.staging)
	}
}

// unpack writes the Backup's file entry name to to.
func (r *openedBackup) unpack(name, to string) error {
	src, err := r.file.Open(name)
	if err != nil {
		return err
	}
	defer src.Close()
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}
	dst, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}

// stagedFile is where a file a Backup holds is unpacked to, kept under the
// id it has in the Backup.
func stagedFile(staging, dir string, id int64) string {
	return filepath.Join(staging, "files", filepath.FromSlash(dir), strconv.FormatInt(id, 10))
}

// unpackFiles unpacks the files the Song with id uses, each once.
func (r *openedBackup) unpackFiles(ctx context.Context, song int64) error {
	for _, f := range songFiles {
		ids, err := queryIDs(ctx, r.db, f.ids, song)
		if err != nil {
			return err
		}
		for _, id := range ids {
			to := stagedFile(r.staging, f.dir, id)
			if _, err := os.Stat(to); err == nil {
				continue
			}
			name := path.Join(f.dir, strconv.FormatInt(id, 10))
			if err := r.unpack(name, to); err != nil {
				return fmt.Errorf("unpacking %s: %w", name, err)
			}
		}
	}
	return nil
}

// copyIn copies the Songs with ids, and the Beats their Clips use, from the
// Backup's database in staging into the live one in one transaction, with
// fresh ids, linking in their unpacked files under those ids, and returns
// the Songs copied in.
func (s *Store) copyIn(ctx context.Context, staging string, songs []int64) (restored []Song, err error) {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `ATTACH DATABASE ? AS src`, filepath.Join(staging, db.FileName)); err != nil {
		return nil, fmt.Errorf("reading the backup database: %w", err)
	}
	defer conn.ExecContext(context.WithoutCancel(ctx), `DETACH DATABASE src`)
	columns, err := tableColumns(ctx, conn)
	if err != nil {
		return nil, err
	}
	// The fresh id each row copied in gets, by table and its id in the
	// Backup, and whether it's a Song or Beat already in Bandmate, so kept
	// both.
	if _, err := conn.ExecContext(ctx, `CREATE TEMP TABLE restored (
		tbl TEXT NOT NULL, old INTEGER NOT NULL, new INTEGER NOT NULL, kept_both INTEGER NOT NULL,
		PRIMARY KEY (tbl, old))`); err != nil {
		return nil, err
	}
	defer conn.ExecContext(context.WithoutCancel(ctx), `DROP TABLE temp.restored`)

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// A Clip and its active Take refer to each other, so their references
	// are checked once both are in.
	if _, err := tx.ExecContext(ctx, `PRAGMA defer_foreign_keys = ON`); err != nil {
		return nil, err
	}
	if err := giveFreshIDs(ctx, tx, columns, songs); err != nil {
		return nil, err
	}
	for _, t := range songTables {
		if err := copyTableIn(ctx, tx, t, columns[t.name], songs); err != nil {
			return nil, fmt.Errorf("restoring %s: %w", t.name, err)
		}
	}
	linked, err := s.linkFilesIn(ctx, tx, staging)
	defer func() {
		if err != nil {
			for _, p := range linked {
				os.Remove(p)
			}
		}
	}()
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT s.id, s.title FROM main.songs s
		JOIN temp.restored r ON r.tbl = 'songs' AND r.new = s.id ORDER BY s.title COLLATE NOCASE, s.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var song Song
		if err := rows.Scan(&song.ID, &song.Title); err != nil {
			return nil, err
		}
		restored = append(restored, song)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	return restored, tx.Commit()
}

// giveFreshIDs picks, for each row of the Songs with ids, and of the Beats
// their Clips use, the id it gets in the live database: past every id its
// table has used, in the order of their ids in the Backup.
func giveFreshIDs(ctx context.Context, tx *sql.Tx, columns map[string][]string, songs []int64) error {
	for _, t := range songTables {
		if !slices.Contains(columns[t.name], "id") {
			continue
		}
		var next int64
		if err := tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT MAX(
			COALESCE((SELECT MAX(id) FROM main.%[1]s), 0),
			COALESCE((SELECT seq FROM main.sqlite_sequence WHERE name = '%[1]s'), 0))`, t.name)).Scan(&next); err != nil {
			return err
		}
		keptBoth := "0"
		if slices.Contains(columns[t.name], "identity") {
			keptBoth = fmt.Sprintf(`EXISTS (SELECT 1 FROM main.%s m WHERE m.identity = r.identity)`, t.name)
		}
		for _, song := range songs {
			res, err := tx.ExecContext(ctx, fmt.Sprintf(`INSERT INTO temp.restored (tbl, old, new, kept_both)
				SELECT '%[1]s', r.id, ?2 + ROW_NUMBER() OVER (ORDER BY r.id), %[2]s FROM src.%[1]s r
				WHERE (%[3]s) AND r.id NOT IN (SELECT old FROM temp.restored WHERE tbl = '%[1]s')`,
				t.name, keptBoth, t.where), song, next)
			if err != nil {
				return fmt.Errorf("picking ids for %s: %w", t.name, err)
			}
			n, err := res.RowsAffected()
			if err != nil {
				return err
			}
			next += n
		}
	}
	return nil
}

// copyTableIn copies the rows of table t given fresh ids, or, for a table
// without ids, those of the Songs with ids, pointing each reference at the
// fresh id of the row it refers to. A Song or Beat kept both gets an
// identity of its own, from the trigger giving one to each made without,
// and a title saying it's restored.
func copyTableIn(ctx context.Context, tx *sql.Tx, t songTable, columns []string, songs []int64) error {
	references, err := foreignKeys(ctx, tx, t.name)
	if err != nil {
		return err
	}
	freshID := func(table, column string) string {
		return fmt.Sprintf(`(SELECT new FROM temp.restored WHERE tbl = '%s' AND old = r."%s")`, table, column)
	}
	hasIDs := slices.Contains(columns, "id")
	keepsBoth := slices.Contains(columns, "identity")
	values := make([]string, len(columns))
	for i, c := range columns {
		switch {
		case c == "id" && hasIDs:
			values[i] = freshID(t.name, c)
		case references[c] != "":
			values[i] = freshID(references[c], c)
		case c == "identity" && keepsBoth:
			values[i] = `CASE WHEN k.kept_both THEN NULL ELSE r.identity END`
		case c == "title" && keepsBoth:
			values[i] = `CASE WHEN k.kept_both THEN r.title || '` + keptBothSuffix + `' ELSE r.title END`
		default:
			values[i] = `r."` + c + `"`
		}
	}
	insert := fmt.Sprintf(`INSERT INTO main.%s (%s) SELECT %s FROM src.%s r`,
		t.name, columnList(columns), strings.Join(values, ", "), t.name)
	if hasIDs {
		_, err := tx.ExecContext(ctx, insert+fmt.Sprintf(
			` JOIN temp.restored k ON k.tbl = '%s' AND k.old = r.id ORDER BY r.id`, t.name))
		return err
	}
	for _, song := range songs {
		if _, err := tx.ExecContext(ctx, insert+` WHERE `+t.where, song); err != nil {
			return err
		}
	}
	return nil
}

// foreignKeys maps each column of table referring to another table's rows
// to that table.
func foreignKeys(ctx context.Context, tx *sql.Tx, table string) (map[string]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT "from", "table" FROM main.pragma_foreign_key_list(?)`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	references := map[string]string{}
	for rows.Next() {
		var column, parent string
		if err := rows.Scan(&column, &parent); err != nil {
			return nil, err
		}
		references[column] = parent
	}
	return references, rows.Err()
}

// linkFilesIn puts the files unpacked in staging into the data directory,
// each under the fresh id of the row using it, and returns those it put
// there.
func (s *Store) linkFilesIn(ctx context.Context, tx *sql.Tx, staging string) ([]string, error) {
	var linked []string
	for _, f := range songFiles {
		rows, err := tx.QueryContext(ctx, `SELECT old, new FROM temp.restored WHERE tbl = ?`, f.table)
		if err != nil {
			return linked, err
		}
		type move struct{ old, new int64 }
		var moves []move
		for rows.Next() {
			var m move
			if err := rows.Scan(&m.old, &m.new); err != nil {
				rows.Close()
				return linked, err
			}
			moves = append(moves, m)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return linked, err
		}
		if len(moves) == 0 {
			continue
		}
		dir := filepath.Join(s.dataDir, filepath.FromSlash(f.dir))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return linked, err
		}
		for _, m := range moves {
			to := filepath.Join(dir, strconv.FormatInt(m.new, 10))
			if err := os.Remove(to); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return linked, err
			}
			if err := linkOrCopy(stagedFile(staging, f.dir, m.old), to); err != nil {
				return linked, fmt.Errorf("restoring %s %d: %w", f.dir, m.old, err)
			}
			linked = append(linked, to)
		}
	}
	return linked, nil
}
