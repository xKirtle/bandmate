package lyricsheet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// AddAlternate creates a new Alternate of a Section with the given name, as a
// copy of the active Alternate's Lines and their Cues, and makes it the active
// one. The one it copied keeps its own Cues, dormant (ADR 0007).
func (s *Store) AddAlternate(ctx context.Context, songID int64, based Version, sectionID int64, name string) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, err := findSection(ctx, tx, songID, sectionID); err != nil {
			return err
		}
		var activeID int64
		if err := tx.QueryRowContext(ctx, `SELECT id FROM alternates WHERE section_id = ? AND active = 1`,
			sectionID).Scan(&activeID); err != nil {
			return fmt.Errorf("finding active alternate: %w", err)
		}
		altID, err := insert(ctx, tx, `INSERT INTO alternates (section_id, name) VALUES (?, ?)`,
			sectionID, cleanName(name))
		if err != nil {
			return fmt.Errorf("adding alternate: %w", err)
		}
		lineCopies, err := copyLines(ctx, tx, activeID, altID)
		if err != nil {
			return err
		}
		for lineID, copyLineID := range lineCopies {
			if _, err := tx.ExecContext(ctx, `INSERT INTO line_cues (occurrence_id, line_id, cue_ms)
				SELECT occurrence_id, ?, cue_ms FROM line_cues WHERE line_id = ?`,
				copyLineID, lineID); err != nil {
				return fmt.Errorf("copying line cues: %w", err)
			}
		}
		return activate(ctx, tx, sectionID, altID)
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
		return activate(ctx, tx, sectionID, alternateID)
	})
}

// activate makes one of a Section's Alternates its only active one.
func activate(ctx context.Context, tx *sql.Tx, sectionID, alternateID int64) error {
	// The old one goes first: only one Alternate of a Section may be active
	// at any moment.
	if _, err := tx.ExecContext(ctx, `UPDATE alternates SET active = 0 WHERE section_id = ? AND id != ?`,
		sectionID, alternateID); err != nil {
		return fmt.Errorf("deactivating alternate: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE alternates SET active = 1 WHERE id = ?`,
		alternateID); err != nil {
		return fmt.Errorf("activating alternate: %w", err)
	}
	return nil
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

// MoveAlternateToScrapbook moves an inactive Alternate out of its Section,
// and so out of every Occurrence of it, into a new Section of its own in the
// Scrapbook, labelled with the Section's Label and the Alternate's name. Its
// dormant Cues are dropped: the new Section has no Occurrences for them to
// belong to. The active Alternate can't be moved.
func (s *Store) MoveAlternateToScrapbook(ctx context.Context, songID int64, based Version, alternateID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		_, active, err := findAlternate(ctx, tx, songID, alternateID)
		if err != nil {
			return err
		}
		if active {
			return conflict("the active Alternate can't be moved to the Scrapbook; activate another one first")
		}
		var label, name string
		if err := tx.QueryRowContext(ctx, `SELECT s.label, a.name FROM alternates a
			JOIN sections s ON s.id = a.section_id WHERE a.id = ?`, alternateID).Scan(&label, &name); err != nil {
			return fmt.Errorf("reading alternate: %w", err)
		}
		if label != "" && name != "" {
			label += " · "
		}
		newID, err := insert(ctx, tx, `INSERT INTO sections (song_id, label) VALUES (?, ?)`,
			songID, label+name)
		if err != nil {
			return fmt.Errorf("adding section: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM line_cues WHERE line_id IN
			(SELECT id FROM lines WHERE alternate_id = ?)`, alternateID); err != nil {
			return fmt.Errorf("dropping line cues: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE alternates SET section_id = ?, active = 1 WHERE id = ?`,
			newID, alternateID); err != nil {
			return fmt.Errorf("moving alternate: %w", err)
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
