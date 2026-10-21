package backups

import (
	"cmp"
	"slices"
)

// The identity decisions a Restore makes, as a value: which id each row of
// the four tables carrying identity rules gets, and what that id means.
// Folders and Tags are matched to those already in Bandmate by their folded
// names (ADR 0015), Songs and Beats by their identities, replaced where the
// user said so and kept both where not. The rows of the other 13 tables a
// Song's rows live in carry no such decision, and their ids stay worked out
// in SQL (see giveFreshIDs and ADR 0026).

// backupRow is a row of a table carrying identity rules as the Backup holds
// it: its id there, the folded name or identity it's matched by, and the
// version it holds, for a Song.
type backupRow struct {
	id      int64
	key     string
	version int64
}

// bandmateRow is a row already in Bandmate that one from the Backup can
// match: its id here, the name it carries here, for a Folder or Tag, and
// the version it holds, for a Song.
type bandmateRow struct {
	id      int64
	name    string
	version int64
}

// identityPlan is what the identity decisions for one table are worked out
// from.
type identityPlan struct {
	// picked is the rows the Backup holds that each pick of the Restore
	// names, in the order they're picked; within a pick they're decided by
	// their ids in the Backup, whatever order they come in. A shared table's
	// row, i.e. a Folder, Tag or Beat, can be named by more than one pick,
	// and is decided once, where it's first named.
	picked [][]backupRow
	// inBandmate is the rows already in Bandmate, by the folded name or the
	// identity they're matched by. A key no row here holds matches nothing.
	inBandmate map[string]bandmateRow
	// matchedByName tells whether the table's rows are matched by a folded
	// name, i.e. Folders' and Tags', rather than by identity, i.e. Songs'
	// and Beats'.
	matchedByName bool
	// replacing lists the rows the Restore replaces rather than keeping
	// both, by their ids in the Backup, as the user chose. It's empty for a
	// table matched by name, which has no such choice.
	replacing []int64
	// versioned tells whether the table's rows hold a version a replaced
	// row's follows, i.e. Songs'.
	versioned bool
	// lastUsedID is the highest id the table has used in Bandmate, held now
	// or not: a fresh id is the next one past it.
	lastUsedID int64
}

// idDecision is the id one row restored gets, and what that id means: what
// the Restore's temporary table holds for the row.
type idDecision struct {
	// old is the row's id in the Backup, new the id it gets in Bandmate.
	old, new int64
	// keptBoth is set for a Song or Beat added alongside the same one
	// already in Bandmate, which gets an identity and a title of its own.
	keptBoth bool
	// replaced is set for a Song or Beat taking the id of the one it
	// replaces.
	replaced bool
	// matched is set for a Folder or Tag taking the id of the one of the
	// same folded name already in Bandmate.
	matched bool
	// matchedName is the name that one carries in Bandmate, kept so a
	// Folder or Tag matched is added back under it if it went with a Song
	// replaced. It's nil for a row not matched.
	matchedName *string
	// priorVersion is the version the row replaced holds in Bandmate, which
	// the restored one's follows. It's nil for a row not replaced, or in a
	// table holding no version.
	priorVersion *int64
}

// decide is the id each row the Restore brings back gets, in the order the
// rows are picked: the id of the row it replaces, or of the Folder or Tag it
// matches by name, and otherwise a fresh one, past every id the table has
// used, handed out in the order of their ids in the Backup.
func decide(p identityPlan) []idDecision {
	decisions := []idDecision{}
	decided := map[int64]bool{}
	next := p.lastUsedID
	for _, pick := range p.picked {
		byID := slices.SortedFunc(slices.Values(pick), func(a, b backupRow) int {
			return cmp.Compare(a.id, b.id)
		})
		for _, r := range byID {
			if decided[r.id] {
				continue
			}
			decided[r.id] = true
			match, inBandmate := p.inBandmate[r.key]
			switch {
			case p.matchedByName && inBandmate:
				name := match.name
				decisions = append(decisions, idDecision{old: r.id, new: match.id, matched: true, matchedName: &name})
			case !p.matchedByName && inBandmate && slices.Contains(p.replacing, r.id):
				d := idDecision{old: r.id, new: match.id, replaced: true}
				if p.versioned {
					version := match.version
					d.priorVersion = &version
				}
				decisions = append(decisions, d)
			default:
				next++
				decisions = append(decisions, idDecision{old: r.id, new: next,
					keptBoth: !p.matchedByName && inBandmate})
			}
		}
	}
	return decisions
}
