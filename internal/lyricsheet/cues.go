package lyricsheet

import (
	"context"
	"database/sql"
	"math"
	"slices"
	"strings"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// maxCue is the latest a Cue can be, in seconds: far past any Song, and
// well within what milliseconds can hold.
const maxCue = 24 * 60 * 60

// cueMillis turns a Cue in seconds into the milliseconds it's kept as.
func cueMillis(seconds float64) (int64, error) {
	switch {
	case math.IsNaN(seconds):
		return 0, domain.Invalid("a Cue must be a time in seconds")
	case seconds < 0:
		return 0, domain.Invalid("a Cue can't be before the start of the Timeline")
	case seconds > maxCue:
		return 0, domain.Invalid("a Cue can't be more than 24 hours into the Timeline")
	}
	return millis(seconds), nil
}

// SetLineCue gives a Line a Cue: the time, in seconds, where it's sung. The
// Line may be in any of its Section's Alternates, but can't be blank, and
// its Section must be in the Arrangement. A Section has no Cue of its own:
// it starts where its first Line is cued (ADR 0009).
func (s *Store) SetLineCue(ctx context.Context, songID int64, based songversion.Version, lineID int64, seconds float64) (Song, error) {
	ms, err := cueMillis(seconds)
	if err != nil {
		return Song{}, err
	}
	return s.changeCuesWith(ctx, songID, based, func(sheet LyricSheet) (LyricSheet, error) {
		return setLineCue(sheet, lineID, ms)
	})
}

// setLineCue is SetLineCue's change to the sheet, for a Cue of ms
// milliseconds.
func setLineCue(sheet LyricSheet, lineID, ms int64) (LyricSheet, error) {
	sec, _, err := sheetLine(sheet, lineID)
	if err != nil {
		return LyricSheet{}, err
	}
	// A Line in the Scrapbook keeps the Cue it had (ADR 0010), but isn't
	// given a new one there.
	if !slices.Contains(sheet.Arrangement, sec.ID) {
		return LyricSheet{}, domain.Conflict("a Line in the Scrapbook can't be given a Cue")
	}
	return restoreCues(sheet, []lineCue{{lineID: lineID, ms: sql.NullInt64{Int64: ms, Valid: true}}})
}

// ClearLineCue removes a Line's Cue.
func (s *Store) ClearLineCue(ctx context.Context, songID int64, based songversion.Version, lineID int64) (Song, error) {
	return s.changeCuesWith(ctx, songID, based, func(sheet LyricSheet) (LyricSheet, error) {
		return clearLineCue(sheet, lineID)
	})
}

// clearLineCue is ClearLineCue's change to the sheet.
func clearLineCue(sheet LyricSheet, lineID int64) (LyricSheet, error) {
	return restoreCues(sheet, []lineCue{{lineID: lineID}})
}

// ClearSectionCues removes the Cues of all a Section's Lines, dormant ones
// included.
func (s *Store) ClearSectionCues(ctx context.Context, songID int64, based songversion.Version, sectionID int64) (Song, error) {
	return s.changeCuesWith(ctx, songID, based, func(sheet LyricSheet) (LyricSheet, error) {
		return clearSectionCues(sheet, sectionID)
	})
}

// clearSectionCues is ClearSectionCues's change to the sheet.
func clearSectionCues(sheet LyricSheet, sectionID int64) (LyricSheet, error) {
	sec, err := sheetSection(sheet, sectionID)
	if err != nil {
		return LyricSheet{}, err
	}
	clearSection(sec)
	return sheet, nil
}

// clearSection removes the Cues of all a Section's Lines.
func clearSection(sec *Section) {
	for _, alt := range sec.Alternates {
		for i := range alt.Lines {
			alt.Lines[i].Cue = nil
		}
	}
}

// ClearCues removes every Cue in a Song, dormant ones included.
func (s *Store) ClearCues(ctx context.Context, songID int64, based songversion.Version) (Song, error) {
	return s.changeCuesWith(ctx, songID, based, func(sheet LyricSheet) (LyricSheet, error) {
		return clearCues(sheet), nil
	})
}

// clearCues is ClearCues's change to the sheet.
func clearCues(sheet LyricSheet) LyricSheet {
	for i := range sheet.Sections {
		clearSection(&sheet.Sections[i])
	}
	return sheet
}

// CueValue is one Cue to restore: a Line's. A nil Cue means none.
type CueValue struct {
	LineID int64
	Cue    *float64
}

// RestoreCues sets each Cue given to its value, in seconds, or clears it,
// and leaves every other Cue alone. It puts back what another Cue edit
// changed, e.g. to undo it, so a Line in the Scrapbook may be given back
// the Cue it kept there.
func (s *Store) RestoreCues(ctx context.Context, songID int64, based songversion.Version, values []CueValue) (Song, error) {
	cues := make([]lineCue, len(values))
	for i, v := range values {
		cues[i].lineID = v.LineID
		if v.Cue == nil {
			continue
		}
		ms, err := cueMillis(*v.Cue)
		if err != nil {
			return Song{}, err
		}
		cues[i].ms = sql.NullInt64{Int64: ms, Valid: true}
	}
	return s.changeCuesWith(ctx, songID, based, func(sheet LyricSheet) (LyricSheet, error) {
		return restoreCues(sheet, cues)
	})
}

// lineCue is a Cue to give a Line, in milliseconds, or, null, none.
type lineCue struct {
	lineID int64
	ms     sql.NullInt64
}

// restoreCues is RestoreCues's change to the sheet: each Cue is given in
// turn, wherever its Line is, so a Line given two has the last. To be given
// a Cue, a Line can't be blank.
func restoreCues(sheet LyricSheet, cues []lineCue) (LyricSheet, error) {
	for _, c := range cues {
		_, l, err := sheetLine(sheet, c.lineID)
		if err != nil {
			return LyricSheet{}, err
		}
		if c.ms.Valid && blank(l.Text) {
			return LyricSheet{}, domain.Invalid("a blank Line can't have a Cue")
		}
		l.Cue = cueOf(c.ms)
	}
	return sheet, nil
}

// ShiftCues moves every Cue in a Song that lies in [start, end), in
// seconds, by the seconds given, dormant ones included. It's how Cues
// follow a Clip that was moved. None may end up before the start of the
// Timeline, or the shift is refused.
func (s *Store) ShiftCues(ctx context.Context, songID int64, based songversion.Version, start, end, by float64) (Song, error) {
	if end <= start {
		return Song{}, domain.Invalid("the span must end after it starts")
	}
	startMs, endMs := millis(start), millis(end)
	return s.changeCuesWith(ctx, songID, based, func(sheet LyricSheet) (LyricSheet, error) {
		return shiftCues(sheet, startMs, endMs, by)
	})
}

// shiftCues is ShiftCues's change to the sheet, for the span [startMs,
// endMs) in milliseconds.
func shiftCues(sheet LyricSheet, startMs, endMs int64, by float64) (LyricSheet, error) {
	delta := millis(by)
	for _, sec := range sheet.Sections {
		for _, alt := range sec.Alternates {
			for i, l := range alt.Lines {
				if l.Cue == nil {
					continue
				}
				ms := millis(*l.Cue)
				if ms < startMs || ms >= endMs {
					continue
				}
				// Checked in seconds, as a shift far out of range overflows
				// milliseconds.
				if _, err := cueMillis(float64(ms)/1000 + by); err != nil {
					return LyricSheet{}, err
				}
				alt.Lines[i].Cue = cueOf(sql.NullInt64{Int64: ms + delta, Valid: true})
			}
		}
	}
	return sheet, nil
}

// changeCuesWith is change for a change to Cues alone, made by edit, a
// pure change to the whole sheet, which editSheet checks and writes. Unlike
// a change to the sheet itself, it starts no editing session, so takes no
// Snapshot.
func (s *Store) changeCuesWith(ctx context.Context, songID int64, based songversion.Version,
	edit func(sheet LyricSheet) (LyricSheet, error)) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return editSheet(ctx, tx, songID, func(sheet LyricSheet, _ *ids) (LyricSheet, error) {
			return edit(sheet)
		})
	})
}

// millis turns seconds into whole milliseconds, as Cues are kept, without
// checking they make a Cue.
func millis(seconds float64) int64 {
	return int64(math.Round(seconds * 1000))
}

// sheetLine is one of a sheet's Lines, by id, with the Section it's in, to
// read or change in place: domain.ErrNotFound if it isn't the sheet's.
func sheetLine(sheet LyricSheet, lineID int64) (*Section, *Line, error) {
	for i := range sheet.Sections {
		sec := &sheet.Sections[i]
		for _, alt := range sec.Alternates {
			for j := range alt.Lines {
				if alt.Lines[j].ID == lineID {
					return sec, &alt.Lines[j], nil
				}
			}
		}
	}
	return nil, nil, domain.ErrNotFound
}

// blank is whether a Line's text is empty or only spaces, so has nothing to
// cue.
func blank(text string) bool {
	return strings.TrimSpace(text) == ""
}
