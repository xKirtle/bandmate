// Package tour keeps all the server knows of the Tour: whether it's been
// offered on the empty Songs page. The Tour itself is held in the browser.
package tour

import (
	"context"
	"database/sql"
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
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM tour_offered)`).Scan(&offered)
	if err != nil {
		return false, fmt.Errorf("reading whether the Tour was offered: %w", err)
	}
	return offered, nil
}

// MarkOffered marks the Tour offered, for good.
func (s *Store) MarkOffered(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO tour_offered (id) VALUES (1)`); err != nil {
		return fmt.Errorf("marking the Tour offered: %w", err)
	}
	return nil
}
