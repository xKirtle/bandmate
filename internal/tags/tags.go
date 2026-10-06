// Package tags owns Tags: names of the user's own that mark Songs, any
// number per Song. A Tag is only a name, unique ignoring case and without a
// comma (a comma finishes a Tag as it's typed), and lasts only while some
// Song carries it. Tagging a Song is organising, not editing it, so it leaves
// the Song's version and when it was edited as they were.
package tags

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ErrNotFound means the Song asked to tag, or the Tag asked for, doesn't
// exist.
var ErrNotFound = errors.New("not found")

// InvalidError is a rejected operation. Its message is safe to show the user.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

// ConflictError is an operation the Tags as they are don't allow without
// asking, e.g. renaming one onto a name another has. Its message is safe to
// show the user.
type ConflictError struct{ Msg string }

func (e *ConflictError) Error() string { return e.Msg }

var (
	errBlankName   = &InvalidError{Msg: "a Tag's name can't be blank"}
	errCommaInName = &InvalidError{Msg: "a Tag's name can't have a comma"}
)

// cleanName is a Tag's name as given, trimmed, or an InvalidError if it's
// blank or has a comma: a comma finishes a Tag as it's typed.
func cleanName(name string) (string, error) {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		return "", errBlankName
	case strings.Contains(name, ","):
		return "", errCommaInName
	}
	return name, nil
}

// Tag is a Tag as listed, with how many Songs carry it.
type Tag struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Songs int    `json:"songs"`
}

// Store reads and changes Tags in the database.
type Store struct{ db *sql.DB }

// NewStore returns a Store backed by db.
func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// Fold is a name as Tags' names are compared: ignoring case, and the spaces
// around it.
func Fold(name string) string { return strings.ToLower(strings.TrimSpace(name)) }

// List returns every Tag, by name ignoring case.
func (s *Store) List(ctx context.Context) ([]Tag, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT t.id, t.name,
		(SELECT COUNT(*) FROM song_tags st WHERE st.tag_id = t.id)
		FROM tags t ORDER BY t.folded, t.id`)
	if err != nil {
		return nil, fmt.Errorf("listing tags: %w", err)
	}
	defer rows.Close()
	list := []Tag{}
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Songs); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

// Rename gives a Tag a new name, trimmed, which every Song carrying it then
// shows. A name another Tag has, ignoring case, is refused as a
// ConflictError, unless merge is set: then the Tag merges into that one,
// which takes the name as given, and every Song carrying either carries it.
// It returns the Tag as renamed or merged into. No Song is edited.
func (s *Store) Rename(ctx context.Context, id int64, name string, merge bool) (Tag, error) {
	name, err := cleanName(name)
	if err != nil {
		return Tag{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Tag{}, err
	}
	defer tx.Rollback()
	if err := tagExists(ctx, tx, id); err != nil {
		return Tag{}, err
	}
	var other int64
	var otherName string
	err = tx.QueryRowContext(ctx, `SELECT id, name FROM tags WHERE folded = ? AND id <> ?`, Fold(name), id).
		Scan(&other, &otherName)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		other = id
	case err != nil:
		return Tag{}, fmt.Errorf("checking tag names: %w", err)
	case !merge:
		return Tag{}, &ConflictError{Msg: fmt.Sprintf("there's already a Tag called “%s”", otherName)}
	default:
		// The Songs carrying this Tag carry the other instead, and, off
		// its last Song, this one goes.
		if _, err := tx.ExecContext(ctx, `INSERT INTO song_tags (song_id, tag_id)
			SELECT song_id, ? FROM song_tags WHERE tag_id = ? ON CONFLICT DO NOTHING`, other, id); err != nil {
			return Tag{}, fmt.Errorf("merging tag: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM song_tags WHERE tag_id = ?`, id); err != nil {
			return Tag{}, fmt.Errorf("merging tag: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE tags SET name = ?, folded = ? WHERE id = ?`,
		name, Fold(name), other); err != nil {
		return Tag{}, fmt.Errorf("renaming tag: %w", err)
	}
	t := Tag{ID: other, Name: name}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM song_tags WHERE tag_id = ?`, other).
		Scan(&t.Songs); err != nil {
		return Tag{}, fmt.Errorf("counting tag's songs: %w", err)
	}
	return t, tx.Commit()
}

// Delete takes a Tag off every Song carrying it, so it goes. No Song is
// deleted or edited.
func (s *Store) Delete(ctx context.Context, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := tagExists(ctx, tx, id); err != nil {
		return err
	}
	// Off its last Song, the Tag goes with it.
	if _, err := tx.ExecContext(ctx, `DELETE FROM song_tags WHERE tag_id = ?`, id); err != nil {
		return fmt.Errorf("untagging songs: %w", err)
	}
	return tx.Commit()
}

// tagExists is ErrNotFound unless there's a Tag with id.
func tagExists(ctx context.Context, tx *sql.Tx, id int64) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM tags WHERE id = ?)`, id).
		Scan(&exists); err != nil {
		return fmt.Errorf("checking tag: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

// SetSongTags gives a Song exactly the Tags named, whatever its Status, and
// returns their names, by name ignoring case. A name is trimmed, and matched
// ignoring case to a Tag there is, whose name it takes; one no Tag has makes
// that Tag, named as first written. A Tag taken off its last Song goes.
func (s *Store) SetSongTags(ctx context.Context, songID int64, names []string) ([]string, error) {
	// By folded name, as first written.
	wanted := map[string]string{}
	for _, name := range names {
		name, err := cleanName(name)
		if err != nil {
			return nil, err
		}
		if _, ok := wanted[Fold(name)]; !ok {
			wanted[Fold(name)] = name
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM songs WHERE id = ?)`, songID).
		Scan(&exists); err != nil {
		return nil, fmt.Errorf("checking song: %w", err)
	}
	if !exists {
		return nil, ErrNotFound
	}
	// Linked anew, the Tags kept are never without a Song, so only those
	// taken off go.
	if _, err := tx.ExecContext(ctx, `DELETE FROM song_tags WHERE song_id = ?
		AND tag_id NOT IN (SELECT id FROM tags WHERE folded IN (SELECT value FROM json_each(?)))`,
		songID, jsonKeys(wanted)); err != nil {
		return nil, fmt.Errorf("untagging song: %w", err)
	}
	for folded, name := range wanted {
		if _, err := tx.ExecContext(ctx, `INSERT INTO tags (name, folded) VALUES (?, ?)
			ON CONFLICT (folded) DO NOTHING`, name, folded); err != nil {
			return nil, fmt.Errorf("making tag: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO song_tags (song_id, tag_id)
			SELECT ?, id FROM tags WHERE folded = ? ON CONFLICT DO NOTHING`, songID, folded); err != nil {
			return nil, fmt.Errorf("tagging song: %w", err)
		}
	}
	got, err := songTags(ctx, tx, songID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return got, nil
}

// jsonKeys is a map's keys as a JSON array of strings, for json_each.
func jsonKeys(m map[string]string) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	b, _ := json.Marshal(keys) // A list of strings always marshals.
	return string(b)
}

// songTags lists the names of a Song's Tags, by name ignoring case.
func songTags(ctx context.Context, tx *sql.Tx, songID int64) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT t.name FROM song_tags st JOIN tags t ON t.id = st.tag_id
		WHERE st.song_id = ? ORDER BY t.folded, t.id`, songID)
	if err != nil {
		return nil, fmt.Errorf("reading song's tags: %w", err)
	}
	defer rows.Close()
	names := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}
