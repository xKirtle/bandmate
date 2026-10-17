package lyricsheet

import (
	"fmt"
	"slices"
	"strings"

	"github.com/xKirtle/bandmate/internal/domain"
)

var errPlaced = domain.Invalid("each Section must be in exactly one of the Lyric Sheet and the Scrapbook, once")

// checkChange checks the sheet a change leaves, after, against the sheet's
// rules: each Section in exactly one of the Lyric Sheet and the Scrapbook,
// once; no id held twice; each Section with exactly one active Alternate;
// each Line one line of text; and each Cue one a Line can have.
//
// The database holds every Section in one place and every id once, so
// those rules are checked on the whole sheet. It doesn't hold the rest, so
// they're checked only on what the change made or altered, so a sheet
// already stored breaking one never refuses the change that would fix it
// (ADR 0024).
func checkChange(before, after LyricSheet) error {
	placed := map[int64]int{}
	for _, id := range slices.Concat(after.Arrangement, after.Scrapbook) {
		placed[id]++
	}

	was := indexSheet(before)
	seen := map[string]map[int64]bool{"sections": {}, "alternates": {}, "lines": {}}
	once := func(table string, id int64) error {
		if id <= 0 || seen[table][id] {
			return domain.Invalid(fmt.Sprintf("each of the sheet's %s needs an id of its own", table))
		}
		seen[table][id] = true
		return nil
	}
	for _, sec := range after.Sections {
		if err := once("sections", sec.ID); err != nil {
			return err
		}
		if placed[sec.ID] != 1 {
			return errPlaced
		}
		active := 0
		for _, alt := range sec.Alternates {
			if err := once("alternates", alt.ID); err != nil {
				return err
			}
			if alt.Active {
				active++
			}
			for _, l := range alt.Lines {
				if err := once("lines", l.ID); err != nil {
					return err
				}
				old, there := was.lines[l.ID]
				if (!there || old.Text != l.Text) && strings.ContainsAny(l.Text, "\r\n") {
					return domain.Invalid("a Line's text can't hold a line break")
				}
				if l.Cue != nil && (!there || old.Cue == nil || *old.Cue != *l.Cue) {
					if _, err := cueMillis(*l.Cue); err != nil {
						return err
					}
				}
			}
		}
		if active != 1 && alternatesChanged(was.sections[sec.ID], sec) {
			return domain.Invalid("each Section must have exactly one active Alternate")
		}
	}
	if len(placed) != len(after.Sections) {
		return errPlaced
	}
	return nil
}

// sheetIndex finds a sheet's Sections and Lines by id.
type sheetIndex struct {
	sections map[int64]*Section
	lines    map[int64]Line
}

func indexSheet(sheet LyricSheet) sheetIndex {
	index := sheetIndex{sections: map[int64]*Section{}, lines: map[int64]Line{}}
	for i := range sheet.Sections {
		sec := &sheet.Sections[i]
		index.sections[sec.ID] = sec
		for _, alt := range sec.Alternates {
			for _, l := range alt.Lines {
				index.lines[l.ID] = l
			}
		}
	}
	return index
}

// alternatesChanged reports whether a change gave a Section, was before it
// (nil if new), other Alternates, or made another one active.
func alternatesChanged(was *Section, now Section) bool {
	if was == nil {
		return true
	}
	return !slices.EqualFunc(was.Alternates, now.Alternates, func(a, b Alternate) bool {
		return a.ID == b.ID && a.Active == b.Active
	})
}
