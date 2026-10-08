// Package lyricsheet owns a Song, with its Lyric Sheet, Masters and Cover, as one
// aggregate and exposes intent-level operations on it. All domain rules
// live here; the HTTP layer only maps requests onto these operations.
// Deleting Songs lives here too, a Folder's included: deleting a Folder with
// its Songs is one operation, so it can't be left half done.
package lyricsheet

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songfiles"
	"github.com/xKirtle/bandmate/internal/songversion"
	"github.com/xKirtle/bandmate/internal/tags"
)

var (
	errTitleRequired = domain.Invalid("title is required")
	errUnknownStatus = domain.Invalid("status must be idea, drafting, finished or shelved")
	errNoSuchFolder  = domain.Invalid("there's no such Folder")
)

// Status is where a Song stands in its lifecycle.
type Status string

const (
	StatusIdea     Status = "idea"
	StatusDrafting Status = "drafting"
	StatusFinished Status = "finished"
	// StatusShelved is a Song set aside for now, that might be come back to.
	StatusShelved Status = "shelved"
)

func (s Status) valid() bool {
	switch s {
	case StatusIdea, StatusDrafting, StatusFinished, StatusShelved:
		return true
	}
	return false
}

// Song is the full Song aggregate.
type Song struct {
	ID      int64               `json:"id"`
	Version songversion.Version `json:"version"`
	Title   string              `json:"title"`
	Status  Status              `json:"status"`
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
	// Masters are in the order they were added.
	Masters []Master `json:"masters"`
	// Cover is nil when the Song has none.
	Cover *Cover `json:"cover"`
	// Tags are the names of the Tags the Song carries, by name ignoring case.
	Tags []string `json:"tags"`
}

// SongSummary is a Song as shown in the Song list.
type SongSummary struct {
	ID     int64  `json:"id"`
	Title  string `json:"title"`
	Status Status `json:"status"`
	// Key and BPM are as on the Song: "" and nil when not set.
	Key       string `json:"key"`
	BPM       *int   `json:"bpm"`
	HasMaster bool   `json:"hasMaster"`
	// CoverID is the Song's Cover's, or nil when it has none.
	CoverID *int64 `json:"coverId"`
	// FolderID is the id of the Folder the Song sits in, or nil when it's in
	// none.
	FolderID *int64 `json:"folderId"`
	// Tags are as on the Song.
	Tags      []string  `json:"tags"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Store reads and changes Songs in the database.
type Store struct {
	db *sql.DB
	// songFiles holds the files of each kind a Song has, by the kind's
	// directory: those it owns go when it does.
	songFiles   map[string]*audio.Files
	masterFiles *audio.Files
	coverFiles  CoverFiles
}

// NewStore returns a Store backed by db, keeping the files of each kind a
// Song has, from Masters' audio to Covers' pictures, in songFiles, by the
// kind's directory: one for each of songfiles.Kinds.
func NewStore(db *sql.DB, songFiles map[string]*audio.Files) *Store {
	return &Store{
		db:          db,
		songFiles:   songFiles,
		masterFiles: songFiles[songfiles.Masters.Dir],
		coverFiles:  CoverFilesIn(songFiles),
	}
}

// songTags is, in a query on songs, the names of a Song's Tags as a JSON
// array, by name ignoring case.
const songTags = `(SELECT json_group_array(t.name ORDER BY t.folded) FROM song_tags st
	JOIN tags t ON t.id = st.tag_id WHERE st.song_id = songs.id)`

// decodeTags reads the names songTags gives.
func decodeTags(text string) ([]string, error) {
	names := []string{}
	if err := json.Unmarshal([]byte(text), &names); err != nil {
		return nil, fmt.Errorf("reading song's tags: %w", err)
	}
	return names, nil
}

// untitledSong names a Song created without a title. Titles needn't be
// unique, so any number of Songs can have it.
const untitledSong = "Untitled Song"

// CreateSong creates a Song with the given title, or "Untitled Song"
// without one, and Status idea, in the Folder with id folderID, or in none if
// it's nil.
func (s *Store) CreateSong(ctx context.Context, title string, folderID *int64) (Song, error) {
	if strings.TrimSpace(title) == "" {
		title = untitledSong
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Song{}, err
	}
	defer tx.Rollback()
	id, err := insertSong(ctx, tx, title, folderID)
	if err != nil {
		return Song{}, err
	}
	if err := tx.Commit(); err != nil {
		return Song{}, err
	}
	return s.GetSong(ctx, id)
}

// execer is what both *sql.DB and *sql.Tx offer for writing.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// firstTrackName names the Track a Song starts with, as a Song always has
// at least one.
const firstTrackName = "Track 1"

// insertSong creates a Song with the given title and Status idea, in the
// Folder with id folderID, or in none if it's nil, and its first Track, and
// returns its id. CreateSong names a Song without a title before it gets
// here.
func insertSong(ctx context.Context, tx *sql.Tx, title string, folderID *int64) (int64, error) {
	title = strings.TrimSpace(title)
	if folderID != nil {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM folders WHERE id = ?)`, *folderID).
			Scan(&exists); err != nil {
			return 0, fmt.Errorf("checking folder: %w", err)
		}
		if !exists {
			return 0, errNoSuchFolder
		}
	}
	now := time.Now().UTC().Format(domain.TimeFormat)
	id, err := insert(ctx, tx,
		`INSERT INTO songs (title, status, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		title, StatusIdea, folderID, now, now)
	if err != nil {
		return 0, fmt.Errorf("creating song: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO tracks (song_id, name, position) VALUES (?, ?, 0)`,
		id, firstTrackName); err != nil {
		return 0, fmt.Errorf("adding the first track: %w", err)
	}
	return id, nil
}

// GetSong returns a Song's full aggregate.
func (s *Store) GetSong(ctx context.Context, id int64) (Song, error) {
	var song Song
	var bpm, capo sql.NullInt64
	var created, updated, tags string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, version, title, status, song_key, bpm, capo, tuning, notes, created_at, updated_at, `+songTags+`
		 FROM songs WHERE id = ?`, id).
		Scan(&song.ID, &song.Version, &song.Title, &song.Status, &song.Key, &bpm, &capo, &song.Tuning, &song.Notes,
			&created, &updated, &tags)
	if errors.Is(err, sql.ErrNoRows) {
		return Song{}, domain.ErrNotFound
	}
	if err != nil {
		return Song{}, fmt.Errorf("reading song: %w", err)
	}
	song.BPM, song.Capo = intOrNil(bpm), intOrNil(capo)
	if song.CreatedAt, err = domain.ParseTime(created); err != nil {
		return Song{}, err
	}
	if song.UpdatedAt, err = domain.ParseTime(updated); err != nil {
		return Song{}, err
	}
	if song.Tags, err = decodeTags(tags); err != nil {
		return Song{}, err
	}
	if song.LyricSheet, err = s.loadLyricSheet(ctx, id); err != nil {
		return Song{}, err
	}
	if song.Masters, err = loadMasters(ctx, s.db, id); err != nil {
		return Song{}, err
	}
	if song.Cover, err = loadCover(ctx, s.db, id); err != nil {
		return Song{}, err
	}
	return song, nil
}

// SongFilter narrows the Song list. Zero fields don't filter.
type SongFilter struct {
	// Statuses keeps the Songs with any of them; blank ones are ignored.
	Statuses []Status
	// Title keeps Songs whose title contains it, ignoring case and
	// surrounding spaces.
	Title string
	// HasMaster keeps the Songs with at least one Master (true) or with
	// none (false).
	HasMaster *bool
	// Folder keeps the Songs in the Folder with this id, or, pointing at
	// NoFolder, those in none.
	Folder *int64
	// Tags keeps the Songs carrying all of the Tags named, matched ignoring
	// case and surrounding spaces; blank ones are ignored.
	Tags []string
}

// NoFolder is the Folder id a SongFilter keeps the Songs in no Folder by.
const NoFolder int64 = 0

// ListSongs returns the Songs matching filter, most recently edited first.
func (s *Store) ListSongs(ctx context.Context, filter SongFilter) ([]SongSummary, error) {
	conditions, args := []string{"1"}, []any{}
	var placeholders []string
	for _, status := range filter.Statuses {
		if status == "" {
			continue
		}
		if !status.valid() {
			return nil, errUnknownStatus
		}
		placeholders, args = append(placeholders, "?"), append(args, status)
	}
	if len(placeholders) > 0 {
		conditions = append(conditions, "status IN ("+strings.Join(placeholders, ", ")+")")
	}
	if filter.HasMaster != nil {
		conditions, args = append(conditions, "has_master = ?"), append(args, *filter.HasMaster)
	}
	if filter.Folder != nil {
		if *filter.Folder == NoFolder {
			conditions = append(conditions, "folder_id IS NULL")
		} else {
			conditions, args = append(conditions, "folder_id = ?"), append(args, *filter.Folder)
		}
	}
	for _, tag := range filter.Tags {
		folded := tags.Fold(tag)
		if folded == "" {
			continue
		}
		conditions = append(conditions, `id IN (SELECT st.song_id FROM song_tags st
			JOIN tags t ON t.id = st.tag_id WHERE t.folded = ?)`)
		args = append(args, folded)
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, title, status, song_key, bpm, has_master, cover_id, folder_id, tags, updated_at FROM (
		   SELECT *, EXISTS (SELECT 1 FROM masters WHERE masters.song_id = songs.id) AS has_master,
		     (SELECT id FROM covers WHERE covers.song_id = songs.id) AS cover_id,
		     `+songTags+` AS tags
		   FROM songs
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
		var bpm, cover, folder sql.NullInt64
		var tags, updated string
		if err := rows.Scan(&sum.ID, &sum.Title, &sum.Status, &sum.Key, &bpm, &sum.HasMaster, &cover, &folder,
			&tags, &updated); err != nil {
			return nil, err
		}
		sum.BPM = intOrNil(bpm)
		if cover.Valid {
			sum.CoverID = &cover.Int64
		}
		if folder.Valid {
			sum.FolderID = &folder.Int64
		}
		if !strings.Contains(strings.ToLower(sum.Title), needle) {
			continue
		}
		if sum.UpdatedAt, err = domain.ParseTime(updated); err != nil {
			return nil, err
		}
		if sum.Tags, err = decodeTags(tags); err != nil {
			return nil, err
		}
		list = append(list, sum)
	}
	return list, rows.Err()
}

// SongChanges is a partial update to a Song. Fields not Set are unchanged.
type SongChanges struct {
	Title  domain.Change[string] `json:"title"`
	Status domain.Change[Status] `json:"status"`
	Key    domain.Change[string] `json:"key"`
	BPM    domain.Change[*int]   `json:"bpm"`
	Capo   domain.Change[*int]   `json:"capo"`
	Tuning domain.Change[string] `json:"tuning"`
	Notes  domain.Change[string] `json:"notes"`
}

// UpdateSong applies changes to a Song. Every change is validated before
// anything is written, so a rejected update leaves the Song as it was.
func (s *Store) UpdateSong(ctx context.Context, id int64, based songversion.Version, changes SongChanges) (Song, error) {
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
			return Song{}, domain.Invalid("bpm must be between 1 and 999")
		}
		set("bpm", c.Value)
	}
	if c := changes.Capo; c.Set {
		if c.Value != nil && (*c.Value < 0 || *c.Value > 24) {
			return Song{}, domain.Invalid("capo must be between 0 and 24")
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
		song, err := s.GetSong(ctx, id)
		if err == nil && based != songversion.Any && song.Version != based {
			return Song{}, songversion.ErrStale
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
// ON DELETE CASCADE, so it goes too, and so do the files of every kind it
// owns (see songfiles), detached Takes and unused Sounds included.
func (s *Store) DeleteSong(ctx context.Context, id int64, based songversion.Version) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	files := ownedFiles{}
	if err := files.add(ctx, tx, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM songs WHERE id = ? AND (?2 = 0 OR version = ?2)`, id, based)
	if err != nil {
		return fmt.Errorf("deleting song: %w", err)
	}
	if err := songversion.ExpectCurrent(ctx, tx, res, id); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.removeFiles(files)
	return nil
}

// AnyCount skips DeleteFolderWithSongs's check of how many Songs the Folder
// holds.
const AnyCount = -1

// DeleteFolderWithSongs removes a Folder and every Song in it, each as
// DeleteSong does, all at once: if any of it fails, nothing is deleted. With
// a count other than AnyCount, the number of Songs the user was asked about,
// it deletes nothing unless the Folder still holds that many, so none filed
// into it since goes unseen. A missing Folder is domain.ErrNotFound.
func (s *Store) DeleteFolderWithSongs(ctx context.Context, folderID int64, count int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var name string
	err = tx.QueryRowContext(ctx, `SELECT name FROM folders WHERE id = ?`, folderID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading folder: %w", err)
	}
	songIDs, err := queryIDs(ctx, tx, `SELECT id FROM songs WHERE folder_id = ?`, folderID)
	if err != nil {
		return fmt.Errorf("listing folder's songs: %w", err)
	}
	if count != AnyCount && len(songIDs) != count {
		return domain.Conflict(fmt.Sprintf("“%s” now holds %s, not %d", name, songCount(len(songIDs)), count))
	}
	files := ownedFiles{}
	for _, songID := range songIDs {
		if err := files.add(ctx, tx, songID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM songs WHERE folder_id = ?`, folderID); err != nil {
		return fmt.Errorf("deleting folder's songs: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM folders WHERE id = ?`, folderID); err != nil {
		return fmt.Errorf("deleting folder: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.removeFiles(files)
	return nil
}

// songCount says how many Songs there are: "1 Song", "3 Songs".
func songCount(n int) string {
	if n == 1 {
		return "1 Song"
	}
	return fmt.Sprintf("%d Songs", n)
}

// ownedFiles holds the ids of files Songs own, by their kind's directory:
// those to remove once the Songs are deleted.
type ownedFiles map[string][]int64

// add adds the files of every kind the Song with songID owns.
func (o ownedFiles) add(ctx context.Context, tx *sql.Tx, songID int64) error {
	for _, k := range songfiles.Owned() {
		fileIDs, err := songFileIDs(ctx, tx, k, songID)
		if err != nil {
			return err
		}
		o[k.Dir] = append(o[k.Dir], fileIDs...)
	}
	return nil
}

// removeFiles removes files once the Songs owning them are deleted. A file
// left behind only takes space, so failures are logged.
func (s *Store) removeFiles(files ownedFiles) {
	for dir, ids := range files {
		for _, file := range ids {
			if err := s.songFiles[dir].Remove(file); err != nil {
				log.Printf("deleting %s/%d: %v", dir, file, err)
			}
		}
	}
}

// songFileIDs lists the ids of a Song's files of kind k.
func songFileIDs(ctx context.Context, tx *sql.Tx, k songfiles.Kind, songID int64) ([]int64, error) {
	ids, err := queryIDs(ctx, tx, k.IDs, songID)
	if err != nil {
		return nil, fmt.Errorf("listing %s: %w", k.Dir, err)
	}
	return ids, nil
}

// queryIDs runs a query whose rows are each one id, and lists them.
func queryIDs(ctx context.Context, tx *sql.Tx, stmt string, args ...any) ([]int64, error) {
	var ids []int64
	err := query(ctx, tx, stmt, args, func(rows *sql.Rows) error {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
		return nil
	})
	return ids, err
}

func intOrNil(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}
