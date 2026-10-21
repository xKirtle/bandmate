package song

import (
	"database/sql"
	"testing"
)

// cueSheet is a sheet to cue: a Verse with an active Alternate and a
// dormant one, a Chorus, and a Section in the Scrapbook that kept a Cue.
func cueSheet() (sheet LyricSheet, verse, chorus, spare Section) {
	verse = section(1,
		alternate(1, true, line(1, "Hello", cue(1)), line(2, "  ", nil), line(3, "world", nil)),
		alternate(2, false, line(4, "Old", cue(5))))
	chorus = section(2, alternate(3, true, line(5, "Sing", cue(10)), line(6, "loud", cue(12.5))))
	spare = section(3, alternate(4, true, line(7, "Idea", cue(20)), line(8, "more", nil)))
	return sheetOf(2, verse, chorus, spare), verse, chorus, spare
}

// msCue is a Cue in milliseconds, as an edit is given it.
func msCue(n int64) sql.NullInt64 { return sql.NullInt64{Int64: n, Valid: true} }

func TestSetLineCue(t *testing.T) {
	sheet, verse, chorus, spare := cueSheet()
	set := func(lineID, cueMs int64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return setLineCue(s, lineID, cueMs) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "a Line with none",
			edit: set(3, 2345),
			want: sheetOf(2, section(1,
				alternate(1, true, line(1, "Hello", cue(1)), line(2, "  ", nil), line(3, "world", cue(2.345))),
				verse.Alternates[1]), chorus, spare),
		},
		{
			name: "a Line with one",
			edit: set(5, 9000),
			want: sheetOf(2, verse, section(2, alternate(3, true, line(5, "Sing", cue(9)), line(6, "loud", cue(12.5)))),
				spare),
		},
		{
			// Its Cue lies dormant till its Alternate is active (ADR 0007).
			name: "a Line of an inactive Alternate",
			edit: set(4, 0),
			want: sheetOf(2, section(1, verse.Alternates[0], alternate(2, false, line(4, "Old", cue(0)))), chorus, spare),
		},
		{
			// It keeps the Cue it had, but isn't given a new one (ADR 0010).
			name:    "a Line in the Scrapbook",
			edit:    set(8, 1000),
			refusal: "a Line in the Scrapbook can't be given a Cue",
		},
		{name: "a blank Line", edit: set(2, 1000), refusal: "a blank Line can't have a Cue"},
		{name: "not the Song's", edit: set(9, 1000), refusal: "not found"},
	})
}

func TestClearLineCue(t *testing.T) {
	sheet, verse, chorus, spare := cueSheet()
	clearOf := func(lineID int64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return clearLineCue(s, lineID) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "a Line's",
			edit: clearOf(1),
			want: sheetOf(2, section(1,
				alternate(1, true, line(1, "Hello", nil), line(2, "  ", nil), line(3, "world", nil)),
				verse.Alternates[1]), chorus, spare),
		},
		{
			name: "a Line's in the Scrapbook",
			edit: clearOf(7),
			want: sheetOf(2, verse, chorus, section(3, alternate(4, true, line(7, "Idea", nil), line(8, "more", nil)))),
		},
		{name: "a Line with none", edit: clearOf(3), want: sheet},
		{name: "not the Song's", edit: clearOf(9), refusal: "not found"},
	})
}

func TestClearSectionCues(t *testing.T) {
	sheet, _, chorus, spare := cueSheet()
	clearOf := func(sectionID int64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return clearSectionCues(s, sectionID) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "every Line's, dormant ones included",
			edit: clearOf(1),
			want: sheetOf(2, section(1,
				alternate(1, true, line(1, "Hello", nil), line(2, "  ", nil), line(3, "world", nil)),
				alternate(2, false, line(4, "Old", nil))), chorus, spare),
		},
		{
			name: "in the Scrapbook",
			edit: clearOf(3),
			want: sheetOf(2, sheet.Sections[0], chorus,
				section(3, alternate(4, true, line(7, "Idea", nil), line(8, "more", nil)))),
		},
		{name: "not the Song's", edit: clearOf(9), refusal: "not found"},
	})
}

func TestClearCues(t *testing.T) {
	sheet, _, _, _ := cueSheet()
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "every one, dormant and in the Scrapbook included",
			edit: func(s LyricSheet) (LyricSheet, error) { return clearCues(s), nil },
			want: sheetOf(2,
				section(1, alternate(1, true, line(1, "Hello", nil), line(2, "  ", nil), line(3, "world", nil)),
					alternate(2, false, line(4, "Old", nil))),
				section(2, alternate(3, true, line(5, "Sing", nil), line(6, "loud", nil))),
				section(3, alternate(4, true, line(7, "Idea", nil), line(8, "more", nil)))),
		},
	})
}

func TestRestoreCues(t *testing.T) {
	sheet, verse, chorus, _ := cueSheet()
	restore := func(values ...lineCue) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return restoreCues(s, values) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "each to its value or none, the rest left alone",
			edit: restore(lineCue{lineID: 3, ms: msCue(3000)}, lineCue{lineID: 5}),
			want: sheetOf(2, section(1,
				alternate(1, true, line(1, "Hello", cue(1)), line(2, "  ", nil), line(3, "world", cue(3))),
				verse.Alternates[1]),
				section(2, alternate(3, true, line(5, "Sing", nil), line(6, "loud", cue(12.5)))),
				sheet.Sections[2]),
		},
		{
			// It puts back what another Cue edit changed (ADR 0010).
			name: "a Line in the Scrapbook given back its Cue",
			edit: restore(lineCue{lineID: 8, ms: msCue(21000)}),
			want: sheetOf(2, verse, chorus,
				section(3, alternate(4, true, line(7, "Idea", cue(20)), line(8, "more", cue(21))))),
		},
		{
			name: "the same Line twice, the last one standing",
			edit: restore(lineCue{lineID: 1, ms: msCue(4000)}, lineCue{lineID: 1}),
			want: sheetOf(2, section(1,
				alternate(1, true, line(1, "Hello", nil), line(2, "  ", nil), line(3, "world", nil)),
				verse.Alternates[1]), chorus, sheet.Sections[2]),
		},
		{name: "none", edit: restore(), want: sheet},
		{name: "a blank Line", edit: restore(lineCue{lineID: 2, ms: msCue(1000)}), refusal: "a blank Line can't have a Cue"},
		{name: "not the Song's", edit: restore(lineCue{lineID: 1}, lineCue{lineID: 9}), refusal: "not found"},
	})
}

func TestShiftCues(t *testing.T) {
	sheet, _, _, _ := cueSheet()
	shift := func(startMs, endMs int64, by float64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return shiftCues(s, startMs, endMs, by) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "those in the span, dormant and in the Scrapbook included, to the millisecond",
			edit: shift(5000, 20001, 1.2345),
			want: sheetOf(2,
				section(1, alternate(1, true, line(1, "Hello", cue(1)), line(2, "  ", nil), line(3, "world", nil)),
					alternate(2, false, line(4, "Old", cue(6.235)))),
				section(2, alternate(3, true, line(5, "Sing", cue(11.235)), line(6, "loud", cue(13.735)))),
				section(3, alternate(4, true, line(7, "Idea", cue(21.235)), line(8, "more", nil)))),
		},
		{
			name: "back, the span's end left out",
			edit: shift(1000, 10000, -1),
			want: sheetOf(2,
				section(1, alternate(1, true, line(1, "Hello", cue(0)), line(2, "  ", nil), line(3, "world", nil)),
					alternate(2, false, line(4, "Old", cue(4)))),
				sheet.Sections[1], sheet.Sections[2]),
		},
		{name: "none in the span", edit: shift(30000, 40000, -100), want: sheet},
		{
			name:    "to before the start of the Timeline",
			edit:    shift(0, 6000, -1.5),
			refusal: "a Cue can't be before the start of the Timeline",
		},
		{
			name:    "to past 24 hours",
			edit:    shift(0, 30000, maxCue),
			refusal: "a Cue can't be more than 24 hours into the Timeline",
		},
		{
			name:    "so far it would overflow",
			edit:    shift(0, 30000, 1e300),
			refusal: "a Cue can't be more than 24 hours into the Timeline",
		},
	})
}
