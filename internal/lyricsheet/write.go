package lyricsheet

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
)

// Every change to a Lyric Sheet is a pure change to the whole sheet,
// checked by checkChange and written by writeSheet (ADR 0024).

// editSheet makes one change to a Song's Lyric Sheet and Scrapbook within
// tx: it loads the sheet, has edit make the change to it, checks what the
// change leaves and writes it. edit is pure: it gets a copy of the sheet,
// and ids for any rows it adds.
func editSheet(ctx context.Context, tx *sql.Tx, songID int64,
	edit func(sheet LyricSheet, ids *ids) (LyricSheet, error)) error {
	before, err := loadLyricSheet(ctx, tx, songID)
	if err != nil {
		return err
	}
	newIDs, err := storedIDs(ctx, tx)
	if err != nil {
		return err
	}
	after, err := edit(cloneSheet(before), newIDs)
	if err != nil {
		return err
	}
	if err := checkChange(before, after); err != nil {
		return err
	}
	return writeSheet(ctx, tx, songID, after)
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
			for k := range alt.Lines {
				l := &alt.Lines[k]
				l.Chords = slices.Clone(l.Chords)
				l.Cue = copyCue(l.Cue)
			}
		}
	}
	return clone
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
