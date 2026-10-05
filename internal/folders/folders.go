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
)

// ErrNotFound means the requested Folder, or the Song asked to move,
// doesn't exist.
var ErrNotFound = errors.New("not found")

// InvalidError is a rejected operation. Its message is safe to show the user.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

// ConflictError is an operation the Folders as they are don't allow, e.g. a
// name another has. Its message is safe to show the user.
type ConflictError struct{ Msg string }

func (e *ConflictError) Error() string { return e.Msg }

var (
	errNameRequired = &InvalidError{Msg: "a Folder's name is required"}
	errNoSuchFolder = &InvalidError{Msg: "there's no such Folder"}
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
		return Folder{}, ErrNotFound
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
	var taken string
	err = tx.QueryRowContext(ctx, `SELECT name FROM folders WHERE folded = ?`, fold(name)).Scan(&taken)
	if err == nil {
		return Folder{}, &ConflictError{Msg: fmt.Sprintf("there's already a Folder called “%s”", taken)}
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Folder{}, fmt.Errorf("checking folder names: %w", err)
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
	if n, err := res.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// check refuses, as an InvalidError, a Folder that doesn't exist, for
// putting a Song into it. A nil one, none, is always there.
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
