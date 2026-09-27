package lyricsheet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// AddAlternate creates a new, inactive Alternate of a Section with the given
// name, starting as a copy of the active Alternate's Lines.
func (s *Store) AddAlternate(ctx context.Context, songID int64, based Version, sectionID int64, name string) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, err := findSection(ctx, tx, songID, sectionID); err != nil {
			return err
		}
		altID, err := insert(ctx, tx, `INSERT INTO alternates (section_id, name) VALUES (?, ?)`,
			sectionID, cleanName(name))
		if err != nil {
			return fmt.Errorf("adding alternate: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO lines (alternate_id, position, text)
			SELECT ?, l.position, l.text FROM lines l JOIN alternates a ON a.id = l.alternate_id
			WHERE a.section_id = ? AND a.active = 1 ORDER BY l.position`,
			altID, sectionID); err != nil {
			return fmt.Errorf("copying lines: %w", err)
		}
		return nil
	})
}

// RenameAlternate changes an Alternate's name. A blank name removes it.
func (s *Store) RenameAlternate(ctx context.Context, songID int64, based Version, alternateID int64, name string) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, _, err := findAlternate(ctx, tx, songID, alternateID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE alternates SET name = ? WHERE id = ?`,
			cleanName(name), alternateID); err != nil {
			return fmt.Errorf("renaming alternate: %w", err)
		}
		return nil
	})
}

// ActivateAlternate makes an Alternate the only active one of its Section, so
// every Occurrence of the Section shows it.
func (s *Store) ActivateAlternate(ctx context.Context, songID int64, based Version, alternateID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		sectionID, _, err := findAlternate(ctx, tx, songID, alternateID)
		if err != nil {
			return err
		}
		// The old one goes first: only one Alternate of a Section may be
		// active at any moment.
		if _, err := tx.ExecContext(ctx, `UPDATE alternates SET active = 0 WHERE section_id = ? AND id != ?`,
			sectionID, alternateID); err != nil {
			return fmt.Errorf("deactivating alternate: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE alternates SET active = 1 WHERE id = ?`,
			alternateID); err != nil {
			return fmt.Errorf("activating alternate: %w", err)
		}
		return nil
	})
}

// DeleteAlternate permanently deletes an inactive Alternate and its Lines.
// The active Alternate, and so a Section's last one, can't be deleted.
func (s *Store) DeleteAlternate(ctx context.Context, songID int64, based Version, alternateID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		sectionID, active, err := findAlternate(ctx, tx, songID, alternateID)
		if err != nil {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM alternates WHERE section_id = ?`,
			sectionID).Scan(&count); err != nil {
			return err
		}
		if count == 1 {
			return conflict("a Section's last Alternate can't be deleted")
		}
		if active {
			return conflict("the active Alternate can't be deleted; activate another one first")
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM alternates WHERE id = ?`, alternateID); err != nil {
			return fmt.Errorf("deleting alternate: %w", err)
		}
		return nil
	})
}

// findAlternate returns the Section of one of a Song's Alternates and whether
// it is the active one.
func findAlternate(ctx context.Context, tx *sql.Tx, songID, alternateID int64) (sectionID int64, active bool, err error) {
	err = tx.QueryRowContext(ctx, `SELECT a.section_id, a.active FROM alternates a
		JOIN sections s ON s.id = a.section_id WHERE a.id = ? AND s.song_id = ?`,
		alternateID, songID).Scan(&sectionID, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, ErrNotFound
	}
	return sectionID, active, err
}

// cleanName trims an Alternate's name; blank means no name.
func cleanName(name string) string {
	return strings.TrimSpace(name)
}
