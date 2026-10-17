package lyricsheet

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// EditingSession is how long the Lyric Sheet and Scrapbook go without a
// change before the next change starts an editing session, which takes a
// Snapshot first.
const EditingSession = 10 * time.Minute

// Snapshots are thinned as they age, each time one is taken: every one
// younger than KeepAllFor stays, then the newest of each day while younger
// than KeepDailyFor, then the newest of each week. A day is the date the
// Snapshot was taken on where the change that took it was made (ADR 0021),
// and a week that date's ISO week, Monday to Sunday, so which one is the
// newest of its day or week never changes as they age. A kept Snapshot is
// never thinned. The Snapshots dialog groups them by the same ages.
const (
	KeepAllFor   = 24 * time.Hour
	KeepDailyFor = KeepAllFor + 30*24*time.Hour
)

// thinSpan is a day or a week of which only the newest Snapshot is kept.
type thinSpan struct {
	weekly bool
	// year and n are the day's year and day of the year, or the ISO week's
	// year and number.
	year, n int
}

// SnapshotReason says why a Snapshot was taken.
type SnapshotReason string

const (
	// BeforeEditing is a Snapshot taken before an editing session.
	BeforeEditing SnapshotReason = "editing"
	// BeforeDeleting is a Snapshot taken just before deleting a Scrapbook
	// Section or an Alternate, which it names.
	BeforeDeleting SnapshotReason = "deleting"
	// BeforeRestoring is a Snapshot taken before a restore.
	BeforeRestoring SnapshotReason = "restoring"
)

// SnapshotSummary is a Snapshot as listed: when it was taken, and why.
type SnapshotSummary struct {
	ID      int64          `json:"id"`
	TakenAt time.Time      `json:"takenAt"`
	Reason  SnapshotReason `json:"reason"`
	// Deleted names the Section or Alternate deleted just after a Snapshot
	// taken BeforeDeleting, as the Song page names it.
	Deleted string `json:"deleted,omitempty"`
	// Kept is true for one the user Kept, which is never thinned.
	Kept bool `json:"kept"`
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

// toHeld is the part of a Lyric Sheet a Snapshot keeps.
func toHeld(sheet LyricSheet) heldSheet {
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

// RemapSnapshotSheet changes each id in a Snapshot's sheet, as stored, to
// newID(table, id), table being the one holding such rows: "sections",
// "alternates" or "lines". A Restore of a Backup uses it, as the rows it
// restores get fresh ids.
func RemapSnapshotSheet(sheet string, newID func(table string, old int64) (int64, error)) (string, error) {
	var held heldSheet
	if err := json.Unmarshal([]byte(sheet), &held); err != nil {
		return "", fmt.Errorf("reading snapshot's sheet: %w", err)
	}
	remap := func(table string, id *int64) error {
		n, err := newID(table, *id)
		*id = n
		return err
	}
	for _, order := range [][]int64{held.Arrangement, held.Scrapbook} {
		for i := range order {
			if err := remap("sections", &order[i]); err != nil {
				return "", err
			}
		}
	}
	for i := range held.Sections {
		sec := &held.Sections[i]
		if err := remap("sections", &sec.ID); err != nil {
			return "", err
		}
		for j := range sec.Alternates {
			alt := &sec.Alternates[j]
			if err := remap("alternates", &alt.ID); err != nil {
				return "", err
			}
			for k := range alt.Lines {
				if err := remap("lines", &alt.Lines[k].ID); err != nil {
					return "", err
				}
			}
		}
	}
	encoded, err := json.Marshal(held)
	return string(encoded), err
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
	encoded, sections, err := encodeSheet(ctx, tx, songID)
	if err != nil || sections == 0 {
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
	return insertSnapshot(ctx, tx, songID, now, BeforeEditing, "", encoded)
}

// changeBefore is change for a change to the Lyric Sheet or Scrapbook
// that always takes a Snapshot of the sheet first, for reason: before
// deleting something, or before a restore. check checks the change can be
// made and names what it deletes, if anything, then do makes it. The
// Snapshot stands in for one an editing session would take, as it holds
// the same sheet.
func (s *Store) changeBefore(ctx context.Context, songID int64, based songversion.Version, reason SnapshotReason,
	check func(tx *sql.Tx) (deleted string, do func() error, err error)) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		deleted, do, err := check(tx)
		if err != nil {
			return err
		}
		encoded, _, err := encodeSheet(ctx, tx, songID)
		if err != nil {
			return err
		}
		now := s.now().UTC()
		if err := insertSnapshot(ctx, tx, songID, now, reason, deleted, encoded); err != nil {
			return err
		}
		if err := do(); err != nil {
			return err
		}
		return markSheetChanged(ctx, tx, songID, now)
	})
}

// encodeSheet reads a Song's sheet as a Snapshot stores it, and how many
// Sections it has.
func encodeSheet(ctx context.Context, tx *sql.Tx, songID int64) (encoded []byte, sections int, err error) {
	sheet, err := loadLyricSheet(ctx, tx, songID)
	if err != nil {
		return nil, 0, err
	}
	encoded, err = json.Marshal(toHeld(sheet))
	return encoded, len(sheet.Sections), err
}

// insertSnapshot keeps sheet as a Snapshot taken at now, on the date it is
// in the time zone of the change taking it, for reason, naming what was
// deleted, if anything, then thins the Song's Snapshots.
func insertSnapshot(ctx context.Context, tx *sql.Tx, songID int64, now time.Time, reason SnapshotReason, deleted string,
	sheet []byte) error {
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO snapshots (song_id, taken_at, taken_on, reason, deleted, sheet) VALUES (?, ?, ?, ?, NULLIF(?, ''), ?)`,
		songID, now.Format(domain.TimeFormat), now.In(domain.Zone(ctx)).Format(time.DateOnly), reason, deleted, string(sheet)); err != nil {
		return fmt.Errorf("taking a snapshot: %w", err)
	}
	return thinSnapshots(ctx, tx, songID, now)
}

// thinSnapshots deletes the Song's Snapshots not kept that aren't the
// newest of their day or week, as KeepAllFor and KeepDailyFor say.
func thinSnapshots(ctx context.Context, tx *sql.Tx, songID int64, now time.Time) error {
	var thinned []int64
	newest := map[thinSpan]bool{}
	err := query(ctx, tx, `SELECT id, taken_at, taken_on FROM snapshots WHERE song_id = ? AND NOT kept
		ORDER BY taken_at DESC, id DESC`,
		[]any{songID}, func(rows *sql.Rows) error {
			var id int64
			var at, on string
			if err := rows.Scan(&id, &at, &on); err != nil {
				return err
			}
			taken, err := domain.ParseTime(at)
			if err != nil {
				return err
			}
			day, err := time.Parse(time.DateOnly, on)
			if err != nil {
				return fmt.Errorf("parsing the date snapshot %d was taken on: %w", id, err)
			}
			var span thinSpan
			switch age := now.Sub(taken); {
			case age < KeepAllFor:
				return nil
			case age < KeepDailyFor:
				span = thinSpan{year: day.Year(), n: day.YearDay()}
			default:
				year, week := day.ISOWeek()
				span = thinSpan{weekly: true, year: year, n: week}
			}
			if newest[span] {
				thinned = append(thinned, id)
			}
			newest[span] = true
			return nil
		})
	if err != nil {
		return fmt.Errorf("reading snapshots to thin: %w", err)
	}
	for _, id := range thinned {
		if _, err := tx.ExecContext(ctx, `DELETE FROM snapshots WHERE id = ?`, id); err != nil {
			return fmt.Errorf("thinning snapshots: %w", err)
		}
	}
	return nil
}

// KeepSnapshot keeps one of a Song's Snapshots, so it's never thinned, or
// un-keeps it, so it's thinned like the rest the next time one is taken.
// It changes nothing of the Song, so isn't based on its version.
func (s *Store) KeepSnapshot(ctx context.Context, songID, snapshotID int64, kept bool) (SnapshotSummary, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE snapshots SET kept = ? WHERE id = ? AND song_id = ?`, kept, snapshotID, songID)
	if err != nil {
		return SnapshotSummary{}, fmt.Errorf("keeping snapshot: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return SnapshotSummary{}, fmt.Errorf("keeping snapshot: %w", err)
	}
	if n == 0 {
		return SnapshotSummary{}, domain.ErrNotFound
	}
	snap, _, err := findSnapshot(ctx, s.db, songID, snapshotID)
	return snap.SnapshotSummary, err
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
	err := query(ctx, s.db, `SELECT id, taken_at, reason, COALESCE(deleted, ''), kept FROM snapshots
		WHERE song_id = ? ORDER BY taken_at DESC, id DESC`,
		[]any{songID}, func(rows *sql.Rows) error {
			var sum SnapshotSummary
			var at string
			if err := rows.Scan(&sum.ID, &at, &sum.Reason, &sum.Deleted, &sum.Kept); err != nil {
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
	err := q.QueryRowContext(ctx, `SELECT id, taken_at, reason, COALESCE(deleted, ''), kept, sheet FROM snapshots
		WHERE id = ? AND song_id = ?`,
		snapshotID, songID).Scan(&snap.ID, &at, &snap.Reason, &snap.Deleted, &snap.Kept, &sheet)
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
	return s.changeBefore(ctx, songID, based, BeforeRestoring, func(tx *sql.Tx) (string, func() error, error) {
		_, held, err := findSnapshot(ctx, tx, songID, snapshotID)
		if err != nil {
			return "", nil, err
		}
		return "", func() error {
			return editSheet(ctx, tx, songID, func(current LyricSheet, _ *ids) (LyricSheet, error) {
				return keepCurrentCues(current, held.lyricSheet()), nil
			})
		}, nil
	})
}

// sectionName names a Section as the Song page lists it: by its Label, else
// its active Alternate's first Line with words. One with neither has no
// name.
func sectionName(sec Section) string {
	if sec.Label != "" {
		return sec.Label
	}
	for _, alt := range sec.Alternates {
		if !alt.Active {
			continue
		}
		for _, l := range alt.Lines {
			if lyrics := strings.TrimSpace(l.Lyrics); lyrics != "" {
				return lyrics
			}
		}
	}
	return ""
}

// alternateName names an Alternate as the Song page does: by its name,
// else by its place among its Section's, e.g. "Alternate 2".
func alternateName(ctx context.Context, tx *sql.Tx, sectionID, alternateID int64) (string, error) {
	var name string
	var place int
	err := tx.QueryRowContext(ctx, `SELECT name,
		(SELECT COUNT(*) FROM alternates b WHERE b.section_id = ? AND b.id <= a.id)
		FROM alternates a WHERE a.id = ?`, sectionID, alternateID).Scan(&name, &place)
	if err != nil {
		return "", fmt.Errorf("reading alternate: %w", err)
	}
	if name != "" {
		return name, nil
	}
	return fmt.Sprintf("Alternate %d", place), nil
}
