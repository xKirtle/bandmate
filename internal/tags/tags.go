// Package tags owns Tags: names of the user's own that mark Songs, any
// number per Song. A Tag is only a name, unique ignoring case, and lasts only
// while some Song carries it. Tagging a Song is organising, not editing it,
// so it leaves the Song's version and when it was edited as they were.
package tags

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ErrNotFound means the Song asked to tag doesn't exist.
var ErrNotFound = errors.New("not found")

// InvalidError is a rejected operation. Its message is safe to show the user.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

var errBlankName = &InvalidError{Msg: "a Tag's name can't be blank"}

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

// fold is a name as Tags' names are compared: ignoring case, and the spaces
// around it.
func fold(name string) string { return strings.ToLower(strings.TrimSpace(name)) }

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

// SetSongTags gives a Song exactly the Tags named, whatever its Status, and
// returns their names, by name ignoring case. A name is trimmed, and matched
// ignoring case to a Tag there is, whose name it takes; one no Tag has makes
// that Tag, named as first written. A Tag taken off its last Song goes.
func (s *Store) SetSongTags(ctx context.Context, songID int64, names []string) ([]string, error) {
	// By folded name, as first written.
	wanted := map[string]string{}
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			return nil, errBlankName
		}
		if _, ok := wanted[fold(name)]; !ok {
			wanted[fold(name)] = name
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
