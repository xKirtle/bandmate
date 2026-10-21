package song

import (
	"context"
	"database/sql"
	"strings"

	"github.com/xKirtle/bandmate/internal/songversion"
)

// ReplaceAlternateText replaces an Alternate's Lines with the Lines of text,
// one per line. Lines keep their identity where they can: unchanged Lines and
// Lines edited in place keep their ids, removed Lines are deleted, and only
// Lines that are really new get new ids.
func (s *Store) ReplaceAlternateText(ctx context.Context, songID int64, based songversion.Version, alternateID int64, text string) (Song, error) {
	return s.editSheet(ctx, songID, based, noReason, func(sheet LyricSheet, ids *ids) (LyricSheet, error) {
		return replaceAlternateText(sheet, ids, alternateID, text)
	})
}

// replaceAlternateText is ReplaceAlternateText's change to the sheet. A Line
// that keeps its identity keeps its Cue too; a new Line has none.
func replaceAlternateText(sheet LyricSheet, ids *ids, alternateID int64, text string) (LyricSheet, error) {
	sec, i, err := sheetAlternate(sheet, alternateID)
	if err != nil {
		return LyricSheet{}, err
	}
	old := sec.Alternates[i].Lines
	oldTexts := make([]string, len(old))
	for k, l := range old {
		oldTexts[k] = l.Text
	}
	newTexts := splitLines(text)
	lines := make([]Line, len(newTexts))
	for k, keep := range matchLines(oldTexts, newTexts) {
		if keep < 0 {
			lines[k] = newLine(ids.line(), newTexts[k], sql.NullInt64{})
			continue
		}
		lines[k] = newLine(old[keep].ID, newTexts[k], sql.NullInt64{})
		lines[k].Cue = copyCue(old[keep].Cue)
	}
	sec.Alternates[i].Lines = lines
	return sheet, nil
}

// matchLines works out which old Line each new Line is, returning for each
// new Line the index of the old Line whose identity it keeps, or -1 for a new
// Line.
//
// Lines whose text is unchanged are matched first, as the longest common
// subsequence of old and new. Between two such matches, the remaining old and
// new Lines are paired in order as edits in place; leftover old Lines were
// removed and leftover new Lines were added.
func matchLines(old, new []string) []int {
	// lcs[i][j] is the length of the longest common subsequence of old[i:]
	// and new[j:].
	lcs := make([][]int, len(old)+1)
	for i := range lcs {
		lcs[i] = make([]int, len(new)+1)
	}
	for i := len(old) - 1; i >= 0; i-- {
		for j := len(new) - 1; j >= 0; j-- {
			if old[i] == new[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			} else {
				lcs[i][j] = max(lcs[i+1][j], lcs[i][j+1])
			}
		}
	}

	keeps := make([]int, len(new))
	i, j := 0, 0
	// gapOld and gapNew are where the current run of unmatched Lines starts.
	gapOld, gapNew := 0, 0
	pairGap := func() {
		for k := 0; gapNew+k < j; k++ {
			keeps[gapNew+k] = -1
			if gapOld+k < i {
				keeps[gapNew+k] = gapOld + k
			}
		}
	}
	for i < len(old) && j < len(new) {
		switch {
		case old[i] == new[j]:
			pairGap()
			keeps[j] = i
			i, j = i+1, j+1
			gapOld, gapNew = i, j
		case lcs[i+1][j] >= lcs[i][j+1]:
			i++
		default:
			j++
		}
	}
	i, j = len(old), len(new)
	pairGap()
	return keeps
}

// splitLines splits text into Lines. Blank lines at the end are dropped;
// every other line, blank or not, is a Line as written.
func splitLines(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(text, "\n")
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}
