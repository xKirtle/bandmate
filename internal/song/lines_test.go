package song

import (
	"testing"
)

func TestReplaceAlternateText(t *testing.T) {
	verse := section(1,
		alternate(1, true, line(1, "Hello", cue(1)), line(2, "dark", cue(2)), line(3, "world", cue(3))),
		alternate(2, false, line(4, "Other", cue(9))))
	spare := section(2, alternate(3, true))
	sheet := sheetOf(1, verse, spare)
	replace := func(alternateID int64, text string) func(LyricSheet) (LyricSheet, error) {
		return func(s LyricSheet) (LyricSheet, error) { return replaceAlternateText(s, idsFrom11(), alternateID, text) }
	}
	withLines := func(lines ...Line) LyricSheet {
		return sheetOf(1, section(1, alternate(1, true, lines...), verse.Alternates[1]), spare)
	}
	runSheetEdits(t, sheet, []sheetEdit{
		{name: "the same text", edit: replace(1, "Hello\ndark\nworld\n"), want: sheet},
		{
			name: "a Line edited in place keeps its id and Cue",
			edit: replace(1, "Hello\nda[Am]rk\nworld"),
			want: withLines(line(1, "Hello", cue(1)), line(2, "da[Am]rk", cue(2)), line(3, "world", cue(3))),
		},
		{
			name: "a Line added gets a new id and no Cue",
			edit: replace(1, "Hello\ndark\nnew\nworld"),
			want: withLines(line(1, "Hello", cue(1)), line(2, "dark", cue(2)), line(11, "new", nil),
				line(3, "world", cue(3))),
		},
		{
			name: "a Line removed goes, the rest keep theirs",
			edit: replace(1, "Hello\r\nworld\n\n  \n"),
			want: withLines(line(1, "Hello", cue(1)), line(3, "world", cue(3))),
		},
		{
			name: "Lines moved keep their ids",
			edit: replace(1, "world\nHello"),
			want: withLines(line(3, "world", cue(3)), line(11, "Hello", nil)),
		},
		{
			name: "blank Lines between are kept",
			edit: replace(1, "Hello\n\nworld"),
			want: withLines(line(1, "Hello", cue(1)), line(2, "", cue(2)), line(3, "world", cue(3))),
		},
		{
			name: "of a Section in the Scrapbook",
			edit: replace(3, "Idea\nmore"),
			want: sheetOf(1, verse, section(2, alternate(3, true, line(11, "Idea", nil), line(12, "more", nil)))),
		},
		{
			name: "emptied",
			edit: replace(1, "\n"),
			want: sheetOf(1, section(1, Alternate{ID: 1, Active: true, Lines: []Line{}}, verse.Alternates[1]), spare),
		},
		{name: "not the Song's", edit: replace(9, "Hello"), refusal: "not found"},
	})
}
