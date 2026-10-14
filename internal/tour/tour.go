// Package tour keeps what the server knows of the Tour: whether it's been
// offered on the empty Songs page. The Tour itself is held in the browser.
package tour

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Store reads and marks whether the Tour has been offered, in the database.
type Store struct{ db *sql.DB }

// NewStore returns a Store backed by db.
func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// Offered tells whether the Tour has been offered on the install: taken or
// turned down from the offer, or upgraded from before the Tour with Songs.
func (s *Store) Offered(ctx context.Context) (bool, error) {
	var offered bool
	err := s.db.QueryRowContext(ctx, `SELECT offered FROM tour WHERE id = 1`).Scan(&offered)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading whether the Tour was offered: %w", err)
	}
	return offered, nil
}

// MarkOffered marks the Tour offered, for good.
func (s *Store) MarkOffered(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO tour (id, offered) VALUES (1, 1)
		ON CONFLICT (id) DO UPDATE SET offered = 1`)
	if err != nil {
		return fmt.Errorf("marking the Tour offered: %w", err)
	}
	return nil
}
