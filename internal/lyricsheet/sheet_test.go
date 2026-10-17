package lyricsheet

import (
	"reflect"
	"testing"
)

// idsFrom11 is ids handing out each table's ids from 11 on, past those of
// the sheets these tests start from.
func idsFrom11() *ids {
	return &ids{last: map[string]int64{"sections": 10, "alternates": 10, "lines": 10}}
}

// at is a position in the Arrangement.
func at(position int) *int { return &position }

// labelled is a Section with a Label.
func labelled(label string, sec Section) Section {
	sec.Label = label
	return sec
}

// sheetEdit is one case of a pure change to the sheet: the sheet it leaves,
// or the refusal it gives.
type sheetEdit struct {
	name string
	edit func(sheet LyricSheet) (LyricSheet, error)
	want LyricSheet
	// refusal is the change's error, "" for none.
	refusal string
}

// runSheetEdits runs each case on a copy of sheet, checking what it leaves
// passes checkChange.
func runSheetEdits(t *testing.T, sheet LyricSheet, tests []sheetEdit) {
	t.Helper()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.edit(cloneSheet(sheet))
			if tt.refusal != "" {
				if err == nil || err.Error() != tt.refusal {
					t.Fatalf("error = %v, want %q", err, tt.refusal)
				}
				return
			}
			if err != nil {
				t.Fatalf("error = %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("left\n%+v\nwant\n%+v", got, tt.want)
			}
			if err := checkChange(sheet, got); err != nil {
				t.Errorf("checkChange = %v", err)
			}
		})
	}
}

func TestAddSection(t *testing.T) {
	verse := section(1, alternate(1, true, line(1, "Hello", cue(2))))
	chorus := section(2, alternate(2, true, line(2, "Sing", nil)))
	spare := section(3, alternate(3, true))
	sheet := sheetOf(2, verse, chorus, spare)
	added := Section{ID: 11, Label: "Bridge", Alternates: []Alternate{{ID: 11, Active: true, Lines: []Line{}}}}
	place := func(arrangement ...int64) LyricSheet {
		return LyricSheet{Arrangement: arrangement, Scrapbook: []int64{3},
			Sections: []Section{verse, chorus, spare, added}}
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "at the end",
			edit: func(s LyricSheet) (LyricSheet, error) { return addSection(s, idsFrom11(), " Bridge ", nil) },
			want: place(1, 2, 11),
		},
		{
			name: "first",
			edit: func(s LyricSheet) (LyricSheet, error) { return addSection(s, idsFrom11(), "Bridge", at(0)) },
			want: place(11, 1, 2),
		},
		{
			name: "between",
			edit: func(s LyricSheet) (LyricSheet, error) { return addSection(s, idsFrom11(), "Bridge", at(1)) },
			want: place(1, 11, 2),
		},
		{
			name:    "past the end",
			edit:    func(s LyricSheet) (LyricSheet, error) { return addSection(s, idsFrom11(), "Bridge", at(3)) },
			refusal: "position must be between 0 and 2",
		},
		{
			name:    "before the start",
			edit:    func(s LyricSheet) (LyricSheet, error) { return addSection(s, idsFrom11(), "Bridge", at(-1)) },
			refusal: "position must be between 0 and 2",
		},
	})
}

func TestAddToScrapbook(t *testing.T) {
	verse := section(1, alternate(1, true, line(1, "Hello", nil)))
	spare := section(2, alternate(2, true))
	added := Section{ID: 11, Alternates: []Alternate{{ID: 11, Active: true, Lines: []Line{}}}}
	runSheetEdits(t, sheetOf(1, verse, spare), []sheetEdit{
		{
			name: "at the end of the Scrapbook",
			edit: func(s LyricSheet) (LyricSheet, error) { return addToScrapbook(s, idsFrom11(), "  ") },
			want: LyricSheet{Arrangement: []int64{1}, Scrapbook: []int64{2, 11},
				Sections: []Section{verse, spare, added}},
		},
	})
}

func TestAddToArrangement(t *testing.T) {
	verse := section(1, alternate(1, true, line(1, "Hello", nil)))
	chorus := section(2, alternate(2, true, line(2, "Sing", nil)))
	bridge := section(3, alternate(3, true, line(3, "Over", cue(4))))
	outro := section(4, alternate(4, true, line(4, "Bye", nil)))
	sheet := sheetOf(2, verse, chorus, bridge, outro)
	add := func(sectionID int64, position *int) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return addToArrangement(s, sectionID, position) }
	}
	placed := func(arrangement []int64, scrapbook ...int64) LyricSheet {
		return LyricSheet{Arrangement: arrangement, Scrapbook: scrapbook, Sections: sheet.Sections}
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{name: "at the end", edit: add(3, nil), want: placed([]int64{1, 2, 3}, 4)},
		{name: "first", edit: add(4, at(0)), want: placed([]int64{4, 1, 2}, 3)},
		{name: "between", edit: add(3, at(1)), want: placed([]int64{1, 3, 2}, 4)},
		{
			name:    "one already in the Arrangement",
			edit:    add(2, nil),
			refusal: "that Section is already in the Lyric Sheet; Duplicate it instead",
		},
		{name: "past the end", edit: add(3, at(3)), refusal: "position must be between 0 and 2"},
		{name: "not the Song's", edit: add(9, nil), refusal: "not found"},
	})
}

func TestDuplicateSection(t *testing.T) {
	verse := labelled("Verse", section(1,
		alternate(1, false, line(1, "Hel[Am]lo", cue(1)), line(2, "world", nil)),
		Alternate{ID: 2, Name: "Darker", Active: true, Lines: []Line{line(3, "Good[Em]bye", cue(3))}}))
	chorus := section(2, alternate(3, true, line(4, "Sing", nil)))
	spare := section(3, alternate(4, true, line(5, "Spare", cue(9))))
	sheet := sheetOf(2, verse, chorus, spare)
	// The copy has the Label and every Alternate, with its name and Lines,
	// the same one active, but no Cues.
	duplicate := labelled("Verse", section(11,
		alternate(11, false, line(11, "Hel[Am]lo", nil), line(12, "world", nil)),
		Alternate{ID: 12, Name: "Darker", Active: true, Lines: []Line{line(13, "Good[Em]bye", nil)}}))
	duplicateSpare := section(11, alternate(11, true, line(11, "Spare", nil)))
	dup := func(sectionID int64, position *int) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return duplicateSection(s, idsFrom11(), sectionID, position) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "after it, from the Arrangement",
			edit: dup(1, at(1)),
			want: LyricSheet{Arrangement: []int64{1, 11, 2}, Scrapbook: []int64{3},
				Sections: []Section{verse, chorus, spare, duplicate}},
		},
		{
			name: "at the end, from the Scrapbook",
			edit: dup(3, nil),
			want: LyricSheet{Arrangement: []int64{1, 2, 11}, Scrapbook: []int64{3},
				Sections: []Section{verse, chorus, spare, duplicateSpare}},
		},
		{name: "past the end", edit: dup(1, at(3)), refusal: "position must be between 0 and 2"},
		{name: "not the Song's", edit: dup(9, nil), refusal: "not found"},
	})
}

func TestRemoveFromArrangement(t *testing.T) {
	// Written in only in an inactive Alternate, with a dormant Cue.
	verse := section(1, alternate(1, true, line(1, " ", nil)), alternate(2, false, line(2, "Hello", cue(5))))
	blankChorus := section(2, alternate(3, true, line(3, "", nil), line(4, "  ", nil)), alternate(4, false))
	bridge := section(3, alternate(5, true, line(5, "Over", cue(9))))
	spare := section(4, alternate(6, true))
	sheet := sheetOf(3, verse, blankChorus, bridge, spare)
	remove := func(sectionID int64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return removeFromArrangement(s, sectionID) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "to the end of the Scrapbook, with its Cues",
			edit: remove(3),
			want: LyricSheet{Arrangement: []int64{1, 2}, Scrapbook: []int64{4, 3}, Sections: sheet.Sections},
		},
		{
			name: "written in only in an inactive Alternate",
			edit: remove(1),
			want: LyricSheet{Arrangement: []int64{2, 3}, Scrapbook: []int64{4, 1}, Sections: sheet.Sections},
		},
		{
			name: "deleted, as nothing is written in it",
			edit: remove(2),
			want: LyricSheet{Arrangement: []int64{1, 3}, Scrapbook: []int64{4},
				Sections: []Section{verse, bridge, spare}},
		},
		{name: "one in the Scrapbook", edit: remove(4), refusal: "that Section isn't in the Lyric Sheet"},
		{name: "not the Song's", edit: remove(9), refusal: "not found"},
	})
}

func TestDeleteSection(t *testing.T) {
	verse := section(1, alternate(1, true, line(1, "Hello", cue(1))))
	spare := section(2, alternate(2, true, line(2, "Spare", cue(5))), alternate(3, false, line(3, "Other", nil)))
	idea := section(3, alternate(4, true))
	sheet := sheetOf(1, verse, spare, idea)
	del := func(sectionID int64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return deleteSection(s, sectionID) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "from the Scrapbook, with its Alternates and Lines",
			edit: del(2),
			want: LyricSheet{Arrangement: []int64{1}, Scrapbook: []int64{3}, Sections: []Section{verse, idea}},
		},
		{
			name:    "one in the Arrangement",
			edit:    del(1),
			refusal: "only a Section in the Scrapbook can be deleted; remove it from the Arrangement first",
		},
		{name: "not the Song's", edit: del(9), refusal: "not found"},
	})
}

func TestReorderArrangement(t *testing.T) {
	verse := section(1, alternate(1, true, line(1, "Hello", nil)))
	chorus := section(2, alternate(2, true, line(2, "Sing", nil)))
	bridge := section(3, alternate(3, true, line(3, "Over", nil)))
	spare := section(4, alternate(4, true))
	sheet := sheetOf(3, verse, chorus, bridge, spare)
	reorder := func(order ...int64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return reorderArrangement(s, order) }
	}
	const wantEvery = "the new order must list every Section in the Lyric Sheet exactly once"
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "in a new order",
			edit: reorder(3, 1, 2),
			want: LyricSheet{Arrangement: []int64{3, 1, 2}, Scrapbook: []int64{4}, Sections: sheet.Sections},
		},
		{name: "one left out", edit: reorder(3, 1), refusal: wantEvery},
		{name: "one listed twice", edit: reorder(3, 1, 1), refusal: wantEvery},
		{name: "one from the Scrapbook", edit: reorder(3, 1, 4), refusal: wantEvery},
		{name: "one not the Song's", edit: reorder(3, 1, 2, 9), refusal: wantEvery},
	})
}

func TestSetSectionLabel(t *testing.T) {
	verse := labelled("Verse", section(1, alternate(1, true, line(1, "Hello", cue(1)))))
	spare := section(2, alternate(2, true))
	sheet := sheetOf(1, verse, spare)
	label := func(sectionID int64, label string) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return setSectionLabel(s, sectionID, label) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "trimmed",
			edit: label(2, " Bridge "),
			want: sheetOf(1, verse, labelled("Bridge", spare)),
		},
		{
			name: "removed, when blank",
			edit: label(1, "  "),
			want: sheetOf(1, labelled("", verse), spare),
		},
		{name: "not the Song's", edit: label(9, "Bridge"), refusal: "not found"},
	})
}
