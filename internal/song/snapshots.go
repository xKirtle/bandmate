package song

import (
	"bytes"
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
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
	// noReason is the reason an edit other than deleting or restoring
	// gives: whether it takes a Snapshot is worked out from the edit.
	noReason SnapshotReason = ""
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

// snapshotDecision is what a change to the Lyric Sheet and Scrapbook does
// about Snapshots, as decideSnapshot works it out.
type snapshotDecision struct {
	// take is whether to take a Snapshot of the sheet before the change,
	// for reason, naming what was deleted, if anything.
	take    bool
	reason  SnapshotReason
	deleted string
	// changed is whether the change marks when the sheet last changed,
	// which an editing session is timed from.
	changed bool
}

// sheetHistory is what decideSnapshot needs of a sheet's past.
type sheetHistory struct {
	// changedAt is when the sheet last changed, zero if never.
	changedAt time.Time
	// newest is the sheet the newest Snapshot holds, as stored; nil if
	// there's none.
	newest []byte
}

// decideSnapshot works out whether a change from before to after takes a
// Snapshot of before, and marks the sheet changed at now. reason is that
// given by the change, noReason for any but one before deleting or
// restoring:
//
//   - BeforeDeleting and BeforeRestoring always take one, standing in for
//     the editing session's, and mark the sheet changed. One before
//     deleting names the Section or Alternate that's gone.
//   - A change to Cues alone, before and after being the same but for
//     their Cues, nothing changing included, does neither.
//   - Any other change marks the sheet changed, and, if it starts an
//     editing session, EditingSession or more after the last change, takes
//     one BeforeEditing, unless before has no Sections or is the same as
//     the newest Snapshot's.
func decideSnapshot(before, after LyricSheet, history sheetHistory, reason SnapshotReason, now time.Time) snapshotDecision {
	switch {
	case reason == BeforeDeleting:
		return snapshotDecision{take: true, reason: reason, deleted: deletedName(before, after), changed: true}
	case reason != noReason:
		return snapshotDecision{take: true, reason: reason, changed: true}
	case sameWords(before, after):
		return snapshotDecision{}
	}
	starts := history.changedAt.IsZero() || now.Sub(history.changedAt) >= EditingSession
	take := starts && len(before.Sections) > 0 && !bytes.Equal(encodeHeld(toHeld(before)), history.newest)
	return snapshotDecision{take: take, reason: BeforeEditing, changed: true}
}

// sameWords reports whether two sheets are the same but for their Cues.
func sameWords(a, b LyricSheet) bool {
	return bytes.Equal(encodeHeld(withoutCues(toHeld(a))), encodeHeld(withoutCues(toHeld(b))))
}

// withoutCues is a held sheet with its Lines' Cues taken out, in place.
func withoutCues(held heldSheet) heldSheet {
	for _, sec := range held.Sections {
		for _, alt := range sec.Alternates {
			for i := range alt.Lines {
				alt.Lines[i].CueMs = nil
			}
		}
	}
	return held
}

// encodeHeld is a held sheet as a Snapshot stores it.
func encodeHeld(held heldSheet) []byte {
	// A held sheet is plain slices, strings and numbers, which always
	// encode.
	encoded, _ := json.Marshal(held)
	return encoded
}

// deletedName names what a change from before to after deleted, as the Song
// page names it: the Section that's gone, else the Alternate that's gone
// from a Section still there, by its place in the Section before. With
// neither gone, or more than one, it names nothing.
func deletedName(before, after LyricSheet) string {
	now := sheetIDs(after)
	var names []string
	for _, sec := range before.Sections {
		if !now["sections"][sec.ID] {
			names = append(names, sectionName(sec))
			continue
		}
		for i, alt := range sec.Alternates {
			if !now["alternates"][alt.ID] {
				names = append(names, alternateName(sec, i))
			}
		}
	}
	if len(names) != 1 {
		return ""
	}
	return names[0]
}

// readSheetHistory reads a Song's sheetHistory.
func readSheetHistory(ctx context.Context, tx *sql.Tx, songID int64) (sheetHistory, error) {
	var history sheetHistory
	var last sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT sheet_changed_at FROM songs WHERE id = ?`, songID).Scan(&last); err != nil {
		return sheetHistory{}, fmt.Errorf("reading when the sheet last changed: %w", err)
	}
	if last.Valid {
		var err error
		if history.changedAt, err = domain.ParseTime(last.String); err != nil {
			return sheetHistory{}, err
		}
	}
	err := tx.QueryRowContext(ctx, `SELECT sheet FROM snapshots WHERE song_id = ? ORDER BY taken_at DESC, id DESC LIMIT 1`,
		songID).Scan(&history.newest)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return sheetHistory{}, fmt.Errorf("reading the newest snapshot: %w", err)
	}
	return history, nil
}

// markSheetChanged notes that a Song's sheet changed at now.
func markSheetChanged(ctx context.Context, tx *sql.Tx, songID int64, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `UPDATE songs SET sheet_changed_at = ? WHERE id = ?`,
		now.Format(domain.TimeFormat), songID); err != nil {
		return fmt.Errorf("noting the sheet changed: %w", err)
	}
	return nil
}

// insertSnapshot keeps sheet as a Snapshot taken at now, on the date it is
// in the time zone of the change taking it, for reason, naming what was
// deleted, if anything, then thins the Song's Snapshots.
func insertSnapshot(ctx context.Context, tx *sql.Tx, songID int64, now time.Time, reason SnapshotReason, deleted string,
	sheet LyricSheet) error {
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO snapshots (song_id, taken_at, taken_on, reason, deleted, sheet) VALUES (?, ?, ?, ?, NULLIF(?, ''), ?)`,
		songID, now.Format(domain.TimeFormat), now.In(domain.Zone(ctx)).Format(time.DateOnly), reason, deleted,
		string(encodeHeld(toHeld(sheet)))); err != nil {
		return fmt.Errorf("taking a snapshot: %w", err)
	}
	taken, err := readTaken(ctx, tx, songID)
	if err != nil {
		return err
	}
	for _, id := range thinSnapshots(taken, now) {
		if _, err := tx.ExecContext(ctx, `DELETE FROM snapshots WHERE id = ?`, id); err != nil {
			return fmt.Errorf("thinning snapshots: %w", err)
		}
	}
	return nil
}

// takenSnapshot is a Snapshot as thinning reads it.
type takenSnapshot struct {
	id      int64
	takenAt time.Time
	// takenOn is the date it was taken on, where the change that took it
	// was made (ADR 0021).
	takenOn time.Time
	kept    bool
}

// readTaken reads a Song's Snapshots as thinning reads them.
func readTaken(ctx context.Context, tx *sql.Tx, songID int64) ([]takenSnapshot, error) {
	var taken []takenSnapshot
	err := query(ctx, tx, `SELECT id, taken_at, taken_on, kept FROM snapshots WHERE song_id = ?`,
		[]any{songID}, func(rows *sql.Rows) error {
			var t takenSnapshot
			var at, on string
			if err := rows.Scan(&t.id, &at, &on, &t.kept); err != nil {
				return err
			}
			var err error
			if t.takenAt, err = domain.ParseTime(at); err != nil {
				return err
			}
			if t.takenOn, err = time.Parse(time.DateOnly, on); err != nil {
				return fmt.Errorf("parsing the date snapshot %d was taken on: %w", t.id, err)
			}
			taken = append(taken, t)
			return nil
		})
	if err != nil {
		return nil, fmt.Errorf("reading snapshots to thin: %w", err)
	}
	return taken, nil
}

// thinSnapshots is the ids of the Snapshots to delete at now: those not
// kept that aren't the newest of their day or week, as KeepAllFor and
// KeepDailyFor say.
func thinSnapshots(taken []takenSnapshot, now time.Time) []int64 {
	newestFirst := slices.Clone(taken)
	slices.SortFunc(newestFirst, func(a, b takenSnapshot) int {
		return cmp.Or(b.takenAt.Compare(a.takenAt), cmp.Compare(b.id, a.id))
	})
	var thinned []int64
	newest := map[thinSpan]bool{}
	for _, t := range newestFirst {
		var span thinSpan
		switch age := now.Sub(t.takenAt); {
		case t.kept, age < KeepAllFor:
			continue
		case age < KeepDailyFor:
			span = thinSpan{year: t.takenOn.Year(), n: t.takenOn.YearDay()}
		default:
			year, week := t.takenOn.ISOWeek()
			span = thinSpan{weekly: true, year: year, n: week}
		}
		if newest[span] {
			thinned = append(thinned, t.id)
		}
		newest[span] = true
	}
	return thinned
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
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		_, held, err := findSnapshot(ctx, tx, songID, snapshotID)
		if err != nil {
			return err
		}
		return s.editSheetIn(ctx, tx, songID, BeforeRestoring, func(current LyricSheet, _ *ids) (LyricSheet, error) {
			return keepCurrentCues(current, held.lyricSheet()), nil
		})
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
// else by its place among its Section's, e.g. "Alternate 2". i is its
// index in sec's Alternates.
func alternateName(sec Section, i int) string {
	if name := sec.Alternates[i].Name; name != "" {
		return name
	}
	return fmt.Sprintf("Alternate %d", i+1)
}
