// Package folders owns Folders: named places on the Songs page that keep
// some Songs together. A Folder is only a name, unique ignoring case, and a
// Song sits in one at most. Filing a Song is organising, not editing it, so
// it leaves the Song's version and when it was edited as they were.
package folders

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/xKirtle/bandmate/internal/domain"
)

var (
	errNameRequired = domain.Invalid("a Folder's name is required")
	errNoSuchFolder = domain.Invalid("there's no such Folder")
)

// Folder is a Folder as listed, with how many Songs it holds.
type Folder struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Songs int    `json:"songs"`
}

// Store reads and changes Folders in the database.
type Store struct{ db *sql.DB }

// NewStore returns a Store backed by db.
func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// fold is a name as Folders' names are compared: ignoring case, and the
// spaces around it.
func fold(name string) string { return strings.ToLower(strings.TrimSpace(name)) }

const selectFolders = `SELECT f.id, f.name, (SELECT COUNT(*) FROM songs s WHERE s.folder_id = f.id) FROM folders f`

// List returns every Folder, by name ignoring case.
func (s *Store) List(ctx context.Context) ([]Folder, error) {
	rows, err := s.db.QueryContext(ctx, selectFolders+` ORDER BY f.folded, f.id`)
	if err != nil {
		return nil, fmt.Errorf("listing folders: %w", err)
	}
	defer rows.Close()
	list := []Folder{}
	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.Name, &f.Songs); err != nil {
			return nil, err
		}
		list = append(list, f)
	}
	return list, rows.Err()
}

// Get returns a Folder.
func (s *Store) Get(ctx context.Context, id int64) (Folder, error) {
	var f Folder
	err := s.db.QueryRowContext(ctx, selectFolders+` WHERE f.id = ?`, id).Scan(&f.ID, &f.Name, &f.Songs)
	if errors.Is(err, sql.ErrNoRows) {
		return Folder{}, domain.ErrNotFound
	}
	if err != nil {
		return Folder{}, fmt.Errorf("reading folder: %w", err)
	}
	return f, nil
}

// Create makes an empty Folder with name, refusing one another Folder has,
// ignoring case.
func (s *Store) Create(ctx context.Context, name string) (Folder, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Folder{}, errNameRequired
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Folder{}, err
	}
	defer tx.Rollback()
	if err := checkName(ctx, tx, name, 0); err != nil {
		return Folder{}, err
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO folders (name, folded) VALUES (?, ?)`, name, fold(name))
	if err != nil {
		return Folder{}, fmt.Errorf("making folder: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Folder{}, err
	}
	if err := tx.Commit(); err != nil {
		return Folder{}, err
	}
	return Folder{ID: id, Name: name}, nil
}

// Rename gives a Folder a new name, refusing one another Folder has,
// ignoring case. Its own name in another case is fine.
func (s *Store) Rename(ctx context.Context, id int64, name string) (Folder, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Folder{}, errNameRequired
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Folder{}, err
	}
	defer tx.Rollback()
	if err := checkName(ctx, tx, name, id); err != nil {
		return Folder{}, err
	}
	res, err := tx.ExecContext(ctx, `UPDATE folders SET name = ?, folded = ? WHERE id = ?`, name, fold(name), id)
	if err != nil {
		return Folder{}, fmt.Errorf("renaming folder: %w", err)
	}
	if err := domain.ExpectOneRow(res); err != nil {
		return Folder{}, err
	}
	if err := tx.Commit(); err != nil {
		return Folder{}, err
	}
	return s.Get(ctx, id)
}

// Delete removes a Folder, leaving any Songs still in it in none.
func (s *Store) Delete(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM folders WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting folder: %w", err)
	}
	return domain.ExpectOneRow(res)
}

// checkName refuses, as a conflict, a name another Folder already has,
// ignoring case. The Folder with id except, the one being renamed, doesn't
// count; ids start at 1, so a new Folder passes 0.
func checkName(ctx context.Context, tx *sql.Tx, name string, except int64) error {
	var taken string
	err := tx.QueryRowContext(ctx, `SELECT name FROM folders WHERE folded = ? AND id <> ?`, fold(name), except).
		Scan(&taken)
	if err == nil {
		return domain.Conflict(fmt.Sprintf("there's already a Folder called “%s”", taken))
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("checking folder names: %w", err)
	}
	return nil
}

// MoveSong puts a Song into the Folder with folderID, or, with nil, into
// none, whatever its Status.
func (s *Store) MoveSong(ctx context.Context, songID int64, folderID *int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := check(ctx, tx, folderID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `UPDATE songs SET folder_id = ? WHERE id = ?`, folderID, songID)
	if err != nil {
		return fmt.Errorf("moving song: %w", err)
	}
	if err := domain.ExpectOneRow(res); err != nil {
		return err
	}
	return tx.Commit()
}

// check refuses, as invalid, a Folder that doesn't exist, for putting a
// Song into it. A nil one, none, is always there.
func check(ctx context.Context, tx *sql.Tx, folderID *int64) error {
	if folderID == nil {
		return nil
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM folders WHERE id = ?)`, *folderID).
		Scan(&exists); err != nil {
		return fmt.Errorf("checking folder: %w", err)
	}
	if !exists {
		return errNoSuchFolder
	}
	return nil
}
