package lyricsheet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// AddAlternate creates a new Alternate of a Section with the given name, as a
// copy of the active Alternate's Lines and their Cues, and makes it the active
// one. The one it copied keeps its own Cues, dormant (ADR 0007).
func (s *Store) AddAlternate(ctx context.Context, songID int64, based songversion.Version, sectionID int64, name string) (Song, error) {
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
func (s *Store) RenameAlternate(ctx context.Context, songID int64, based songversion.Version, alternateID int64, name string) (Song, error) {
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
func (s *Store) ActivateAlternate(ctx context.Context, songID int64, based songversion.Version, alternateID int64) (Song, error) {
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
func (s *Store) DeleteAlternate(ctx context.Context, songID int64, based songversion.Version, alternateID int64) (Song, error) {
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
			return domain.Conflict("a Section's last Alternate can't be deleted")
		}
		if active {
			return domain.Conflict("the active Alternate can't be deleted; activate another one first")
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
func (s *Store) MoveAlternateToScrapbook(ctx context.Context, songID int64, based songversion.Version, alternateID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		newID, err := moveAlternateOut(ctx, tx, songID, alternateID)
		if err != nil {
			return err
		}
		return toScrapbookEnd(ctx, tx, songID, newID)
	})
}

// MoveAlternateToArrangement moves an inactive Alternate out of its Section
// into a new Section of its own at position in the Arrangement, labelled as
// MoveAlternateToScrapbook labels it. Its Cues go with it, live at once, as
// it's now the Section's active Alternate (ADR 0010). The active Alternate
// can't be moved.
func (s *Store) MoveAlternateToArrangement(ctx context.Context, songID int64, based songversion.Version, alternateID int64, position int) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		newID, err := moveAlternateOut(ctx, tx, songID, alternateID)
		if err != nil {
			return err
		}
		// The new Section isn't in the Arrangement yet, so it doesn't count.
		pos, err := arrangementPosition(ctx, tx, songID, &position)
		if err != nil {
			return err
		}
		return placeSection(ctx, tx, songID, newID, pos)
	})
}

// moveAlternateOut moves an inactive Alternate out of its Section into a new
// Section of its own, not yet placed anywhere, and returns its id. The new
// Section is labelled with the old one's Label and the Alternate's name.
func moveAlternateOut(ctx context.Context, tx *sql.Tx, songID, alternateID int64) (int64, error) {
	var label, name string
	var active bool
	err := tx.QueryRowContext(ctx, `SELECT s.label, a.name, a.active FROM alternates a
		JOIN sections s ON s.id = a.section_id WHERE a.id = ? AND s.song_id = ?`,
		alternateID, songID).Scan(&label, &name, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("reading alternate: %w", err)
	}
	if active {
		return 0, domain.Conflict("the active Alternate can't be moved out of its Section; activate another one first")
	}
	newID, err := insert(ctx, tx, `INSERT INTO sections (song_id, label) VALUES (?, ?)`,
		songID, movedOutLabel(label, name))
	if err != nil {
		return 0, fmt.Errorf("adding section: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE alternates SET section_id = ?, active = 1 WHERE id = ?`,
		newID, alternateID); err != nil {
		return 0, fmt.Errorf("moving alternate: %w", err)
	}
	return newID, nil
}

// AddToSection adds a Section, from the Scrapbook or the Lyric Sheet, to
// another Section in the Lyric Sheet: every Alternate of the added Section
// joins the Section, inactive, after its own, so what the Section shows is
// unchanged, and the added Section is gone, from the Arrangement too. An
// unnamed Alternate takes the added Section's Label as its name. Their Lines
// keep their ids and their Cues, dormant until their Alternate is made
// active (ADR 0010).
func (s *Store) AddToSection(ctx context.Context, songID int64, based songversion.Version, addedID, sectionID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		addedAt, err := findSection(ctx, tx, songID, addedID)
		if err != nil {
			return err
		}
		at, err := findSection(ctx, tx, songID, sectionID)
		if err != nil {
			return err
		}
		if addedID == sectionID {
			return domain.Conflict("a Section can't be added to itself")
		}
		if !at.Valid {
			return domain.Conflict("a Section can only be added to a Section in the Lyric Sheet")
		}
		if addedAt.Valid {
			if err := leaveArrangement(ctx, tx, songID, addedID, addedAt.Int64); err != nil {
				return err
			}
		}
		alternates, err := alternatesOf(ctx, tx, addedID)
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
		if _, err := tx.ExecContext(ctx, `DELETE FROM sections WHERE id = ?`, addedID); err != nil {
			return fmt.Errorf("deleting added section: %w", err)
		}
		return nil
	})
}

// movedOutLabel is the Label of a Section made from an Alternate moved out
// of its Section: that Section's Label and its name, e.g. "Verse 1 · Darker",
// whichever of them it has.
func movedOutLabel(label, name string) string {
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
		return 0, false, domain.ErrNotFound
	}
	return sectionID, active, err
}

// cleanName trims an Alternate's name; blank means no name.
func cleanName(name string) string {
	return strings.TrimSpace(name)
}
