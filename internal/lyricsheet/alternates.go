package lyricsheet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// AddAlternate creates a new Alternate of a Section with the given name, as a
// copy of the active Alternate's Lines and their Cues, and makes it the active
// one. The one it copied keeps its own Cues, dormant (ADR 0007).
func (s *Store) AddAlternate(ctx context.Context, songID int64, based songversion.Version, sectionID int64, name string) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, ids *ids) (LyricSheet, error) {
		return addAlternate(sheet, ids, sectionID, name)
	})
}

// addAlternate is AddAlternate's change to the sheet.
func addAlternate(sheet LyricSheet, ids *ids, sectionID int64, name string) (LyricSheet, error) {
	sec, err := sheetSection(sheet, sectionID)
	if err != nil {
		return LyricSheet{}, err
	}
	active := slices.IndexFunc(sec.Alternates, func(a Alternate) bool { return a.Active })
	if active < 0 {
		return LyricSheet{}, fmt.Errorf("section %d has no active alternate", sectionID)
	}
	from := sec.Alternates[active].Lines
	added := Alternate{ID: ids.alternate(), Name: cleanName(name), Active: true, Lines: make([]Line, len(from))}
	for i, l := range from {
		added.Lines[i] = cloneLine(l)
		added.Lines[i].ID = ids.line()
	}
	sec.Alternates[active].Active = false
	sec.Alternates = append(sec.Alternates, added)
	return sheet, nil
}

// RenameAlternate changes an Alternate's name. A blank name removes it.
func (s *Store) RenameAlternate(ctx context.Context, songID int64, based songversion.Version, alternateID int64, name string) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, _ *ids) (LyricSheet, error) {
		return renameAlternate(sheet, alternateID, name)
	})
}

// renameAlternate is RenameAlternate's change to the sheet.
func renameAlternate(sheet LyricSheet, alternateID int64, name string) (LyricSheet, error) {
	sec, i, err := sheetAlternate(sheet, alternateID)
	if err != nil {
		return LyricSheet{}, err
	}
	sec.Alternates[i].Name = cleanName(name)
	return sheet, nil
}

// ActivateAlternate makes an Alternate the only active one of its Section, so
// the Section shows it.
func (s *Store) ActivateAlternate(ctx context.Context, songID int64, based songversion.Version, alternateID int64) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, _ *ids) (LyricSheet, error) {
		return activateAlternate(sheet, alternateID)
	})
}

// activateAlternate is ActivateAlternate's change to the sheet.
func activateAlternate(sheet LyricSheet, alternateID int64) (LyricSheet, error) {
	sec, active, err := sheetAlternate(sheet, alternateID)
	if err != nil {
		return LyricSheet{}, err
	}
	for i := range sec.Alternates {
		sec.Alternates[i].Active = i == active
	}
	return sheet, nil
}

// sheetAlternate is one of a sheet's Alternates, by id, as the Section it's
// in and its index there, to read or change in place: domain.ErrNotFound if
// it isn't the sheet's.
func sheetAlternate(sheet LyricSheet, alternateID int64) (*Section, int, error) {
	for i := range sheet.Sections {
		sec := &sheet.Sections[i]
		if j := slices.IndexFunc(sec.Alternates, func(a Alternate) bool { return a.ID == alternateID }); j >= 0 {
			return sec, j, nil
		}
	}
	return nil, 0, domain.ErrNotFound
}

// DeleteAlternate deletes an inactive Alternate and its Lines, having taken
// a Snapshot naming it first. The active Alternate, and so a Section's last
// one, can't be deleted.
func (s *Store) DeleteAlternate(ctx context.Context, songID int64, based songversion.Version, alternateID int64) (Song, error) {
	return s.changeBefore(ctx, songID, based, BeforeDeleting, func(tx *sql.Tx) (string, func() error, error) {
		sheet, err := loadLyricSheet(ctx, tx, songID)
		if err != nil {
			return "", nil, err
		}
		sec, i, err := sheetAlternate(sheet, alternateID)
		if err != nil {
			return "", nil, err
		}
		name := alternateName(*sec, i)
		// A refusal comes before the Snapshot is taken.
		if _, err := deleteAlternate(cloneSheet(sheet), alternateID); err != nil {
			return "", nil, err
		}
		return name, func() error {
			return editSheet(ctx, tx, songID, func(sheet LyricSheet, _ *ids) (LyricSheet, error) {
				return deleteAlternate(sheet, alternateID)
			})
		}, nil
	})
}

// deleteAlternate is DeleteAlternate's change to the sheet.
func deleteAlternate(sheet LyricSheet, alternateID int64) (LyricSheet, error) {
	sec, i, err := sheetAlternate(sheet, alternateID)
	if err != nil {
		return LyricSheet{}, err
	}
	if len(sec.Alternates) == 1 {
		return LyricSheet{}, domain.Conflict("a Section's last Alternate can't be deleted")
	}
	if sec.Alternates[i].Active {
		return LyricSheet{}, domain.Conflict("the active Alternate can't be deleted; activate another one first")
	}
	sec.Alternates = slices.Delete(sec.Alternates, i, i+1)
	return sheet, nil
}

// MoveAlternateToScrapbook moves an inactive Alternate out of its Section
// into a new Section of its own in the Scrapbook, labelled with the Section's
// Label and the Alternate's name. Its Cues go with it, and are live once
// the new Section is put back (ADR 0010). The active Alternate can't be
// moved.
func (s *Store) MoveAlternateToScrapbook(ctx context.Context, songID int64, based songversion.Version, alternateID int64) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, ids *ids) (LyricSheet, error) {
		return moveAlternateToScrapbook(sheet, ids, alternateID)
	})
}

// moveAlternateToScrapbook is MoveAlternateToScrapbook's change to the
// sheet.
func moveAlternateToScrapbook(sheet LyricSheet, ids *ids, alternateID int64) (LyricSheet, error) {
	sheet, newID, err := moveAlternateOut(sheet, ids, alternateID)
	if err != nil {
		return LyricSheet{}, err
	}
	sheet.Scrapbook = append(sheet.Scrapbook, newID)
	return sheet, nil
}

// MoveAlternateToArrangement moves an inactive Alternate out of its Section
// into a new Section of its own at position in the Arrangement, labelled as
// MoveAlternateToScrapbook labels it. Its Cues go with it, live at once, as
// it's now the Section's active Alternate (ADR 0010). The active Alternate
// can't be moved.
func (s *Store) MoveAlternateToArrangement(ctx context.Context, songID int64, based songversion.Version, alternateID int64, position int) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, ids *ids) (LyricSheet, error) {
		return moveAlternateToArrangement(sheet, ids, alternateID, position)
	})
}

// moveAlternateToArrangement is MoveAlternateToArrangement's change to the
// sheet.
func moveAlternateToArrangement(sheet LyricSheet, ids *ids, alternateID int64, position int) (LyricSheet, error) {
	sheet, newID, err := moveAlternateOut(sheet, ids, alternateID)
	if err != nil {
		return LyricSheet{}, err
	}
	arrangement, err := placeAt(sheet.Arrangement, newID, &position)
	if err != nil {
		return LyricSheet{}, err
	}
	sheet.Arrangement = arrangement
	return sheet, nil
}

// moveAlternateOut moves an inactive Alternate out of its Section into a new
// Section of its own, as its active Alternate, not yet placed anywhere, and
// returns the new Section's id. The new Section is labelled with the old
// one's Label and the Alternate's name.
func moveAlternateOut(sheet LyricSheet, ids *ids, alternateID int64) (_ LyricSheet, newID int64, _ error) {
	sec, i, err := sheetAlternate(sheet, alternateID)
	if err != nil {
		return LyricSheet{}, 0, err
	}
	alt := sec.Alternates[i]
	if alt.Active {
		return LyricSheet{}, 0, domain.Conflict("the active Alternate can't be moved out of its Section; activate another one first")
	}
	sec.Alternates = slices.Delete(sec.Alternates, i, i+1)
	alt.Active = true
	moved := Section{ID: ids.section(), Label: movedOutLabel(sec.Label, alt.Name), Alternates: []Alternate{alt}}
	sheet.Sections = append(sheet.Sections, moved)
	return sheet, moved.ID, nil
}

// AddToSection adds a Section, from the Scrapbook or the Lyric Sheet, to
// another Section in the Lyric Sheet: every Alternate of the added Section
// joins the Section, inactive, after its own, so what the Section shows is
// unchanged, and the added Section is gone, from the Arrangement too. An
// unnamed Alternate takes the added Section's Label as its name. Their Lines
// keep their ids and their Cues, dormant until their Alternate is made
// active (ADR 0010).
func (s *Store) AddToSection(ctx context.Context, songID int64, based songversion.Version, addedID, sectionID int64) (Song, error) {
	return s.changeSheetWith(ctx, songID, based, func(sheet LyricSheet, ids *ids) (LyricSheet, error) {
		return addToSection(sheet, ids, addedID, sectionID)
	})
}

// addToSection is AddToSection's change to the sheet.
func addToSection(sheet LyricSheet, ids *ids, addedID, sectionID int64) (LyricSheet, error) {
	added, err := sheetSection(sheet, addedID)
	if err != nil {
		return LyricSheet{}, err
	}
	sec, err := sheetSection(sheet, sectionID)
	if err != nil {
		return LyricSheet{}, err
	}
	if addedID == sectionID {
		return LyricSheet{}, domain.Conflict("a Section can't be added to itself")
	}
	if !slices.Contains(sheet.Arrangement, sectionID) {
		return LyricSheet{}, domain.Conflict("a Section can only be added to a Section in the Lyric Sheet")
	}
	// Each is made anew, so its id puts it after the Section's own
	// Alternates.
	for _, alt := range added.Alternates {
		alt.ID, alt.Active = ids.alternate(), false
		if alt.Name == "" {
			alt.Name = added.Label
		}
		sec.Alternates = append(sec.Alternates, alt)
	}
	sheet.Arrangement = without(sheet.Arrangement, addedID)
	sheet.Scrapbook = without(sheet.Scrapbook, addedID)
	sheet.Sections = slices.DeleteFunc(sheet.Sections, func(s Section) bool { return s.ID == addedID })
	return sheet, nil
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
