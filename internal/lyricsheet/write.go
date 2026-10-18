package lyricsheet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"maps"
	"slices"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// Every change to a Lyric Sheet is a pure change to the whole sheet,
// checked by checkChange and written by writeSheet, and whether it takes a
// Snapshot is worked out from the sheet before and after it (ADR 0024).

// editSheet makes one change to a Song's Lyric Sheet and Scrapbook, as
// every such change is made, Cues' included: edit makes it, a pure change
// to a copy of the whole sheet, given ids for any rows it adds. reason is
// BeforeDeleting or BeforeRestoring for a change that always takes a
// Snapshot first, else "": whether the change takes one then is worked out
// from the sheet before and after it, by decideSnapshot.
func (s *Store) editSheet(ctx context.Context, songID int64, based songversion.Version, reason SnapshotReason,
	edit func(sheet LyricSheet, ids *ids) (LyricSheet, error)) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return s.editSheetIn(ctx, tx, songID, reason, edit)
	})
}

// editSheetIn is editSheet within tx, for a change that reads something
// else of the Song first, as a restore reads its Snapshot.
func (s *Store) editSheetIn(ctx context.Context, tx *sql.Tx, songID int64, reason SnapshotReason,
	edit func(sheet LyricSheet, ids *ids) (LyricSheet, error)) error {
	before, err := loadLyricSheet(ctx, tx, songID)
	if err != nil {
		return err
	}
	newIDs, err := storedIDs(ctx, tx)
	if err != nil {
		return err
	}
	handed := maps.Clone(newIDs.last)
	after, err := edit(cloneSheet(before), newIDs)
	if err != nil {
		return err
	}
	if err := checkChange(before, after); err != nil {
		return err
	}
	if err := checkTakenIDs(ctx, tx, songID, before, after, handed); err != nil {
		return err
	}
	changedAt, newest, err := readSheetHistory(ctx, tx, songID)
	if err != nil {
		return err
	}
	now := s.now().UTC()
	decision := decideSnapshot(before, after, changedAt, newest, reason, now)
	if err := writeSheet(ctx, tx, songID, after); err != nil {
		return err
	}
	if decision.take {
		if err := insertSnapshot(ctx, tx, songID, now, decision.reason, decision.deleted, before); err != nil {
			return err
		}
	}
	if !decision.changed {
		return nil
	}
	return markSheetChanged(ctx, tx, songID, now)
}

// checkTakenIDs checks the ids a change put in the sheet that it didn't
// hold before and the id source didn't hand out, the source having counted
// up from handed: each must be held by no other Song's row, as a row
// brought back was this Song's and has been deleted.
func checkTakenIDs(ctx context.Context, tx *sql.Tx, songID int64, before, after LyricSheet,
	handed map[string]int64) error {
	held := sheetIDs(before)
	for table, ids := range sheetIDs(after) {
		for id := range ids {
			if held[table][id] || id > handed[table] {
				continue
			}
			if err := checkNotAnotherSongs(ctx, tx, songID, table, id); err != nil {
				return err
			}
		}
	}
	return nil
}

// sheetIDs are the ids a sheet holds, by the table their rows are in.
func sheetIDs(sheet LyricSheet) map[string]map[int64]bool {
	ids := map[string]map[int64]bool{"sections": {}, "alternates": {}, "lines": {}}
	for _, sec := range sheet.Sections {
		ids["sections"][sec.ID] = true
		for _, alt := range sec.Alternates {
			ids["alternates"][alt.ID] = true
			for _, l := range alt.Lines {
				ids["lines"][l.ID] = true
			}
		}
	}
	return ids
}

// owners reads which Song holds a row of each sheet table, by its id.
var owners = map[string]string{
	"sections":   `SELECT song_id FROM sections WHERE id = ?`,
	"alternates": `SELECT s.song_id FROM alternates a JOIN sections s ON s.id = a.section_id WHERE a.id = ?`,
	"lines": `SELECT s.song_id FROM lines l JOIN alternates a ON a.id = l.alternate_id
		JOIN sections s ON s.id = a.section_id WHERE l.id = ?`,
}

// checkNotAnotherSongs refuses an id of table held by another Song's row.
func checkNotAnotherSongs(ctx context.Context, tx *sql.Tx, songID int64, table string, id int64) error {
	var song int64
	err := tx.QueryRowContext(ctx, owners[table], id).Scan(&song)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return nil
	case err != nil:
		return fmt.Errorf("checking the sheet's %s: %w", table, err)
	case song != songID:
		return domain.Invalid(fmt.Sprintf("the sheet holds %s of another Song", table))
	}
	return nil
}

// cloneSheet is a copy of a sheet sharing nothing with it, so a change to
// one leaves the other as it was.
func cloneSheet(sheet LyricSheet) LyricSheet {
	clone := LyricSheet{
		Arrangement: slices.Clone(sheet.Arrangement),
		Scrapbook:   slices.Clone(sheet.Scrapbook),
		Sections:    slices.Clone(sheet.Sections),
	}
	for i := range clone.Sections {
		sec := &clone.Sections[i]
		sec.Alternates = slices.Clone(sec.Alternates)
		for j := range sec.Alternates {
			alt := &sec.Alternates[j]
			alt.Lines = slices.Clone(alt.Lines)
			for k, l := range alt.Lines {
				alt.Lines[k] = cloneLine(l)
			}
		}
	}
	return clone
}

// cloneLine is a copy of a Line sharing nothing with it.
func cloneLine(l Line) Line {
	l.Chords = slices.Clone(l.Chords)
	l.Cue = copyCue(l.Cue)
	return l
}

// copyCue is a copy of a Cue, nil for none.
func copyCue(cue *float64) *float64 {
	if cue == nil {
		return nil
	}
	c := *cue
	return &c
}

// sheetTables are the tables a Lyric Sheet's rows are in.
var sheetTables = []string{"sections", "alternates", "lines"}

// ids hands out the ids of the rows a change to a Lyric Sheet adds, each
// one past the last its table handed out, so writeSheet inserts them as
// they are. Its zero value is a plain counter from 1, for tests.
type ids struct {
	last map[string]int64
}

func (i *ids) next(table string) int64 {
	if i.last == nil {
		i.last = map[string]int64{}
	}
	i.last[table]++
	return i.last[table]
}

func (i *ids) section() int64   { return i.next("sections") }
func (i *ids) alternate() int64 { return i.next("alternates") }
func (i *ids) line() int64      { return i.next("lines") }

// storedIDs is ids that count up from each sheet table's last-used id,
// held by a row now or not. The tables are AUTOINCREMENT, so an id is never
// used twice: a restore brings rows back with the ids they had.
func storedIDs(ctx context.Context, tx *sql.Tx) (*ids, error) {
	last := map[string]int64{}
	for _, table := range sheetTables {
		var id int64
		if err := tx.QueryRowContext(ctx, `SELECT MAX(
			COALESCE((SELECT MAX(id) FROM `+table+`), 0),
			COALESCE((SELECT seq FROM sqlite_sequence WHERE name = ?), 0))`, table).Scan(&id); err != nil {
			return nil, fmt.Errorf("reading the last id of %s: %w", table, err)
		}
		last[table] = id
	}
	return &ids{last: last}, nil
}

// storedSection is a Section's row as stored.
type storedSection struct {
	label string
	// position is its place in the Arrangement; null while it's in the
	// Scrapbook, where scrapbookPosition orders it.
	position          sql.NullInt64
	scrapbookPosition int64
}

// storedAlternate is an Alternate's row as stored.
type storedAlternate struct {
	sectionID int64
	name      string
	active    bool
}

// storedLine is a Line's row as stored.
type storedLine struct {
	alternateID int64
	position    int64
	text        string
	cueMs       sql.NullInt64
}

// writeSheet makes a Song's stored Lyric Sheet and Scrapbook sheet, Cues
// included, writing only the rows that differ: it inserts the rows sheet
// adds, with their ids, updates those it changes and deletes those it
// doesn't hold. It writes exactly what it's given, so sheet must have been
// checked by checkChange first.
func writeSheet(ctx context.Context, tx *sql.Tx, songID int64, sheet LyricSheet) error {
	sections, alternates, lines, err := readStored(ctx, tx, songID)
	if err != nil {
		return err
	}

	// Where sheet puts each Section, and which Alternates it makes active.
	position := map[int64]sql.NullInt64{}
	scrapbookPosition := map[int64]int64{}
	for i, id := range sheet.Arrangement {
		position[id] = sql.NullInt64{Int64: int64(i), Valid: true}
	}
	for i, id := range sheet.Scrapbook {
		scrapbookPosition[id] = int64(i + 1)
	}
	activeIn := map[int64]int64{}
	for _, sec := range sheet.Sections {
		for _, alt := range sec.Alternates {
			if alt.Active {
				activeIn[alt.ID] = sec.ID
			}
		}
	}

	// A Section has one active Alternate at most at any moment, so each
	// active one that isn't staying so in its Section stops first.
	for id, alt := range alternates {
		if alt.active && activeIn[id] != alt.sectionID {
			if _, err := tx.ExecContext(ctx, `UPDATE alternates SET active = 0 WHERE id = ?`, id); err != nil {
				return fmt.Errorf("writing alternate: %w", err)
			}
			alt.active = false
			alternates[id] = alt
		}
	}

	for _, sec := range sheet.Sections {
		want := storedSection{label: sec.Label, position: position[sec.ID]}
		was, there := sections[sec.ID]
		delete(sections, sec.ID)
		// A Section in the Arrangement keeps whatever Scrapbook place it
		// had, which nothing reads.
		want.scrapbookPosition = was.scrapbookPosition
		if !want.position.Valid {
			want.scrapbookPosition = scrapbookPosition[sec.ID]
		}
		switch {
		case !there:
			_, err = tx.ExecContext(ctx, `INSERT INTO sections (id, song_id, label, position, scrapbook_position)
				VALUES (?, ?, ?, ?, ?)`, sec.ID, songID, want.label, want.position, want.scrapbookPosition)
		case want != was:
			_, err = tx.ExecContext(ctx, `UPDATE sections SET label = ?, position = ?, scrapbook_position = ?
				WHERE id = ?`, want.label, want.position, want.scrapbookPosition, sec.ID)
		}
		if err != nil {
			return fmt.Errorf("writing section: %w", err)
		}
	}

	for _, sec := range sheet.Sections {
		for _, alt := range sec.Alternates {
			want := storedAlternate{sectionID: sec.ID, name: alt.Name, active: alt.Active}
			was, there := alternates[alt.ID]
			delete(alternates, alt.ID)
			switch {
			case !there:
				_, err = tx.ExecContext(ctx, `INSERT INTO alternates (id, section_id, name, active) VALUES (?, ?, ?, ?)`,
					alt.ID, want.sectionID, want.name, want.active)
			case want != was:
				_, err = tx.ExecContext(ctx, `UPDATE alternates SET section_id = ?, name = ?, active = ? WHERE id = ?`,
					want.sectionID, want.name, want.active, alt.ID)
			}
			if err != nil {
				return fmt.Errorf("writing alternate: %w", err)
			}
		}
	}

	for _, sec := range sheet.Sections {
		for _, alt := range sec.Alternates {
			for pos, l := range alt.Lines {
				want := storedLine{alternateID: alt.ID, position: int64(pos), text: l.Text}
				if l.Cue != nil {
					want.cueMs = sql.NullInt64{Int64: millis(*l.Cue), Valid: true}
				}
				was, there := lines[l.ID]
				delete(lines, l.ID)
				switch {
				case !there:
					_, err = tx.ExecContext(ctx, `INSERT INTO lines (id, alternate_id, position, text, cue_ms)
						VALUES (?, ?, ?, ?, ?)`, l.ID, want.alternateID, want.position, want.text, want.cueMs)
				case want != was:
					_, err = tx.ExecContext(ctx, `UPDATE lines SET alternate_id = ?, position = ?, text = ?, cue_ms = ?
						WHERE id = ?`, want.alternateID, want.position, want.text, want.cueMs, l.ID)
				}
				if err != nil {
					return fmt.Errorf("writing line: %w", err)
				}
			}
		}
	}

	// What's left isn't in sheet. Every row it keeps has moved off those
	// going by now, so a delete cascades only to rows going too.
	for _, gone := range []struct {
		table string
		ids   []int64
	}{{"lines", keys(lines)}, {"alternates", keys(alternates)}, {"sections", keys(sections)}} {
		for _, id := range gone.ids {
			if _, err := tx.ExecContext(ctx, `DELETE FROM `+gone.table+` WHERE id = ?`, id); err != nil {
				return fmt.Errorf("deleting from %s: %w", gone.table, err)
			}
		}
	}
	return nil
}

// keys are a map's keys.
func keys[V any](m map[int64]V) []int64 {
	ids := make([]int64, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	return ids
}

// readStored reads the rows of a Song's Lyric Sheet as stored, by id.
func readStored(ctx context.Context, tx *sql.Tx, songID int64) (map[int64]storedSection,
	map[int64]storedAlternate, map[int64]storedLine, error) {
	sections := map[int64]storedSection{}
	err := query(ctx, tx, `SELECT id, label, position, scrapbook_position FROM sections WHERE song_id = ?`,
		[]any{songID}, func(rows *sql.Rows) error {
			var id int64
			var s storedSection
			err := rows.Scan(&id, &s.label, &s.position, &s.scrapbookPosition)
			sections[id] = s
			return err
		})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("reading sections: %w", err)
	}
	alternates := map[int64]storedAlternate{}
	err = query(ctx, tx, `SELECT a.id, a.section_id, a.name, a.active
		FROM alternates a JOIN sections s ON s.id = a.section_id WHERE s.song_id = ?`,
		[]any{songID}, func(rows *sql.Rows) error {
			var id int64
			var a storedAlternate
			err := rows.Scan(&id, &a.sectionID, &a.name, &a.active)
			alternates[id] = a
			return err
		})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("reading alternates: %w", err)
	}
	lines := map[int64]storedLine{}
	err = query(ctx, tx, `SELECT l.id, l.alternate_id, l.position, l.text, l.cue_ms
		FROM lines l JOIN alternates a ON a.id = l.alternate_id JOIN sections s ON s.id = a.section_id
		WHERE s.song_id = ?`,
		[]any{songID}, func(rows *sql.Rows) error {
			var id int64
			var l storedLine
			err := rows.Scan(&id, &l.alternateID, &l.position, &l.text, &l.cueMs)
			lines[id] = l
			return err
		})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("reading lines: %w", err)
	}
	return sections, alternates, lines, nil
}
