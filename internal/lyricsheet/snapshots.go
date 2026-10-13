package lyricsheet

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// EditingSession is how long the Lyric Sheet and Scrapbook go without a
// change before the next change starts an editing session, which takes a
// Snapshot first.
const EditingSession = 10 * time.Minute

// SnapshotReason says why a Snapshot was taken.
type SnapshotReason string

const (
	// BeforeEditing is a Snapshot taken before an editing session.
	BeforeEditing SnapshotReason = "editing"
	// BeforeRestoring is a Snapshot taken before a restore.
	BeforeRestoring SnapshotReason = "restoring"
)

// SnapshotSummary is a Snapshot as listed: when it was taken, and why.
type SnapshotSummary struct {
	ID      int64          `json:"id"`
	TakenAt time.Time      `json:"takenAt"`
	Reason  SnapshotReason `json:"reason"`
}

// Snapshot is a copy of a Song's Lyric Sheet and Scrapbook as they were.
type Snapshot struct {
	SnapshotSummary
	// Sheet is the Lyric Sheet and Scrapbook it holds, with their ids, as a
	// Song's are given.
	Sheet LyricSheet `json:"sheet"`
}

// heldSheet is a Lyric Sheet and Scrapbook as a Snapshot stores them: only
// what's written, with its ids, and nothing read from it, like a Line's
// Chords.
type heldSheet struct {
	Arrangement []int64       `json:"arrangement"`
	Scrapbook   []int64       `json:"scrapbook"`
	Sections    []heldSection `json:"sections"`
}

type heldSection struct {
	ID         int64           `json:"id"`
	Label      string          `json:"label"`
	Alternates []heldAlternate `json:"alternates"`
}

type heldAlternate struct {
	ID     int64      `json:"id"`
	Name   string     `json:"name"`
	Active bool       `json:"active"`
	Lines  []heldLine `json:"lines"`
}

type heldLine struct {
	ID   int64  `json:"id"`
	Text string `json:"text"`
	// CueMs is the Line's Cue in milliseconds, as lines.cue_ms holds it;
	// nil means none.
	CueMs *int64 `json:"cueMs,omitempty"`
}

// hold is the part of a Lyric Sheet a Snapshot keeps.
func hold(sheet LyricSheet) heldSheet {
	held := heldSheet{Arrangement: sheet.Arrangement, Scrapbook: sheet.Scrapbook, Sections: []heldSection{}}
	for _, sec := range sheet.Sections {
		hs := heldSection{ID: sec.ID, Label: sec.Label, Alternates: []heldAlternate{}}
		for _, alt := range sec.Alternates {
			ha := heldAlternate{ID: alt.ID, Name: alt.Name, Active: alt.Active, Lines: []heldLine{}}
			for _, l := range alt.Lines {
				hl := heldLine{ID: l.ID, Text: l.Text}
				if l.Cue != nil {
					ms := int64(math.Round(*l.Cue * 1000))
					hl.CueMs = &ms
				}
				ha.Lines = append(ha.Lines, hl)
			}
			hs.Alternates = append(hs.Alternates, ha)
		}
		held.Sections = append(held.Sections, hs)
	}
	return held
}

// lyricSheet is a held sheet as a Song's Lyric Sheet is given, each Line
// read from its text.
func (h heldSheet) lyricSheet() LyricSheet {
	sheet := LyricSheet{Arrangement: h.Arrangement, Scrapbook: h.Scrapbook, Sections: []Section{}}
	for _, hs := range h.Sections {
		sec := Section{ID: hs.ID, Label: hs.Label, Alternates: []Alternate{}}
		for _, ha := range hs.Alternates {
			alt := Alternate{ID: ha.ID, Name: ha.Name, Active: ha.Active, Lines: []Line{}}
			for _, hl := range ha.Lines {
				var cue sql.NullInt64
				if hl.CueMs != nil {
					cue = sql.NullInt64{Int64: *hl.CueMs, Valid: true}
				}
				alt.Lines = append(alt.Lines, newLine(hl.ID, hl.Text, cue))
			}
			sec.Alternates = append(sec.Alternates, alt)
		}
		sheet.Sections = append(sheet.Sections, sec)
	}
	return sheet
}

// changeSheet is change for a change to the Lyric Sheet or Scrapbook, as
// opposed to their Cues alone: the first one 10 minutes or more after the
// one before starts an editing session, so a Snapshot of the sheet as it
// was is taken first.
func (s *Store) changeSheet(ctx context.Context, songID int64, based songversion.Version, fn func(tx *sql.Tx) error) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if err := s.startEditing(ctx, tx, songID); err != nil {
			return err
		}
		return fn(tx)
	})
}

// startEditing takes a Snapshot of the sheet before a change to it, if the
// change starts an editing session, and notes when the sheet changed. None
// is taken of a sheet with no Sections, nor of one the same as the newest
// Snapshot's.
func (s *Store) startEditing(ctx context.Context, tx *sql.Tx, songID int64) error {
	now := s.now().UTC()
	var last sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT sheet_changed_at FROM songs WHERE id = ?`, songID).Scan(&last); err != nil {
		return fmt.Errorf("reading when the sheet last changed: %w", err)
	}
	starts := !last.Valid
	if last.Valid {
		at, err := domain.ParseTime(last.String)
		if err != nil {
			return err
		}
		starts = now.Sub(at) >= EditingSession
	}
	if starts {
		if err := s.snapshotIfChanged(ctx, tx, songID, now); err != nil {
			return err
		}
	}
	return markSheetChanged(ctx, tx, songID, now)
}

// markSheetChanged notes that a Song's sheet changed at now.
func markSheetChanged(ctx context.Context, tx *sql.Tx, songID int64, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `UPDATE songs SET sheet_changed_at = ? WHERE id = ?`,
		now.Format(domain.TimeFormat), songID); err != nil {
		return fmt.Errorf("noting the sheet changed: %w", err)
	}
	return nil
}

// snapshotIfChanged takes a Snapshot before an editing session, unless the
// sheet has no Sections or is the same as the newest Snapshot's.
func (s *Store) snapshotIfChanged(ctx context.Context, tx *sql.Tx, songID int64, now time.Time) error {
	sheet, err := loadLyricSheet(ctx, tx, songID)
	if err != nil {
		return err
	}
	if len(sheet.Sections) == 0 {
		return nil
	}
	encoded, err := json.Marshal(hold(sheet))
	if err != nil {
		return err
	}
	var newest []byte
	err = tx.QueryRowContext(ctx, `SELECT sheet FROM snapshots WHERE song_id = ? ORDER BY taken_at DESC, id DESC LIMIT 1`,
		songID).Scan(&newest)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("reading the newest snapshot: %w", err)
	}
	if bytes.Equal(newest, encoded) {
		return nil
	}
	return insertSnapshot(ctx, tx, songID, now, BeforeEditing, encoded)
}

// takeSnapshot takes a Snapshot of the sheet as it is, for reason.
func takeSnapshot(ctx context.Context, tx *sql.Tx, songID int64, now time.Time, reason SnapshotReason) error {
	sheet, err := loadLyricSheet(ctx, tx, songID)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(hold(sheet))
	if err != nil {
		return err
	}
	return insertSnapshot(ctx, tx, songID, now, reason, encoded)
}

func insertSnapshot(ctx context.Context, tx *sql.Tx, songID int64, now time.Time, reason SnapshotReason, sheet []byte) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO snapshots (song_id, taken_at, reason, sheet) VALUES (?, ?, ?, ?)`,
		songID, now.Format(domain.TimeFormat), reason, string(sheet)); err != nil {
		return fmt.Errorf("taking a snapshot: %w", err)
	}
	return nil
}

// ListSnapshots lists a Song's Snapshots, newest first, without their
// sheets.
func (s *Store) ListSnapshots(ctx context.Context, songID int64) ([]SnapshotSummary, error) {
	var exists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM songs WHERE id = ?)`, songID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("checking song: %w", err)
	}
	if !exists {
		return nil, domain.ErrNotFound
	}
	list := []SnapshotSummary{}
	err := query(ctx, s.db, `SELECT id, taken_at, reason FROM snapshots WHERE song_id = ? ORDER BY taken_at DESC, id DESC`,
		[]any{songID}, func(rows *sql.Rows) error {
			var sum SnapshotSummary
			var at string
			if err := rows.Scan(&sum.ID, &at, &sum.Reason); err != nil {
				return err
			}
			var err error
			sum.TakenAt, err = domain.ParseTime(at)
			list = append(list, sum)
			return err
		})
	if err != nil {
		return nil, fmt.Errorf("reading snapshots: %w", err)
	}
	return list, nil
}

// GetSnapshot returns one of a Song's Snapshots, with its sheet.
func (s *Store) GetSnapshot(ctx context.Context, songID, snapshotID int64) (Snapshot, error) {
	snap, held, err := findSnapshot(ctx, s.db, songID, snapshotID)
	if err != nil {
		return Snapshot{}, err
	}
	snap.Sheet = held.lyricSheet()
	return snap, nil
}

// findSnapshot reads one of a Song's Snapshots, with the sheet it holds.
func findSnapshot(ctx context.Context, q domain.Queryer, songID, snapshotID int64) (Snapshot, heldSheet, error) {
	var snap Snapshot
	var at, sheet string
	err := q.QueryRowContext(ctx, `SELECT id, taken_at, reason, sheet FROM snapshots WHERE id = ? AND song_id = ?`,
		snapshotID, songID).Scan(&snap.ID, &at, &snap.Reason, &sheet)
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, heldSheet{}, domain.ErrNotFound
	}
	if err != nil {
		return Snapshot{}, heldSheet{}, fmt.Errorf("reading snapshot: %w", err)
	}
	if snap.TakenAt, err = domain.ParseTime(at); err != nil {
		return Snapshot{}, heldSheet{}, err
	}
	var held heldSheet
	if err := json.Unmarshal([]byte(sheet), &held); err != nil {
		return Snapshot{}, heldSheet{}, fmt.Errorf("reading snapshot's sheet: %w", err)
	}
	return snap, held, nil
}

// RestoreSnapshot makes a Song's Lyric Sheet and Scrapbook the Snapshot's,
// in one change, having taken a Snapshot of them as they are first. Rows
// still there keep their ids, and a Line still there keeps its Cue as it is
// now; rows the restore brings back come back with their old ids, as ids
// are never reused, and a Line brought back gets the Cue it had; rows the
// Snapshot doesn't hold are deleted, Cues and all.
func (s *Store) RestoreSnapshot(ctx context.Context, songID int64, based songversion.Version, snapshotID int64) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		_, held, err := findSnapshot(ctx, tx, songID, snapshotID)
		if err != nil {
			return err
		}
		now := s.now().UTC()
		if err := takeSnapshot(ctx, tx, songID, now, BeforeRestoring); err != nil {
			return err
		}
		if err := restoreSheet(ctx, tx, songID, held); err != nil {
			return err
		}
		return markSheetChanged(ctx, tx, songID, now)
	})
}

// restoreSheet makes a Song's Lyric Sheet and Scrapbook those held.
func restoreSheet(ctx context.Context, tx *sql.Tx, songID int64, held heldSheet) error {
	current, err := loadLyricSheet(ctx, tx, songID)
	if err != nil {
		return err
	}
	sections, alternates, lines := map[int64]bool{}, map[int64]bool{}, map[int64]bool{}
	for _, sec := range current.Sections {
		sections[sec.ID] = true
		for _, alt := range sec.Alternates {
			alternates[alt.ID] = true
			for _, l := range alt.Lines {
				lines[l.ID] = true
			}
		}
	}
	// Out of the Arrangement and inactive for now, so nothing clashes as
	// rows move; each gets its place, and the active ones, at the end.
	if _, err := tx.ExecContext(ctx, `UPDATE sections SET position = NULL WHERE song_id = ?`, songID); err != nil {
		return fmt.Errorf("clearing the arrangement: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE alternates SET active = 0
		WHERE section_id IN (SELECT id FROM sections WHERE song_id = ?)`, songID); err != nil {
		return fmt.Errorf("clearing active alternates: %w", err)
	}
	// still reports whether a row is there now, taking it off the rows to
	// delete.
	still := func(there map[int64]bool, id int64) bool {
		ok := there[id]
		delete(there, id)
		return ok
	}
	for _, sec := range held.Sections {
		stmt := `INSERT INTO sections (label, song_id, id) VALUES (?, ?, ?)`
		if still(sections, sec.ID) {
			stmt = `UPDATE sections SET label = ? WHERE song_id = ? AND id = ?`
		}
		if _, err := tx.ExecContext(ctx, stmt, sec.Label, songID, sec.ID); err != nil {
			return fmt.Errorf("restoring section: %w", err)
		}
		for _, alt := range sec.Alternates {
			stmt := `INSERT INTO alternates (section_id, name, id) VALUES (?, ?, ?)`
			if still(alternates, alt.ID) {
				stmt = `UPDATE alternates SET section_id = ?, name = ? WHERE id = ?`
			}
			if _, err := tx.ExecContext(ctx, stmt, sec.ID, alt.Name, alt.ID); err != nil {
				return fmt.Errorf("restoring alternate: %w", err)
			}
			for pos, l := range alt.Lines {
				if still(lines, l.ID) {
					_, err = tx.ExecContext(ctx, `UPDATE lines SET alternate_id = ?, position = ?, text = ? WHERE id = ?`,
						alt.ID, pos, l.Text, l.ID)
				} else {
					_, err = tx.ExecContext(ctx, `INSERT INTO lines (alternate_id, position, text, cue_ms, id) VALUES (?, ?, ?, ?, ?)`,
						alt.ID, pos, l.Text, l.CueMs, l.ID)
				}
				if err != nil {
					return fmt.Errorf("restoring line: %w", err)
				}
			}
		}
	}
	// What's left isn't held: Lines first, then Alternates and Sections, so
	// a delete cascades only to rows going too.
	for _, gone := range []struct {
		table string
		ids   map[int64]bool
	}{{"lines", lines}, {"alternates", alternates}, {"sections", sections}} {
		for id := range gone.ids {
			if _, err := tx.ExecContext(ctx, `DELETE FROM `+gone.table+` WHERE id = ?`, id); err != nil {
				return fmt.Errorf("deleting from %s: %w", gone.table, err)
			}
		}
	}
	for _, sec := range held.Sections {
		for _, alt := range sec.Alternates {
			if !alt.Active {
				continue
			}
			if _, err := tx.ExecContext(ctx, `UPDATE alternates SET active = 1 WHERE id = ?`, alt.ID); err != nil {
				return fmt.Errorf("making alternate active: %w", err)
			}
		}
	}
	for pos, id := range held.Arrangement {
		if _, err := tx.ExecContext(ctx, `UPDATE sections SET position = ? WHERE id = ?`, pos, id); err != nil {
			return fmt.Errorf("restoring the arrangement: %w", err)
		}
	}
	for pos, id := range held.Scrapbook {
		if _, err := tx.ExecContext(ctx, `UPDATE sections SET scrapbook_position = ? WHERE id = ?`, pos+1, id); err != nil {
			return fmt.Errorf("restoring the scrapbook: %w", err)
		}
	}
	return nil
}
