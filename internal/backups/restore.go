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
	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/song"
	"github.com/xKirtle/bandmate/internal/songfiles"
)

// Song is a Song a Backup holds, by its id there, or one a Restore brought
// back, by its id here, with the name of the Folder it sits in there or
// here, nil for none.
type Song struct {
	ID     int64   `json:"id"`
	Title  string  `json:"title"`
	Folder *string `json:"folder"`
}

// keptBothSuffix ends the title of a Song or Beat a Restore added alongside
// the same one already in Bandmate.
const keptBothSuffix = " (restored)"

// Songs lists the Songs the Backup holds, by title, each with the Folder it
// sat in.
func (r *OpenedBackup) Songs(ctx context.Context) ([]Song, error) {
	return querySongs(ctx, r.db, `SELECT s.id, s.title, f.name FROM songs s
		LEFT JOIN folders f ON f.id = s.folder_id ORDER BY s.title COLLATE NOCASE, s.id`)
}

// querySongs lists the Songs query selects, by id, title and Folder name,
// NULL for none.
func querySongs(ctx context.Context, q domain.Queryer, query string) ([]Song, error) {
	rows, err := q.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Song{}
	for rows.Next() {
		var song Song
		if err := rows.Scan(&song.ID, &song.Title, &song.Folder); err != nil {
			return nil, err
		}
		list = append(list, song)
	}
	return list, rows.Err()
}

// Beat is a Beat a Backup holds, by its id there, with its title,
// producer, and the Songs it holds whose Clips use it, by their ids there.
type Beat struct {
	ID       int64    `json:"id"`
	Title    string   `json:"title"`
	Producer string   `json:"producer"`
	Songs    []SongID `json:"songs"`
}

// SongID is a Song by its id alone.
type SongID struct {
	ID int64 `json:"id"`
}

// Beats lists the Beats the Backup holds, by title, each with the Songs it
// holds that use it.
func (r *OpenedBackup) Beats(ctx context.Context) ([]Beat, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT b.id, b.title, b.producer, COALESCE(json_group_array(DISTINCT t.song_id)
			FILTER (WHERE t.song_id IS NOT NULL), '[]')
		FROM beats b LEFT JOIN clips c ON c.beat_id = b.id LEFT JOIN tracks t ON t.id = c.track_id
		GROUP BY b.id ORDER BY b.title COLLATE NOCASE, b.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Beat{}
	for rows.Next() {
		var b Beat
		var songs string
		if err := rows.Scan(&b.ID, &b.Title, &b.Producer, &songs); err != nil {
			return nil, err
		}
		var ids []int64
		if err := json.Unmarshal([]byte(songs), &ids); err != nil {
			return nil, err
		}
		b.Songs = []SongID{}
		for _, song := range ids {
			b.Songs = append(b.Songs, SongID{song})
		}
		list = append(list, b)
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

// Picks is what a Restore brings back from a Backup: the Songs and the
// Beats picked, by their ids in it, each Song with the Beats its Clips use,
// whether they're picked or not.
type Picks struct {
	Songs []int64 `json:"songs"`
	Beats []int64 `json:"beats"`
}

// rowsPicked picks rows of a table to restore: where, given arg, a Song's
// id, or the Beats picked as a JSON array.
type rowsPicked struct {
	where string
	arg   any
}

// rows lists what picks the rows of table t to restore: its rows of each
// Song picked and, for the Beats, those picked.
func (p Picks) rows(t songTable) ([]rowsPicked, error) {
	var list []rowsPicked
	for _, song := range p.Songs {
		list = append(list, rowsPicked{t.where, song})
	}
	if len(p.Beats) == 0 {
		return list, nil
	}
	beats, err := json.Marshal(p.Beats)
	if err != nil {
		return nil, err
	}
	for _, chosen := range chosenBeatsTables {
		if chosen.name == t.name {
			list = append(list, rowsPicked{chosen.where, string(beats)})
		}
	}
	return list, nil
}

// Restored is what a Restore brought back: the Songs, by title, and how
// many Beats it added or replaced, picked or brought by the Songs.
type Restored struct {
	Songs []Song `json:"songs"`
	Beats int    `json:"beats"`
}

// Restore brings back what picks names from the Backup: Songs, each with the
// Beats its Clips use, and Beats. It never deletes a Song or Beat the
// Backup doesn't hold. What it picks is copied in with fresh ids, all of
// it or, if anything fails, none. A Song or Beat already in Bandmate (the same one, by its identity) is kept, unless
// replace lists it: the restored one is added alongside, titled as
// restored, with an identity of its own, and a restored Song plays the
// Beats restored with it. A Song replaced is the Backup's version entirely,
// keeping its id, with a version past the one it had, so a write based on
// that is refused; what it had that the Backup's doesn't is gone. A Beat
// replaced keeps its id, its audio and its place in every Song using it,
// taking the Backup's Details. A Song, added, kept both or replaced, goes
// into the Folder of the same name as its Folder in the Backup, ignoring
// case, made if there's none, or into none if it's in none there. It
// carries exactly the Tags it carries in the Backup, each the Tag of the
// same name, ignoring case, made if there's none. It's the last thing
// asked of the opened Backup: ask it its Songs, its Beats and what's
// already in Bandmate first, and close it after.
func (r *OpenedBackup) Restore(ctx context.Context, picks Picks, replace Replace) (Restored, error) {
	return r.restore(ctx, picks, replace, false)
}

// restore brings back what picks names from the opened Backup, as Restore
// does. If demo is set, what it brings back is the Demo, replacing the one
// in Bandmate (see PutDemoBack).
func (r *OpenedBackup) restore(ctx context.Context, picks Picks, replace Replace, demo bool) (Restored, error) {
	picked, err := r.pick(ctx, picks)
	if err != nil {
		return Restored{}, err
	}
	for _, song := range picked.Songs {
		if err := r.unpackFiles(ctx, songfiles.Kinds, song); err != nil {
			return Restored{}, fmt.Errorf("restoring song %d: %w", song, err)
		}
	}
	if len(picked.Beats) > 0 {
		beats, err := json.Marshal(picked.Beats)
		if err != nil {
			return Restored{}, err
		}
		if err := r.unpackFiles(ctx, chosenBeatsFiles, string(beats)); err != nil {
			return Restored{}, fmt.Errorf("restoring the beats picked: %w", err)
		}
	}
	// From here it's read attached to the live database.
	if err := r.closeDB(); err != nil {
		return Restored{}, err
	}
	return r.store.copyIn(ctx, r.staging, picked, replace, demo)
}

// pick checks picks names Songs and Beats the Backup holds, at least one,
// listing each once.
func (r *OpenedBackup) pick(ctx context.Context, picks Picks) (Picks, error) {
	if len(picks.Songs) == 0 && len(picks.Beats) == 0 {
		return Picks{}, domain.Invalid("pick at least one Song or Beat to restore")
	}
	var picked Picks
	var err error
	if picked.Songs, err = r.held(ctx, "songs", picks.Songs, "a Song picked isn't in the Backup"); err != nil {
		return Picks{}, err
	}
	if picked.Beats, err = r.held(ctx, "beats", picks.Beats, "a Beat picked isn't in the Backup"); err != nil {
		return Picks{}, err
	}
	return picked, nil
}

// held lists ids once each, refusing with missing if one isn't in the
// Backup's table, which is a constant.
func (r *OpenedBackup) held(ctx context.Context, table string, ids []int64, missing string) ([]int64, error) {
	list := []int64{}
	for _, id := range ids {
		if slices.Contains(list, id) {
			continue
		}
		var exists int
		if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+table+` WHERE id = ?`, id).Scan(&exists); err != nil {
			return nil, err
		}
		if exists == 0 {
			return nil, domain.Invalid(missing)
		}
		list = append(list, id)
	}
	return list, nil
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
func (r *OpenedBackup) Present(ctx context.Context, picks Picks) (Presence, error) {
	picked, err := r.pick(ctx, picks)
	if err != nil {
		return Presence{}, err
	}
	ids, err := json.Marshal(picked.Songs)
	if err != nil {
		return Presence{}, err
	}
	beats, err := json.Marshal(picked.Beats)
	if err != nil {
		return Presence{}, err
	}
	var p Presence
	if p.Songs, err = r.present(ctx, "songs", `SELECT id, title, identity FROM songs
		WHERE id IN (SELECT value FROM json_each(?))`, string(ids)); err != nil {
		return Presence{}, err
	}
	if p.Beats, err = r.present(ctx, "beats", `SELECT id, title, identity FROM beats
		WHERE id IN (SELECT value FROM json_each(?2)) OR id IN (SELECT c.beat_id FROM clips c
			JOIN tracks t ON t.id = c.track_id WHERE t.song_id IN (SELECT value FROM json_each(?1)))`,
		string(ids), string(beats)); err != nil {
		return Presence{}, err
	}
	return p, nil
}

// present lists, by title, the rows of table that query selects from the
// Backup's database, by id, title and identity, that are already in
// Bandmate.
func (r *OpenedBackup) present(ctx context.Context, table, query string, args ...any) ([]Present, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
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
		err := r.store.db.QueryRowContext(ctx, `SELECT id, title FROM `+table+` WHERE identity = ?`, h.identity).
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

// OpenedBackup is a Backup's database, brought up to this Bandmate's schema
// in a staging directory, beside the files unpacked from it. It's what the
// Backup's Songs, its Beats, and what of them is already in Bandmate are
// asked of, so they're asked of one unpacking, and it's closed once they
// have been. A Restore is the last thing asked of it: it reads the
// Backup's database attached to the live one, so nothing can be asked of
// it afterwards.
type OpenedBackup struct {
	store   *Store
	file    *zip.ReadCloser
	staging string
	db      *sql.DB
}

// OpenBackup opens the Backup with the given id: it unpacks its database
// into a staging directory and runs the migrations on it, leaving the
// Backup's file as it is. A Backup there's no row for isn't found. The
// caller closes it.
func (s *Store) OpenBackup(ctx context.Context, id int64) (*OpenedBackup, error) {
	if _, err := s.get(ctx, id); err != nil {
		return nil, err
	}
	return s.openFile(ctx, s.path(id))
}

// A Backup's file that can't be restored is refused whole, saying why.
var (
	errDamaged = domain.Invalid("the Backup is damaged")
	errNewer   = domain.Invalid("the Backup was made by a newer Bandmate: update Bandmate to restore it")
)

// damagedBy is err, met reading a Backup's file, as the Backup being
// damaged.
func damagedBy(err error) error {
	return fmt.Errorf("%w: %v", errDamaged, err)
}

// damagedOnRead reads a Backup's file entry, any failure to read it, such
// as its bytes not matching their checksum, meaning the Backup is damaged.
type damagedOnRead struct{ r io.Reader }

func (d damagedOnRead) Read(p []byte) (int, error) {
	n, err := d.r.Read(p)
	if err != nil && !errors.Is(err, io.EOF) {
		err = damagedBy(err)
	}
	return n, err
}

// openFile unpacks the database of the Backup's file at path into a
// staging directory and runs the migrations on it, leaving the file as it
// is. It refuses a file that can't be read as a Backup as damaged, and one
// a newer Bandmate made.
func (s *Store) openFile(ctx context.Context, path string) (*OpenedBackup, error) {
	file, err := zip.OpenReader(path)
	if err != nil {
		return nil, damagedBy(err)
	}
	r := &OpenedBackup{store: s, file: file}
	if r.staging, err = os.MkdirTemp(s.dir, makingPrefix+"*"); err != nil {
		r.Close()
		return nil, fmt.Errorf("restoring backup: %w", err)
	}
	if err := r.unpack(db.FileName, filepath.Join(r.staging, db.FileName)); err != nil {
		r.Close()
		return nil, fmt.Errorf("unpacking backup database: %w", err)
	}
	if r.db, err = db.OpenNoNewer(ctx, r.staging); err != nil {
		r.Close()
		if errors.Is(err, db.ErrNewer) {
			return nil, errNewer
		}
		return nil, damagedBy(err)
	}
	return r, nil
}

// closeDB closes the Backup's database, leaving it in the staging directory.
func (r *OpenedBackup) closeDB() error {
	if r.db == nil {
		return nil
	}
	err := r.db.Close()
	r.db = nil
	return err
}

// Close closes the Backup and removes its staging directory.
func (r *OpenedBackup) Close() {
	r.closeDB()
	r.file.Close()
	if r.staging != "" {
		os.RemoveAll(r.staging)
	}
}

// unpack writes the Backup's file entry name to to. An entry missing, or
// not as it was written, means the Backup is damaged.
func (r *OpenedBackup) unpack(name, to string) error {
	src, err := r.file.Open(name)
	if err != nil {
		return damagedBy(err)
	}
	defer src.Close()
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}
	dst, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, damagedOnRead{src}); err != nil {
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
func (r *OpenedBackup) unpackFiles(ctx context.Context, files []songfiles.Kind, args ...any) error {
	for _, f := range files {
		ids, err := queryIDs(ctx, r.db, f.IDs, args...)
		if err != nil {
			return err
		}
		for _, id := range ids {
			to := stagedFile(r.staging, f.Dir, id)
			if _, err := os.Stat(to); err == nil {
				continue
			}
			name := path.Join(f.Dir, strconv.FormatInt(id, 10))
			if err := r.unpack(name, to); err != nil {
				return fmt.Errorf("unpacking %s: %w", name, err)
			}
		}
	}
	return nil
}

// copyIn copies what picks names from the Backup's database in staging
// into the live one in one transaction, with fresh ids, but for the Songs
// and Beats replace lists, linking in their unpacked files under those ids,
// and returns what it copied in. If demo is set, it first deletes the Demo
// in Bandmate, and marks what it copies in as the Demo.
func (s *Store) copyIn(ctx context.Context, staging string, picks Picks, replace Replace, demo bool) (restored Restored, err error) {
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
	// is kept both. A Folder or Tag matching one in Bandmate by name is
	// matched: it takes that one's id, and that one is used as it is, or
	// added back under that id and its name here, matched_name, if it went
	// with a Song replaced.
	if _, err := conn.ExecContext(ctx, `CREATE TEMP TABLE restored (
		tbl TEXT NOT NULL, old INTEGER NOT NULL, new INTEGER NOT NULL,
		kept_both INTEGER NOT NULL, replaced INTEGER NOT NULL,
		matched INTEGER NOT NULL DEFAULT 0, matched_name TEXT, prior_version INTEGER,
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
	var demoFiles []string
	if demo {
		if demoFiles, err = clearDemo(ctx, tx); err != nil {
			return Restored{}, err
		}
	}
	if err := giveIDs(ctx, tx, columns, picks, replace); err != nil {
		return Restored{}, err
	}
	replacedFiles, err := clearReplacedSongs(ctx, tx)
	if err != nil {
		return Restored{}, err
	}
	now := s.now().UTC().Format(domain.TimeFormat)
	for _, t := range songTables {
		if err := copyTableIn(ctx, tx, t, columns[t.name], picks.Songs, now); err != nil {
			return Restored{}, fmt.Errorf("restoring %s: %w", t.name, err)
		}
	}
	if err := remapSnapshots(ctx, tx); err != nil {
		return Restored{}, fmt.Errorf("restoring snapshots: %w", err)
	}
	if demo {
		if err := markDemo(ctx, tx); err != nil {
			return Restored{}, err
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
	restored.Songs, err = querySongs(ctx, tx, `SELECT s.id, s.title, f.name FROM main.songs s
		JOIN temp.restored r ON r.tbl = 'songs' AND r.new = s.id
		LEFT JOIN main.folders f ON f.id = s.folder_id ORDER BY s.title COLLATE NOCASE, s.id`)
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
	for _, f := range append(replacedFiles, demoFiles...) {
		// A row copied in may have taken the id of one cleared, and its
		// file is in that place now.
		path := filepath.Join(s.dataDir, f)
		if slices.Contains(linked, path) {
			continue
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			log.Printf("removing %s of a song or beat cleared: %v", f, err)
		}
	}
	return restored, nil
}

// giveIDs picks, for each row of what picks names, the id it gets in the
// live database. The four tables that decide anything — Folders and Tags
// matched by their folded names, Songs and Beats replaced or kept both —
// have theirs decided as a value, from what the Backup holds and what's
// already in Bandmate (see identity.go). The rows of the rest decide
// nothing, so theirs are picked in SQL, where the rows are: those are the
// tables holding the most rows, and reading them into Go to write them
// straight back would buy nothing (ADR 0026).
func giveIDs(ctx context.Context, tx *sql.Tx, columns map[string][]string, picks Picks, replace Replace) error {
	replacing := map[string][]int64{"songs": replace.Songs, "beats": replace.Beats}
	for _, t := range songTables {
		if !slices.Contains(columns[t.name], "id") {
			continue
		}
		picked, err := picks.rows(t)
		if err != nil {
			return err
		}
		if t.matchedBy != "" || slices.Contains(columns[t.name], "identity") {
			err = giveDecidedIDs(ctx, tx, t, columns[t.name], picked, replacing[t.name])
		} else {
			err = giveFreshIDs(ctx, tx, t, picked)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// giveDecidedIDs works out the id decisions for the rows of t that picked
// names, from what the Backup holds, what's already in Bandmate and those
// replaced, and writes them.
func giveDecidedIDs(ctx context.Context, tx *sql.Tx, t songTable, columns []string,
	picked []rowsPicked, replacing []int64) error {
	in := identityInput{matchedByName: t.matchedBy != "", replacing: replacing,
		versioned: slices.Contains(columns, "version")}
	var err error
	if in.lastUsedID, err = lastUsedID(ctx, tx, t.name); err != nil {
		return err
	}
	for _, rows := range picked {
		found, err := pickedRows(ctx, tx, t, in, rows)
		if err != nil {
			return fmt.Errorf("reading the %s picked: %w", t.name, err)
		}
		in.picked = append(in.picked, found)
	}
	if in.inBandmate, err = rowsInBandmate(ctx, tx, t, in); err != nil {
		return fmt.Errorf("matching %s: %w", t.name, err)
	}
	return writeDecisions(ctx, tx, t.name, decideIDs(in))
}

// pickedRows is the rows of t that the pick rows names, as the Backup holds
// them: their ids there and what they're matched by. A row holding nothing
// there, which no Folder, Tag, Song or Beat is stored without, matches
// nothing.
func pickedRows(ctx context.Context, tx *sql.Tx, t songTable, in identityInput,
	rows rowsPicked) ([]backupRow, error) {
	found, err := tx.QueryContext(ctx, fmt.Sprintf(`SELECT r.id, COALESCE(r."%[1]s", '')
		FROM src.%[2]s r WHERE (%[3]s) ORDER BY r.id`, in.matchedBy(t), t.name, rows.where), rows.arg)
	if err != nil {
		return nil, err
	}
	defer found.Close()
	var list []backupRow
	for found.Next() {
		var r backupRow
		if err := found.Scan(&r.id, &r.key); err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	return list, found.Err()
}

// rowsInBandmate is the rows of t already in Bandmate that one of those
// picked can match, by their folded names or Identities, with the name each
// carries here, for a table matched by name, and the version each holds,
// where the table holds one.
func rowsInBandmate(ctx context.Context, tx *sql.Tx, t songTable,
	in identityInput) (map[string]bandmateRow, error) {
	keys := []string{}
	for _, pick := range in.picked {
		for _, r := range pick {
			if !slices.Contains(keys, r.key) {
				keys = append(keys, r.key)
			}
		}
	}
	list, err := json.Marshal(keys)
	if err != nil {
		return nil, err
	}
	name, version := "''", "0"
	if in.matchedByName {
		name = `"name"`
	}
	if in.versioned {
		version = `"version"`
	}
	found, err := tx.QueryContext(ctx, fmt.Sprintf(`SELECT "%[1]s", id, %[2]s, %[3]s FROM main.%[4]s
		WHERE "%[1]s" IN (SELECT value FROM json_each(?))`, in.matchedBy(t), name, version, t.name), string(list))
	if err != nil {
		return nil, err
	}
	defer found.Close()
	inBandmate := map[string]bandmateRow{}
	for found.Next() {
		var k string
		var r bandmateRow
		if err := found.Scan(&k, &r.id, &r.name, &r.version); err != nil {
			return nil, err
		}
		inBandmate[k] = r
	}
	return inBandmate, found.Err()
}

// decisionRow is one identity decision as the insert writing them reads it:
// what the new id means as the 0 or 1 the column holds, and nothing for a
// name or a version the decision has none of.
type decisionRow struct {
	Old          int64   `json:"old"`
	New          int64   `json:"new"`
	KeptBoth     int     `json:"keptBoth"`
	Replaced     int     `json:"replaced"`
	Matched      int     `json:"matched"`
	MatchedName  *string `json:"matchedName,omitempty"`
	PriorVersion *int64  `json:"priorVersion,omitempty"`
}

// zeroOrOne is b as the 0 or 1 a column holds for it.
func zeroOrOne(b bool) int {
	if b {
		return 1
	}
	return 0
}

// writeDecisions writes table's identity decisions, with one parameterised
// insert for them all.
func writeDecisions(ctx context.Context, tx *sql.Tx, table string, decisions []idDecision) error {
	written := make([]decisionRow, len(decisions))
	for i, d := range decisions {
		written[i] = decisionRow{Old: d.old, New: d.new, KeptBoth: zeroOrOne(d.keptBoth),
			Replaced: zeroOrOne(d.replaced), Matched: zeroOrOne(d.matched),
			MatchedName: d.matchedName, PriorVersion: d.priorVersion}
	}
	list, err := json.Marshal(written)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO temp.restored
		(tbl, old, new, kept_both, replaced, matched, matched_name, prior_version)
		SELECT ?1, json_extract(d.value, '$.old'), json_extract(d.value, '$.new'),
			json_extract(d.value, '$.keptBoth'), json_extract(d.value, '$.replaced'),
			json_extract(d.value, '$.matched'), json_extract(d.value, '$.matchedName'),
			json_extract(d.value, '$.priorVersion')
		FROM json_each(?2) d`, table, string(list)); err != nil {
		return fmt.Errorf("giving %s their ids: %w", table, err)
	}
	return nil
}

// giveFreshIDs gives each row of t that picked names a fresh id, past every
// id its table has used, in the order of their ids in the Backup.
func giveFreshIDs(ctx context.Context, tx *sql.Tx, t songTable, picked []rowsPicked) error {
	next, err := lastUsedID(ctx, tx, t.name)
	if err != nil {
		return err
	}
	for _, rows := range picked {
		res, err := tx.ExecContext(ctx, fmt.Sprintf(`INSERT INTO temp.restored (tbl, old, new, kept_both, replaced)
			SELECT '%[1]s', r.id, ?2 + ROW_NUMBER() OVER (ORDER BY r.id), 0, 0 FROM src.%[1]s r
			WHERE (%[2]s) AND r.id NOT IN (SELECT old FROM temp.restored WHERE tbl = '%[1]s')`,
			t.name, rows.where), rows.arg, next)
		if err != nil {
			return fmt.Errorf("picking ids for %s: %w", t.name, err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return err
		}
		next += n
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
	files, err := filesOwnedBy(ctx, tx, ids)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM main.songs
		WHERE id IN (SELECT new FROM temp.restored WHERE tbl = 'songs' AND replaced)`); err != nil {
		return nil, fmt.Errorf("clearing replaced songs: %w", err)
	}
	return files, nil
}

// filesOwnedBy lists the files of every kind the Songs with ids own, as
// paths in the data directory.
func filesOwnedBy(ctx context.Context, tx *sql.Tx, ids []int64) ([]string, error) {
	var files []string
	for _, id := range ids {
		for _, f := range songfiles.Owned() {
			owned, err := queryIDs(ctx, tx, f.IDs, id)
			if err != nil {
				return nil, err
			}
			for _, o := range owned {
				files = append(files, dataPath(f, o))
			}
		}
	}
	return files, nil
}

// dataPath is where the file of kind f kept under id is, in the data
// directory.
func dataPath(f songfiles.Kind, id int64) string {
	return filepath.Join(filepath.FromSlash(f.Dir), strconv.FormatInt(id, 10))
}

// copyTableIn copies the rows of table t given ids, or, for a table without
// ids, those of the Songs with ids, pointing each reference at the id of
// the row it refers to. A Song or Beat kept both gets an identity of its
// own, from the trigger giving one to each made without, and a title
// saying it's restored. A Song replaced gets a version past the one it had,
// and a Beat replaced takes the Backup's columns t lists as replaced in
// place, marked as updated now if that changes it. A Folder or Tag matched
// is left as it is, or, if it went with a Song replaced, added back as it
// was named here.
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
		case c == "name" && t.matchedBy != "":
			values[i] = `COALESCE(k.matched_name, r.name)`
		case c == "demo":
			// Only the Demo is the Demo, marked once it's in.
			values[i] = `0`
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
			// A row matched is added back, under the id and name it
			// matched, if it went with a Song replaced, as a Tag goes with
			// the last Song carrying it. A Folder never goes with its
			// Songs, so one matched is always there.
			_, err := tx.ExecContext(ctx, insert+join+fmt.Sprintf(` WHERE NOT k.matched
				OR k.new NOT IN (SELECT id FROM main.%s) ORDER BY r.id`, t.name))
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

// remapSnapshots gives the Sections, Alternates and Lines inside each
// restored Snapshot's sheet the ids the restored rows got, so restoring the
// Snapshot keeps a Line still there, and its Cue as it is now, as for any
// other. A row the Backup doesn't hold, deleted after the Snapshot was
// taken, gets a fresh id, the same in every Snapshot holding it, and its
// table's sequence moves past that id, so no row added later takes it and
// restoring the Snapshot brings the row back under it, as ids are never
// reused.
func remapSnapshots(ctx context.Context, tx *sql.Tx) error {
	type held struct {
		id    int64
		sheet string
	}
	rows, err := tx.QueryContext(ctx, `SELECT s.id, s.sheet FROM main.snapshots s
		JOIN temp.restored k ON k.tbl = 'snapshots' AND k.new = s.id ORDER BY s.id`)
	if err != nil {
		return err
	}
	var snapshots []held
	for rows.Next() {
		var h held
		if err := rows.Scan(&h.id, &h.sheet); err != nil {
			rows.Close()
			return err
		}
		snapshots = append(snapshots, h)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	// The fresh ids given to rows the Backup doesn't hold, by table and
	// their ids in the Backup, and the last one given in each table.
	fresh := map[string]map[int64]int64{}
	last := map[string]int64{}
	newID := func(table string, old int64) (int64, error) {
		var id int64
		err := tx.QueryRowContext(ctx, `SELECT new FROM temp.restored WHERE tbl = ? AND old = ?`, table, old).Scan(&id)
		if !errors.Is(err, sql.ErrNoRows) {
			return id, err
		}
		if id, ok := fresh[table][old]; ok {
			return id, nil
		}
		if _, ok := last[table]; !ok {
			if last[table], err = lastUsedID(ctx, tx, table); err != nil {
				return 0, err
			}
			fresh[table] = map[int64]int64{}
		}
		last[table]++
		fresh[table][old] = last[table]
		return last[table], nil
	}
	for _, h := range snapshots {
		sheet, err := song.RemapSnapshotSheet(h.sheet, newID)
		if err != nil {
			return fmt.Errorf("snapshot %d: %w", h.id, err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE main.snapshots SET sheet = ? WHERE id = ?`, sheet, h.id); err != nil {
			return err
		}
	}
	for table, id := range last {
		if err := moveSequencePast(ctx, tx, table, id); err != nil {
			return err
		}
	}
	return nil
}

// lastUsedID is the highest id table has used, held now or not.
func lastUsedID(ctx context.Context, tx *sql.Tx, table string) (int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT MAX(
		COALESCE((SELECT MAX(id) FROM main.%[1]s), 0),
		COALESCE((SELECT seq FROM main.sqlite_sequence WHERE name = '%[1]s'), 0))`, table)).Scan(&id)
	return id, err
}

// moveSequencePast makes table's sequence at least id, so no row added
// later takes an id up to it.
func moveSequencePast(ctx context.Context, tx *sql.Tx, table string, id int64) error {
	res, err := tx.ExecContext(ctx, `UPDATE main.sqlite_sequence SET seq = MAX(seq, ?1) WHERE name = ?2`, id, table)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err != nil || n > 0 {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO main.sqlite_sequence (name, seq) VALUES (?, ?)`, table, id)
	return err
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
	for _, f := range songfiles.Kinds {
		// A Beat replaced keeps its own file.
		rows, err := tx.QueryContext(ctx, `SELECT old, new FROM temp.restored WHERE tbl = ? AND NOT replaced`, f.Table)
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
		dir := filepath.Join(s.dataDir, filepath.FromSlash(f.Dir))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return linked, err
		}
		for _, m := range moves {
			to := filepath.Join(dir, strconv.FormatInt(m.new, 10))
			if err := os.Remove(to); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return linked, err
			}
			if err := linkOrCopy(stagedFile(staging, f.Dir, m.old), to); err != nil {
				return linked, fmt.Errorf("restoring %s %d: %w", f.Dir, m.old, err)
			}
			linked = append(linked, to)
		}
	}
	return linked, nil
}
