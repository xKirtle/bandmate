package lyricsheet

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// PutSheetBack makes a Song's Lyric Sheet and Scrapbook a copy of them as
// they were, in one change, as Undo and Redo do (ADR 0019). It's restoring
// a Snapshot without the Snapshot: rows still there keep their ids, and a
// Line still there its Cue as it is now; rows the copy brings back come
// back with their ids and Cues; rows it doesn't hold are deleted. It takes
// no Snapshot of its own, but starts an editing session like any change
// to the sheet. A copy that isn't a sheet of this Song is refused.
func (s *Store) PutSheetBack(ctx context.Context, songID int64, based songversion.Version, sheet LyricSheet) (Song, error) {
	if err := checkSheet(sheet); err != nil {
		return Song{}, err
	}
	return s.changeSheet(ctx, songID, based, func(tx *sql.Tx) error {
		if err := checkSheetIDs(ctx, tx, songID, sheet); err != nil {
			return err
		}
		return restoreSheet(ctx, tx, songID, toHeld(sheet))
	})
}

// checkSheet checks a copy is a sheet: each Section in exactly one of the
// Arrangement and the Scrapbook, once, each with exactly one active
// Alternate, no id held twice, each Line one line of text, and each Cue one
// a Line can have.
func checkSheet(sheet LyricSheet) error {
	placed := map[int64]int{}
	for _, id := range append(append([]int64{}, sheet.Arrangement...), sheet.Scrapbook...) {
		placed[id]++
	}
	seen := map[string]map[int64]bool{"sections": {}, "alternates": {}, "lines": {}}
	once := func(table string, id int64) error {
		if id <= 0 || seen[table][id] {
			return domain.Invalid(fmt.Sprintf("each of the sheet's %s needs an id of its own", table))
		}
		seen[table][id] = true
		return nil
	}
	for _, sec := range sheet.Sections {
		if err := once("sections", sec.ID); err != nil {
			return err
		}
		if placed[sec.ID] != 1 {
			return domain.Invalid("each Section must be in exactly one of the Lyric Sheet and the Scrapbook, once")
		}
		active := 0
		for _, alt := range sec.Alternates {
			if err := once("alternates", alt.ID); err != nil {
				return err
			}
			if alt.Active {
				active++
			}
			for _, l := range alt.Lines {
				if err := once("lines", l.ID); err != nil {
					return err
				}
				if strings.ContainsAny(l.Text, "\r\n") {
					return domain.Invalid("a Line's text can't hold a line break")
				}
				if l.Cue != nil {
					if _, err := cueMillis(*l.Cue); err != nil {
						return err
					}
				}
			}
		}
		if active != 1 {
			return domain.Invalid("each Section must have exactly one active Alternate")
		}
	}
	if len(placed) != len(sheet.Sections) {
		return domain.Invalid("each Section must be in exactly one of the Lyric Sheet and the Scrapbook, once")
	}
	return nil
}

// checkSheetIDs checks a copy's ids are this Song's, or held by no row now,
// as a row it brings back was deleted.
func checkSheetIDs(ctx context.Context, tx *sql.Tx, songID int64, sheet LyricSheet) error {
	owner := map[string]string{
		"sections":   `SELECT song_id FROM sections WHERE id = ?`,
		"alternates": `SELECT s.song_id FROM alternates a JOIN sections s ON s.id = a.section_id WHERE a.id = ?`,
		"lines": `SELECT s.song_id FROM lines l JOIN alternates a ON a.id = l.alternate_id
			JOIN sections s ON s.id = a.section_id WHERE l.id = ?`,
	}
	check := func(table string, id int64) error {
		var song int64
		err := tx.QueryRowContext(ctx, owner[table], id).Scan(&song)
		switch {
		case err == sql.ErrNoRows:
			return nil
		case err != nil:
			return fmt.Errorf("checking the sheet's %s: %w", table, err)
		case song != songID:
			return domain.Invalid(fmt.Sprintf("the sheet holds %s of another Song", table))
		}
		return nil
	}
	for _, sec := range sheet.Sections {
		if err := check("sections", sec.ID); err != nil {
			return err
		}
		for _, alt := range sec.Alternates {
			if err := check("alternates", alt.ID); err != nil {
				return err
			}
			for _, l := range alt.Lines {
				if err := check("lines", l.ID); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
