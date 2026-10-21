package song

import (
	"testing"
)

// named is an Alternate with a name.
func named(name string, alt Alternate) Alternate {
	alt.Name = name
	return alt
}

func TestAddAlternate(t *testing.T) {
	verse := labelled("Verse", section(1,
		alternate(1, false, line(1, "Old", cue(1))),
		alternate(2, true, line(2, "Hel[Am]lo", cue(2)), line(3, "world", nil))))
	spare := section(2, alternate(3, true))
	sheet := sheetOf(1, verse, spare)
	add := func(sectionID int64, name string) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return addAlternate(s, idsFrom11(), sectionID, name) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			// The one it copied keeps its own Cues, dormant (ADR 0007).
			name: "an active copy of the active one, with its Cues",
			edit: add(1, " Darker "),
			want: sheetOf(1, labelled("Verse", section(1,
				alternate(1, false, line(1, "Old", cue(1))),
				alternate(2, false, line(2, "Hel[Am]lo", cue(2)), line(3, "world", nil)),
				named("Darker", alternate(11, true, line(11, "Hel[Am]lo", cue(2)), line(12, "world", nil))))), spare),
		},
		{
			name: "of a Section in the Scrapbook, with no Lines",
			edit: add(2, ""),
			want: sheetOf(1, verse, section(2, alternate(3, false), Alternate{ID: 11, Active: true, Lines: []Line{}})),
		},
		{name: "not the Song's", edit: add(9, "Darker"), refusal: "not found"},
	})
}

func TestRenameAlternate(t *testing.T) {
	verse := section(1, named("Old", alternate(1, true, line(1, "Hello", cue(1)))), alternate(2, false))
	sheet := sheetOf(1, verse)
	rename := func(alternateID int64, name string) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return renameAlternate(s, alternateID, name) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "trimmed",
			edit: rename(2, " Darker "),
			want: sheetOf(1, section(1, verse.Alternates[0], named("Darker", alternate(2, false)))),
		},
		{
			name: "unnamed, when blank",
			edit: rename(1, "  "),
			want: sheetOf(1, section(1, alternate(1, true, line(1, "Hello", cue(1))), alternate(2, false))),
		},
		{name: "not the Song's", edit: rename(9, "Darker"), refusal: "not found"},
	})
}

func TestActivateAlternate(t *testing.T) {
	// Each Alternate keeps its Cues: the inactive one's lie dormant (ADR 0007).
	verse := section(1, alternate(1, true, line(1, "Hello", cue(1))), alternate(2, false, line(2, "Bye", cue(5))))
	spare := section(2, alternate(3, true), alternate(4, false))
	sheet := sheetOf(1, verse, spare)
	activate := func(alternateID int64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return activateAlternate(s, alternateID) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "the only active one, the other's Cues dormant",
			edit: activate(2),
			want: sheetOf(1, section(1, alternate(1, false, line(1, "Hello", cue(1))),
				alternate(2, true, line(2, "Bye", cue(5)))), spare),
		},
		{
			name: "in the Scrapbook",
			edit: activate(4),
			want: sheetOf(1, verse, section(2, alternate(3, false), alternate(4, true))),
		},
		{name: "the active one already", edit: activate(1), want: sheet},
		{name: "not the Song's", edit: activate(9), refusal: "not found"},
	})
}

func TestDeleteAlternate(t *testing.T) {
	verse := section(1, alternate(1, true, line(1, "Hello", cue(1))), alternate(2, false, line(2, "Bye", cue(5))))
	spare := section(2, alternate(3, true, line(3, "Spare", nil)))
	sheet := sheetOf(1, verse, spare)
	del := func(alternateID int64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return deleteAlternate(s, alternateID) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "an inactive one, with its Lines",
			edit: del(2),
			want: sheetOf(1, section(1, verse.Alternates[0]), spare),
		},
		{
			name:    "the active one",
			edit:    del(1),
			refusal: "the active Alternate can't be deleted; activate another one first",
		},
		{name: "a Section's last one", edit: del(3), refusal: "a Section's last Alternate can't be deleted"},
		{name: "not the Song's", edit: del(9), refusal: "not found"},
	})
}

// moveOutSheet is a sheet to move Alternates out of: a Verse with a
// Darker one and an unnamed one, an unlabelled Chorus with a Softer one,
// and an unlabelled Section with an unnamed one in the Scrapbook.
func moveOutSheet() (sheet LyricSheet, verse, chorus, spare Section) {
	verse = labelled("Verse", section(1,
		alternate(1, true, line(1, "Hello", cue(1))),
		named("Darker", alternate(2, false, line(2, "Hel[Am]lo", cue(2)), line(3, "dark", nil))),
		alternate(3, false, line(4, "Other", nil))))
	chorus = section(2, alternate(4, true, line(5, "Sing", nil)), named("Softer", alternate(5, false)))
	spare = section(3, alternate(6, true), alternate(7, false, line(6, "Idea", cue(9))))
	return sheetOf(2, verse, chorus, spare), verse, chorus, spare
}

func TestMoveAlternateToScrapbook(t *testing.T) {
	sheet, verse, chorus, spare := moveOutSheet()
	move := func(alternateID int64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return moveAlternateToScrapbook(s, idsFrom11(), alternateID) }
	}
	// It goes with its Lines and their Cues, and is the new Section's active
	// Alternate, keeping its name.
	darker := named("Darker", alternate(2, true, line(2, "Hel[Am]lo", cue(2)), line(3, "dark", nil)))
	verseLeft := labelled("Verse", section(1, verse.Alternates[0], verse.Alternates[2]))
	runSheetEdits(t, sheet, []sheetEdit{
		{
			name: "labelled with the Section's Label and its name",
			edit: move(2),
			want: LyricSheet{Arrangement: []int64{1, 2}, Scrapbook: []int64{3, 11},
				Sections: []Section{verseLeft, chorus, spare, labelled("Verse · Darker", section(11, darker))}},
		},
		{
			name: "labelled with the Section's Label, when it has no name",
			edit: move(3),
			want: LyricSheet{Arrangement: []int64{1, 2}, Scrapbook: []int64{3, 11},
				Sections: []Section{labelled("Verse", section(1, verse.Alternates[0], verse.Alternates[1])), chorus, spare,
					labelled("Verse", section(11, alternate(3, true, line(4, "Other", nil))))}},
		},
		{
			name: "labelled with its name, when the Section has no Label",
			edit: move(5),
			want: LyricSheet{Arrangement: []int64{1, 2}, Scrapbook: []int64{3, 11},
				Sections: []Section{verse, section(2, chorus.Alternates[0]), spare,
					labelled("Softer", section(11, named("Softer", alternate(5, true))))}},
		},
		{
			name: "unlabelled, from a Section in the Scrapbook, when neither has one",
			edit: move(7),
			want: LyricSheet{Arrangement: []int64{1, 2}, Scrapbook: []int64{3, 11},
				Sections: []Section{verse, chorus, section(3, spare.Alternates[0]),
					section(11, alternate(7, true, line(6, "Idea", cue(9))))}},
		},
		{
			name:    "the active one",
			edit:    move(1),
			refusal: "the active Alternate can't be moved out of its Section; activate another one first",
		},
		{name: "not the Song's", edit: move(99), refusal: "not found"},
	})
}

func TestMoveAlternateToArrangement(t *testing.T) {
	sheet, verse, chorus, spare := moveOutSheet()
	move := func(alternateID int64, position int) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) {
			return moveAlternateToArrangement(s, idsFrom11(), alternateID, position)
		}
	}
	darker := named("Darker", alternate(2, true, line(2, "Hel[Am]lo", cue(2)), line(3, "dark", nil)))
	verseLeft := labelled("Verse", section(1, verse.Alternates[0], verse.Alternates[2]))
	moved := func(arrangement ...int64) LyricSheet {
		return LyricSheet{Arrangement: arrangement, Scrapbook: []int64{3},
			Sections: []Section{verseLeft, chorus, spare, labelled("Verse · Darker", section(11, darker))}}
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{name: "first", edit: move(2, 0), want: moved(11, 1, 2)},
		{name: "between", edit: move(2, 1), want: moved(1, 11, 2)},
		{name: "at the end", edit: move(2, 2), want: moved(1, 2, 11)},
		{name: "past the end", edit: move(2, 3), refusal: "position must be between 0 and 2"},
		{name: "before the start", edit: move(2, -1), refusal: "position must be between 0 and 2"},
		{
			name:    "the active one",
			edit:    move(1, 0),
			refusal: "the active Alternate can't be moved out of its Section; activate another one first",
		},
		{name: "not the Song's", edit: move(99, 0), refusal: "not found"},
	})
}

func TestAddToSection(t *testing.T) {
	verse := labelled("Verse", section(1, alternate(1, true, line(1, "Hello", cue(1))), alternate(2, false)))
	chorus := labelled("Chorus", section(2,
		alternate(3, true, line(2, "Sing", cue(4))),
		named("Softer", alternate(4, false, line(3, "Hum", cue(6))))))
	bridge := section(3, alternate(5, true, line(4, "Over", nil)))
	idea := labelled("Idea", section(4, alternate(6, false, line(5, "Maybe", cue(9))), alternate(7, true)))
	sheet := sheetOf(3, verse, chorus, bridge, idea)
	add := func(addedID, sectionID int64) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return addToSection(s, idsFrom11(), addedID, sectionID) }
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{
			// Each joins, inactive, after the Section's own, with new ids.
			// Their Lines keep their ids and Cues, dormant (ADR 0007), and an
			// unnamed one takes the added Section's Label as its name.
			name: "from the Arrangement, every Alternate joining inactive",
			edit: add(2, 1),
			want: LyricSheet{Arrangement: []int64{1, 3}, Scrapbook: []int64{4}, Sections: []Section{
				labelled("Verse", section(1, verse.Alternates[0], verse.Alternates[1],
					named("Chorus", alternate(11, false, line(2, "Sing", cue(4)))),
					named("Softer", alternate(12, false, line(3, "Hum", cue(6)))))),
				bridge, idea,
			}},
		},
		{
			name: "from the Scrapbook",
			edit: add(4, 3),
			want: LyricSheet{Arrangement: []int64{1, 2, 3}, Scrapbook: []int64{}, Sections: []Section{
				verse, chorus,
				section(3, bridge.Alternates[0],
					named("Idea", alternate(11, false, line(5, "Maybe", cue(9)))),
					named("Idea", alternate(12, false))),
			}},
		},
		{
			name: "unnamed, from a Section with no Label",
			edit: add(3, 2),
			want: LyricSheet{Arrangement: []int64{1, 2}, Scrapbook: []int64{4}, Sections: []Section{
				verse,
				labelled("Chorus", section(2, chorus.Alternates[0], chorus.Alternates[1],
					alternate(11, false, line(4, "Over", nil)))),
				idea,
			}},
		},
		{name: "to itself", edit: add(1, 1), refusal: "a Section can't be added to itself"},
		{
			name:    "to a Section in the Scrapbook",
			edit:    add(1, 4),
			refusal: "a Section can only be added to a Section in the Lyric Sheet",
		},
		{name: "one not the Song's", edit: add(9, 1), refusal: "not found"},
		{name: "to one not the Song's", edit: add(1, 9), refusal: "not found"},
	})
}
