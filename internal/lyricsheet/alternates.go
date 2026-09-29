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
			if _, err := tx.ExecContext(ctx, `UPDATE lines SET cue_ms = (SELECT cue_ms FROM lines WHERE id = ?)
				WHERE id = ?`, lineID, copyLineID); err != nil {
				return fmt.Errorf("copying line cue: %w", err)
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
// the Section shows it.
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

// MoveAlternateToScrapbook moves an inactive Alternate out of its Section
// into a new Section of its own in the Scrapbook, labelled with the Section's
// Label and the Alternate's name. Its Cues go with it, and are live once
// the new Section is put back (ADR 0010). The active Alternate can't be
// moved.
func (s *Store) MoveAlternateToScrapbook(ctx context.Context, songID int64, based Version, alternateID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		var label, name string
		var active bool
		err := tx.QueryRowContext(ctx, `SELECT s.label, a.name, a.active FROM alternates a
			JOIN sections s ON s.id = a.section_id WHERE a.id = ? AND s.song_id = ?`,
			alternateID, songID).Scan(&label, &name, &active)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("reading alternate: %w", err)
		}
		if active {
			return conflict("the active Alternate can't be moved to the Scrapbook; activate another one first")
		}
		newID, err := insert(ctx, tx, `INSERT INTO sections (song_id, label) VALUES (?, ?)`,
			songID, scrapbookLabel(label, name))
		if err != nil {
			return fmt.Errorf("adding section: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE alternates SET section_id = ?, active = 1 WHERE id = ?`,
			newID, alternateID); err != nil {
			return fmt.Errorf("moving alternate: %w", err)
		}
		return toScrapbookEnd(ctx, tx, songID, newID)
	})
}

// AddToSection adds a Section in the Scrapbook to a Section in the Lyric
// Sheet: every Alternate of the Scrapbook Section joins the Section,
// inactive, after its own, so the Lyric Sheet is unchanged, and the
// Scrapbook Section is gone. An unnamed Alternate takes the Scrapbook
// Section's Label as its name. Their Lines keep their ids and their Cues,
// dormant until their Alternate is made active (ADR 0010).
func (s *Store) AddToSection(ctx context.Context, songID int64, based Version, scrapID, sectionID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		scrapAt, err := findSection(ctx, tx, songID, scrapID)
		if err != nil {
			return err
		}
		at, err := findSection(ctx, tx, songID, sectionID)
		if err != nil {
			return err
		}
		if scrapAt.Valid {
			return conflict("only a Scrapbook Section can be added to a Section")
		}
		if !at.Valid {
			return conflict("a Scrapbook Section can only be added to a Section in the Lyric Sheet")
		}
		alternates, err := alternatesOf(ctx, tx, scrapID)
		if err != nil {
			return err
		}
		// Each is made anew, so it comes after the Section's own Alternates.
		for _, altID := range alternates {
			newID, err := insert(ctx, tx, `INSERT INTO alternates (section_id, name)
				SELECT ?, CASE a.name WHEN '' THEN s.label ELSE a.name END
				FROM alternates a JOIN sections s ON s.id = a.section_id WHERE a.id = ?`,
				sectionID, altID)
			if err != nil {
				return fmt.Errorf("adding alternate: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `UPDATE lines SET alternate_id = ? WHERE alternate_id = ?`,
				newID, altID); err != nil {
				return fmt.Errorf("moving lines: %w", err)
			}
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM sections WHERE id = ?`, scrapID); err != nil {
			return fmt.Errorf("deleting scrapbook section: %w", err)
		}
		return nil
	})
}

// scrapbookLabel is the Label of a Section made from an Alternate moved to
// the Scrapbook: its Section's Label and its name, e.g. "Verse 1 · Darker",
// whichever of them it has.
func scrapbookLabel(label, name string) string {
	if label == "" || name == "" {
		return label + name
	}
	return label + " · " + name
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
