package lyricsheet

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/xKirtle/bandmate/internal/songversion"
)

// ReplaceAlternateText replaces an Alternate's Lines with the Lines of text,
// one per line. Lines keep their identity where they can: unchanged Lines and
// Lines edited in place keep their ids, removed Lines are deleted, and only
// Lines that are really new get new ids.
func (s *Store) ReplaceAlternateText(ctx context.Context, songID int64, based songversion.Version, alternateID int64, text string) (Song, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, _, err := findAlternate(ctx, tx, songID, alternateID); err != nil {
			return err
		}
		var oldIDs []int64
		var oldTexts []string
		err := query(ctx, tx, `SELECT id, text FROM lines WHERE alternate_id = ? ORDER BY position`,
			[]any{alternateID}, func(rows *sql.Rows) error {
				var id int64
				var text string
				if err := rows.Scan(&id, &text); err != nil {
					return err
				}
				oldIDs, oldTexts = append(oldIDs, id), append(oldTexts, text)
				return nil
			})
		if err != nil {
			return fmt.Errorf("reading lines: %w", err)
		}

		newTexts := splitLines(text)
		keeps := matchLines(oldTexts, newTexts)
		kept := map[int]bool{}
		for _, k := range keeps {
			kept[k] = true
		}
		for i, id := range oldIDs {
			if kept[i] {
				continue
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM lines WHERE id = ?`, id); err != nil {
				return fmt.Errorf("removing line: %w", err)
			}
		}
		for i, k := range keeps {
			var err error
			if k < 0 {
				_, err = tx.ExecContext(ctx, `INSERT INTO lines (alternate_id, position, text) VALUES (?, ?, ?)`,
					alternateID, i, newTexts[i])
			} else {
				_, err = tx.ExecContext(ctx, `UPDATE lines SET position = ?, text = ? WHERE id = ?`,
					i, newTexts[i], oldIDs[k])
			}
			if err != nil {
				return fmt.Errorf("saving line: %w", err)
			}
		}
		return nil
	})
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
