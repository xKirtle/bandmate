package backups

import (
	"archive/zip"
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
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
	return querySongs(ctx, r.db, `SELECT id, title FROM songs ORDER BY title COLLATE NOCASE, id`)
}

// querySongs lists the Songs query selects, by id and title.
func querySongs(ctx context.Context, q querier, query string) ([]Song, error) {
	rows, err := q.QueryContext(ctx, query)
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

// Replace lists, by their ids in a Backup, the Songs and Beats already in
// Bandmate that a Restore replaces rather than keeping both. Those it lists
// that the Restore doesn't bring back, or that aren't in Bandmate, are
// passed over.
type Replace struct {
	Songs []int64 `json:"songs"`
	Beats []int64 `json:"beats"`
}

// Picks is what a Restore brings back from a Backup: the Songs picked, by
// their ids in it, each with the Beats its Clips use, and the whole Beat
// Library or not. Every Song it holds, with its Beat Library if it holds
// one, is everything it holds.
type Picks struct {
	Songs       []int64 `json:"songs"`
	BeatLibrary bool    `json:"beatLibrary"`
}

// rowsPicked picks rows of a table to restore: where, given arg, a Song's
// id, or nothing for the Beat Library.
type rowsPicked struct {
	where string
	arg   any
}

// rows lists what picks the rows of table t to restore: its rows of each
// Song picked and, for the Beats, every one if the Beat Library is picked.
func (p Picks) rows(t songTable) []rowsPicked {
	var list []rowsPicked
	for _, song := range p.Songs {
		list = append(list, rowsPicked{t.where, song})
	}
	if p.BeatLibrary {
		for _, lib := range beatLibraryTables {
			if lib.name == t.name {
				list = append(list, rowsPicked{lib.where, nil})
			}
		}
	}
	return list
}

// Restored is what a Restore brought back: the Songs, by title, and how
// many Beats it added or replaced, with the Songs or as the Beat Library.
type Restored struct {
	Songs []Song `json:"songs"`
	Beats int    `json:"beats"`
}

// Restore brings back what picks picks from a Backup: Songs, each with the
// Beats its Clips use, and the Beat Library. It never deletes a Song or
// Beat the Backup doesn't hold. What it picks is copied in with fresh ids,
// all of it or, if anything fails, none. A Song or Beat
// already in Bandmate (the same one, by its identity) is kept, unless
// replace lists it: the restored one is added alongside, titled as
// restored, with an identity of its own, and a restored Song plays the
// Beats restored with it. A Song replaced is the Backup's version entirely,
// keeping its id, with a version past the one it had, so a write based on
// that is refused; what it had that the Backup's doesn't is gone. A Beat
// replaced keeps its id, its audio and its place in every Song using it,
// taking the Backup's Details.
func (s *Store) Restore(ctx context.Context, id int64, picks Picks, replace Replace) (Restored, error) {
	r, err := s.openBackup(ctx, id)
	if err != nil {
		return Restored{}, err
	}
	defer r.close()
	picked, err := r.pick(ctx, picks)
	if err != nil {
		return Restored{}, err
	}
	for _, song := range picked.Songs {
		if err := r.unpackFiles(ctx, songFiles, song); err != nil {
			return Restored{}, fmt.Errorf("restoring song %d: %w", song, err)
		}
	}
	if picked.BeatLibrary {
		if err := r.unpackFiles(ctx, beatLibraryFiles); err != nil {
			return Restored{}, fmt.Errorf("restoring the beat library: %w", err)
		}
	}
	// From here it's read attached to the live database.
	if err := r.closeDB(); err != nil {
		return Restored{}, err
	}
	return s.copyIn(ctx, r.staging, picked, replace)
}

// pick checks picks picks Songs the Backup holds, listing each once, or
// its Beat Library, if it holds one, or both.
func (r *openedBackup) pick(ctx context.Context, picks Picks) (Picks, error) {
	if len(picks.Songs) == 0 && !picks.BeatLibrary {
		return Picks{}, &InvalidError{"pick at least one Song, or the Beat Library, to restore"}
	}
	if picks.BeatLibrary && !r.backup.BeatLibrary {
		return Picks{}, &InvalidError{"the Backup doesn't hold the Beat Library"}
	}
	picked := Picks{Songs: []int64{}, BeatLibrary: picks.BeatLibrary}
	for _, song := range picks.Songs {
		if slices.Contains(picked.Songs, song) {
			continue
		}
		var exists int
		if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM songs WHERE id = ?`, song).Scan(&exists); err != nil {
			return Picks{}, err
		}
		if exists == 0 {
			return Picks{}, &InvalidError{"a Song picked isn't in the Backup"}
		}
		picked.Songs = append(picked.Songs, song)
	}
	return picked, nil
}

// Present is a Song or Beat a Backup holds, by its id and title there,
// that's already in Bandmate: the same one, by its identity.
type Present struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
	// InBandmate is the one in Bandmate, by its id and title here.
	InBandmate Song `json:"inBandmate"`
}

// Presence lists the Songs and Beats a Restore would bring back that are
// already in Bandmate, each by title, for the user to say which to replace
// and which to keep both.
type Presence struct {
	Songs []Present `json:"songs"`
	Beats []Present `json:"beats"`
}

// Present lists which of the Songs and Beats a Restore of picks would bring
// back are already in Bandmate.
func (s *Store) Present(ctx context.Context, id int64, picks Picks) (Presence, error) {
	r, err := s.openBackup(ctx, id)
	if err != nil {
		return Presence{}, err
	}
	defer r.close()
	picked, err := r.pick(ctx, picks)
	if err != nil {
		return Presence{}, err
	}
	ids, err := json.Marshal(picked.Songs)
	if err != nil {
		return Presence{}, err
	}
	var p Presence
	if p.Songs, err = s.present(ctx, r.db, "songs", `SELECT id, title, identity FROM songs
		WHERE id IN (SELECT value FROM json_each(?))`, string(ids)); err != nil {
		return Presence{}, err
	}
	if p.Beats, err = s.present(ctx, r.db, "beats", `SELECT id, title, identity FROM beats
		WHERE ?2 OR id IN (SELECT c.beat_id FROM clips c JOIN tracks t ON t.id = c.track_id
			WHERE t.song_id IN (SELECT value FROM json_each(?1)))`, string(ids), picked.BeatLibrary); err != nil {
		return Presence{}, err
	}
	return p, nil
}

// present lists, by title, the rows of table that query selects from the
// Backup's database, by id, title and identity, that are already in
// Bandmate.
func (s *Store) present(ctx context.Context, backup *sql.DB, table, query string, args ...any) ([]Present, error) {
	rows, err := backup.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	type held struct {
		Present
		identity string
	}
	var all []held
	for rows.Next() {
		var h held
		if err := rows.Scan(&h.ID, &h.Title, &h.identity); err != nil {
			rows.Close()
			return nil, err
		}
		all = append(all, h)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	list := []Present{}
	for _, h := range all {
		err := s.db.QueryRowContext(ctx, `SELECT id, title FROM `+table+` WHERE identity = ?`, h.identity).
			Scan(&h.InBandmate.ID, &h.InBandmate.Title)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		list = append(list, h.Present)
	}
	slices.SortFunc(list, func(a, b Present) int {
		return cmp.Or(strings.Compare(strings.ToLower(a.Title), strings.ToLower(b.Title)), cmp.Compare(a.ID, b.ID))
	})
	return list, nil
}

// openedBackup is a Backup's database, brought up to this Bandmate's schema
// in a staging directory, beside the files unpacked from it.
type openedBackup struct {
	backup  Backup
	file    *zip.ReadCloser
	staging string
	db      *sql.DB
}

// openBackup unpacks a Backup's database into a staging directory and runs
// the migrations on it, leaving the Backup's file as it is.
func (s *Store) openBackup(ctx context.Context, id int64) (*openedBackup, error) {
	b, err := s.get(ctx, id)
	if err != nil {
		return nil, err
	}
	file, err := zip.OpenReader(s.path(id))
	if err != nil {
		return nil, fmt.Errorf("opening backup file: %w", err)
	}
	r := &openedBackup{backup: b, file: file}
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

// closeDB closes the Backup's database, leaving it in the staging directory.
func (r *openedBackup) closeDB() error {
	if r.db == nil {
		return nil
	}
	err := r.db.Close()
	r.db = nil
	return err
}

// close closes the Backup and removes its staging directory.
func (r *openedBackup) close() {
	r.closeDB()
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

// unpackFiles unpacks the files listed by files, given args, each once.
func (r *openedBackup) unpackFiles(ctx context.Context, files []songFile, args ...any) error {
	for _, f := range files {
		ids, err := queryIDs(ctx, r.db, f.ids, args...)
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

// copyIn copies what picks picks from the Backup's database in staging
// into the live one in one transaction, with fresh ids, but for the Songs
// and Beats replace lists, linking in their unpacked files under those ids,
// and returns what it copied in.
func (s *Store) copyIn(ctx context.Context, staging string, picks Picks, replace Replace) (restored Restored, err error) {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return Restored{}, err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `ATTACH DATABASE ? AS src`, filepath.Join(staging, db.FileName)); err != nil {
		return Restored{}, fmt.Errorf("reading the backup database: %w", err)
	}
	defer conn.ExecContext(context.WithoutCancel(ctx), `DETACH DATABASE src`)
	columns, err := tableColumns(ctx, conn)
	if err != nil {
		return Restored{}, err
	}
	// The id each row copied in gets, by table and its id in the Backup:
	// a fresh one, unless it's a Song or Beat already in Bandmate that's
	// replaced, which takes the id of the one it replaces, and the version
	// that one had. A Song or Beat already in Bandmate that isn't replaced
	// is kept both.
	if _, err := conn.ExecContext(ctx, `CREATE TEMP TABLE restored (
		tbl TEXT NOT NULL, old INTEGER NOT NULL, new INTEGER NOT NULL,
		kept_both INTEGER NOT NULL, replaced INTEGER NOT NULL, prior_version INTEGER,
		PRIMARY KEY (tbl, old))`); err != nil {
		return Restored{}, err
	}
	defer conn.ExecContext(context.WithoutCancel(ctx), `DROP TABLE temp.restored`)

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return Restored{}, err
	}
	defer tx.Rollback()
	// A Clip and its active Take refer to each other, so their references
	// are checked once both are in.
	if _, err := tx.ExecContext(ctx, `PRAGMA defer_foreign_keys = ON`); err != nil {
		return Restored{}, err
	}
	if err := giveIDs(ctx, tx, columns, picks, replace); err != nil {
		return Restored{}, err
	}
	replacedFiles, err := clearReplacedSongs(ctx, tx)
	if err != nil {
		return Restored{}, err
	}
	now := s.now().UTC().Format(timeFormat)
	for _, t := range songTables {
		if err := copyTableIn(ctx, tx, t, columns[t.name], picks.Songs, now); err != nil {
			return Restored{}, fmt.Errorf("restoring %s: %w", t.name, err)
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
		return Restored{}, err
	}
	restored.Songs, err = querySongs(ctx, tx, `SELECT s.id, s.title FROM main.songs s
		JOIN temp.restored r ON r.tbl = 'songs' AND r.new = s.id ORDER BY s.title COLLATE NOCASE, s.id`)
	if err != nil {
		return Restored{}, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM temp.restored WHERE tbl = 'beats'`).
		Scan(&restored.Beats); err != nil {
		return Restored{}, err
	}
	if err := tx.Commit(); err != nil {
		return Restored{}, err
	}
	for _, f := range replacedFiles {
		if err := os.Remove(filepath.Join(s.dataDir, f)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			log.Printf("removing %s of a replaced song: %v", f, err)
		}
	}
	return restored, nil
}

// giveIDs picks, for each row of what picks picks, the id it gets in the
// live database: for a Song or Beat already in Bandmate that replace
// lists, the id of the one it replaces, and otherwise a fresh one, past
// every id its table has used, in the order of their ids in the Backup.
func giveIDs(ctx context.Context, tx *sql.Tx, columns map[string][]string, picks Picks, replace Replace) error {
	replacing := map[string][]int64{"songs": replace.Songs, "beats": replace.Beats}
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
		hasIdentity := slices.Contains(columns[t.name], "identity")
		keptBoth := "0"
		if hasIdentity {
			keptBoth = fmt.Sprintf(`EXISTS (SELECT 1 FROM main.%s m WHERE m.identity = r.identity)`, t.name)
		}
		replaced, err := json.Marshal(replacing[t.name])
		if err != nil {
			return err
		}
		priorVersion := "NULL"
		if slices.Contains(columns[t.name], "version") {
			priorVersion = fmt.Sprintf(`(SELECT m.version FROM main.%s m WHERE m.identity = r.identity)`, t.name)
		}
		for _, rows := range picks.rows(t) {
			if hasIdentity && len(replacing[t.name]) > 0 {
				if _, err := tx.ExecContext(ctx, fmt.Sprintf(`INSERT INTO temp.restored
					(tbl, old, new, kept_both, replaced, prior_version)
					SELECT '%[1]s', r.id, (SELECT m.id FROM main.%[1]s m WHERE m.identity = r.identity), 0, 1, %[2]s
					FROM src.%[1]s r
					WHERE (%[3]s) AND r.id IN (SELECT value FROM json_each(?2))
						AND r.identity IN (SELECT identity FROM main.%[1]s)
						AND r.id NOT IN (SELECT old FROM temp.restored WHERE tbl = '%[1]s')`,
					t.name, priorVersion, rows.where), rows.arg, string(replaced)); err != nil {
					return fmt.Errorf("picking %s to replace: %w", t.name, err)
				}
			}
			res, err := tx.ExecContext(ctx, fmt.Sprintf(`INSERT INTO temp.restored (tbl, old, new, kept_both, replaced)
				SELECT '%[1]s', r.id, ?2 + ROW_NUMBER() OVER (ORDER BY r.id), %[2]s, 0 FROM src.%[1]s r
				WHERE (%[3]s) AND r.id NOT IN (SELECT old FROM temp.restored WHERE tbl = '%[1]s')`,
				t.name, keptBoth, rows.where), rows.arg, next)
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

// clearReplacedSongs deletes the Songs a Restore replaces, and everything
// they own, so each is made anew as the Backup holds it, and returns the
// files they used, as paths in the data directory, to remove once that's
// committed.
func clearReplacedSongs(ctx context.Context, tx *sql.Tx) ([]string, error) {
	ids, err := queryIDs(ctx, tx, `SELECT new FROM temp.restored WHERE tbl = 'songs' AND replaced`)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, id := range ids {
		for _, f := range songFiles {
			if f.table == "beats" {
				continue
			}
			owned, err := queryIDs(ctx, tx, f.ids, id)
			if err != nil {
				return nil, err
			}
			for _, o := range owned {
				files = append(files, filepath.Join(filepath.FromSlash(f.dir), strconv.FormatInt(o, 10)))
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM main.songs
		WHERE id IN (SELECT new FROM temp.restored WHERE tbl = 'songs' AND replaced)`); err != nil {
		return nil, fmt.Errorf("clearing replaced songs: %w", err)
	}
	return files, nil
}

// copyTableIn copies the rows of table t given ids, or, for a table without
// ids, those of the Songs with ids, pointing each reference at the id of
// the row it refers to. A Song or Beat kept both gets an identity of its
// own, from the trigger giving one to each made without, and a title
// saying it's restored. A Song replaced gets a version past the one it had,
// and a Beat replaced takes the Backup's columns t lists as replaced in
// place, marked as updated now if that changes it.
func copyTableIn(ctx context.Context, tx *sql.Tx, t songTable, columns []string, songs []int64, now string) error {
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
		case c == "id":
			values[i] = freshID(t.name, c)
		case references[c] != "":
			values[i] = freshID(references[c], c)
		case c == "identity":
			values[i] = `CASE WHEN k.kept_both THEN NULL ELSE r.identity END`
		case c == "title" && keepsBoth:
			values[i] = `CASE WHEN k.kept_both THEN r.title || '` + keptBothSuffix + `' ELSE r.title END`
		case c == "version" && keepsBoth:
			values[i] = `CASE WHEN k.replaced THEN MAX(r.version, k.prior_version) + 1 ELSE r.version END`
		default:
			values[i] = `r."` + c + `"`
		}
	}
	insert := fmt.Sprintf(`INSERT INTO main.%s (%s) SELECT %s FROM src.%s r`,
		t.name, columnList(columns), strings.Join(values, ", "), t.name)
	if hasIDs {
		join := fmt.Sprintf(` JOIN temp.restored k ON k.tbl = '%s' AND k.old = r.id`, t.name)
		if t.replacedInPlace == nil {
			_, err := tx.ExecContext(ctx, insert+join+` ORDER BY r.id`)
			return err
		}
		if _, err := tx.ExecContext(ctx, insert+join+` WHERE NOT k.replaced ORDER BY r.id`); err != nil {
			return err
		}
		sets := make([]string, len(t.replacedInPlace))
		same := make([]string, len(t.replacedInPlace))
		for i, c := range t.replacedInPlace {
			sets[i] = fmt.Sprintf(`"%[1]s" = r."%[1]s"`, c)
			same[i] = fmt.Sprintf(`main.%[1]s."%[2]s" IS r."%[2]s"`, t.name, c)
		}
		_, err := tx.ExecContext(ctx, fmt.Sprintf(`UPDATE main.%[1]s
			SET %[2]s, updated_at = CASE WHEN %[3]s THEN main.%[1]s.updated_at ELSE ? END
			FROM src.%[1]s r JOIN temp.restored k ON k.tbl = '%[1]s' AND k.old = r.id
			WHERE k.replaced AND main.%[1]s.id = k.new`,
			t.name, strings.Join(sets, ", "), strings.Join(same, " AND ")), now)
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
		// A Beat replaced keeps its own file.
		rows, err := tx.QueryContext(ctx, `SELECT old, new FROM temp.restored WHERE tbl = ? AND NOT replaced`, f.table)
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
