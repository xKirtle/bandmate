package lyricsheet

import (
	"reflect"
	"testing"
)

// sheetOf is a sheet of sections, the first ones in the Arrangement and the
// rest, from scrapbookFrom on, in the Scrapbook.
func sheetOf(scrapbookFrom int, sections ...Section) LyricSheet {
	sheet := LyricSheet{Arrangement: []int64{}, Scrapbook: []int64{}, Sections: sections}
	for i, sec := range sections {
		if i < scrapbookFrom {
			sheet.Arrangement = append(sheet.Arrangement, sec.ID)
		} else {
			sheet.Scrapbook = append(sheet.Scrapbook, sec.ID)
		}
	}
	return sheet
}

// section is a Section of alternates, without a Label.
func section(id int64, alternates ...Alternate) Section {
	return Section{ID: id, Alternates: alternates}
}

// alternate is an Alternate of lines, unnamed.
func alternate(id int64, active bool, lines ...Line) Alternate {
	return Alternate{ID: id, Active: active, Lines: lines}
}

func TestCheckChange(t *testing.T) {
	const (
		errPlaced = "each Section must be in exactly one of the Lyric Sheet and the Scrapbook, once"
		errActive = "each Section must have exactly one active Alternate"
		errBreak  = "a Line's text can't hold a line break"
		errLate   = "a Cue can't be more than 24 hours into the Timeline"
	)
	verse := section(1, alternate(1, true, line(1, "Hello", nil)))
	chorus := section(2, alternate(2, true, line(2, "Sing", nil)))
	before := sheetOf(1, verse, chorus)
	tests := []struct {
		name          string
		before, after LyricSheet
		want          string
	}{
		{
			name:   "a Section moved to the Arrangement",
			before: before,
			after:  sheetOf(2, verse, chorus),
		},
		{
			name:   "a Section in both the Arrangement and the Scrapbook",
			before: before,
			after:  LyricSheet{Arrangement: []int64{1, 2}, Scrapbook: []int64{2}, Sections: before.Sections},
			want:   errPlaced,
		},
		{
			name:   "a Section in neither",
			before: before,
			after:  LyricSheet{Arrangement: []int64{1}, Scrapbook: []int64{}, Sections: before.Sections},
			want:   errPlaced,
		},
		{
			name:   "a Section twice in the Arrangement",
			before: before,
			after:  LyricSheet{Arrangement: []int64{1, 2, 1}, Scrapbook: []int64{}, Sections: before.Sections},
			want:   errPlaced,
		},
		{
			name:   "a Section placed that isn't in the sheet",
			before: before,
			after:  LyricSheet{Arrangement: []int64{1, 3}, Scrapbook: []int64{2}, Sections: before.Sections},
			want:   errPlaced,
		},
		{
			name:   "a new Section with an id already held",
			before: before,
			after: LyricSheet{Arrangement: []int64{1}, Scrapbook: []int64{2},
				Sections: []Section{verse, chorus, section(2, alternate(3, true))}},
			want: "each of the sheet's sections needs an id of its own",
		},
		{
			name:   "a new Line with no id",
			before: before,
			after:  sheetOf(1, section(1, alternate(1, true, line(1, "Hello", nil), line(0, "world", nil))), chorus),
			want:   "each of the sheet's lines needs an id of its own",
		},
		{
			name:   "a second Alternate made active",
			before: before,
			after:  sheetOf(1, section(1, alternate(1, true, line(1, "Hello", nil)), alternate(3, true)), chorus),
			want:   errActive,
		},
		{
			name:   "a Section's active Alternate moved out of it",
			before: before,
			after:  sheetOf(1, section(1), section(2, alternate(2, true, line(2, "Sing", nil)), alternate(1, false, line(1, "Hello", nil)))),
			want:   errActive,
		},
		{
			name:   "a Section stored with no active Alternate, left alone",
			before: sheetOf(1, section(1, alternate(1, false)), chorus),
			after:  sheetOf(1, section(1, alternate(1, false)), section(2, alternate(2, true, line(2, "Sung", nil)))),
		},
		{
			name:   "a Line written with a line break",
			before: before,
			after:  sheetOf(1, section(1, alternate(1, true, line(1, "Hel\nlo", nil))), chorus),
			want:   errBreak,
		},
		{
			name:   "a Line stored with a line break, left alone",
			before: sheetOf(1, section(1, alternate(1, true, line(1, "Hel\nlo", nil))), chorus),
			after:  sheetOf(1, section(1, alternate(1, true, line(1, "Hel\nlo", nil))), section(2, alternate(2, true, line(2, "Sung", nil)))),
		},
		{
			name:   "a Cue set past 24 hours",
			before: before,
			after:  sheetOf(1, section(1, alternate(1, true, line(1, "Hello", cue(maxCue+1)))), chorus),
			want:   errLate,
		},
		{
			name:   "a Cue stored past 24 hours, left alone",
			before: sheetOf(1, section(1, alternate(1, true, line(1, "Hello", cue(maxCue+1)))), chorus),
			after:  sheetOf(2, section(1, alternate(1, true, line(1, "Hello", cue(maxCue+1)))), chorus),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ""
			if err := checkChange(tt.before, tt.after); err != nil {
				got = err.Error()
			}
			if got != tt.want {
				t.Errorf("checkChange = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestKeepCurrentCues(t *testing.T) {
	current := sheetOf(1, section(1, alternate(1, true, line(1, "a", cue(3)), line(2, "b", nil))))
	copied := sheetOf(1, section(1, alternate(1, true,
		line(1, "a", cue(1)), line(2, "b", cue(5)), line(3, "c", cue(7)))))

	got := keepCurrentCues(current, copied)

	want := sheetOf(1, section(1, alternate(1, true,
		line(1, "a", cue(3)), line(2, "b", nil), line(3, "c", cue(7)))))
	if !reflect.DeepEqual(got, want) {
		t.Errorf("keepCurrentCues =\n%+v\nwant\n%+v", got, want)
	}
	if *copied.Sections[0].Alternates[0].Lines[0].Cue != 1 {
		t.Error("keepCurrentCues changed the copy it was given")
	}
}
