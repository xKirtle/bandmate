package backups

import (
	"fmt"
	"reflect"
	"testing"
)

// The id decisions a Restore makes, on plain values: which id each Folder,
// Tag, Song and Beat brought back gets, and what that id means. They were
// reachable only through the HTTP server, as generated SQL writing into a
// temporary table, until they became a value (ADR 0026).

// matchedAs is the name a Folder or Tag matched carries in Bandmate.
func matchedAs(name string) *string { return &name }

// following is the version a Song replaced holds in Bandmate.
func following(version int64) *int64 { return &version }

// songsPicked is the input for the Songs picked, matched by Identity and
// holding a version each, where Bandmate's last Song has id 7.
func songsPicked(picked [][]backupRow, inBandmate map[string]bandmateRow, replacing ...int64) identityInput {
	return identityInput{picked: picked, inBandmate: inBandmate, replacing: replacing,
		versioned: true, lastUsedID: 7}
}

func TestDecidingRestoredIDs(t *testing.T) {
	tests := []struct {
		name string
		in   identityInput
		want []idDecision
	}{
		{
			name: "a Song replaced takes the id and follows the version of the one it replaces",
			in: songsPicked([][]backupRow{{{id: 3, key: "song-a"}}},
				map[string]bandmateRow{"song-a": {id: 2, version: 9}}, 3),
			want: []idDecision{{old: 3, new: 2, replaced: true, priorVersion: following(9)}},
		},
		{
			name: "a Folder matched by its folded name takes that Folder's id and name",
			in: identityInput{
				picked:        [][]backupRow{{{id: 5, key: "ep one"}}},
				inBandmate:    map[string]bandmateRow{"ep one": {id: 1, name: "EP One"}},
				matchedByName: true,
				lastUsedID:    4,
			},
			want: []idDecision{{old: 5, new: 1, matched: true, matchedName: matchedAs("EP One")}},
		},
		{
			name: "a Tag already in Bandmate in another case is that Tag, under the name it carries here",
			in: identityInput{
				picked:        [][]backupRow{{{id: 2, key: "album 2023"}}},
				inBandmate:    map[string]bandmateRow{"album 2023": {id: 6, name: "Album 2023"}},
				matchedByName: true,
				lastUsedID:    6,
			},
			want: []idDecision{{old: 2, new: 6, matched: true, matchedName: matchedAs("Album 2023")}},
		},
		{
			// The Tag matched went with the Song being replaced, which is
			// cleared to be made anew, so the Restore adds it back under the
			// id and name this decision keeps.
			name: "a Tag matched whose Song is replaced keeps that Tag's id and name all the same",
			in: identityInput{
				picked:        [][]backupRow{{{id: 4, key: "demos"}}},
				inBandmate:    map[string]bandmateRow{"demos": {id: 3, name: "Demos"}},
				matchedByName: true,
				lastUsedID:    3,
			},
			want: []idDecision{{old: 4, new: 3, matched: true, matchedName: matchedAs("Demos")}},
		},
		{
			name: "a Folder the Backup holds that no Folder here is named after is added, with a fresh id",
			in: identityInput{
				picked:        [][]backupRow{{{id: 5, key: "ep two"}}},
				inBandmate:    map[string]bandmateRow{"ep one": {id: 1, name: "EP One"}},
				matchedByName: true,
				lastUsedID:    4,
			},
			want: []idDecision{{old: 5, new: 5}},
		},
		{
			name: "a Beat used by a Song replaced that replace doesn't list is kept both, with a fresh id",
			in: identityInput{
				picked:     [][]backupRow{{{id: 1, key: "beat-a"}}},
				inBandmate: map[string]bandmateRow{"beat-a": {id: 3}},
				replacing:  []int64{},
				lastUsedID: 3,
			},
			want: []idDecision{{old: 1, new: 4, keptBoth: true}},
		},
		{
			name: "a Beat replaced takes the id of the one it replaces, and follows no version, as a Beat holds none",
			in: identityInput{
				picked:     [][]backupRow{{{id: 1, key: "beat-a"}}},
				inBandmate: map[string]bandmateRow{"beat-a": {id: 3}},
				replacing:  []int64{1},
				lastUsedID: 3,
			},
			want: []idDecision{{old: 1, new: 3, replaced: true}},
		},
		{
			name: "the same Beat, picked by two Songs, is decided once, where it's first picked",
			in: identityInput{
				picked: [][]backupRow{
					{{id: 1, key: "beat-a"}, {id: 2, key: "beat-b"}},
					{{id: 2, key: "beat-b"}, {id: 4, key: "beat-c"}},
				},
				inBandmate: map[string]bandmateRow{},
				lastUsedID: 10,
			},
			want: []idDecision{{old: 1, new: 11}, {old: 2, new: 12}, {old: 4, new: 13}},
		},
		{
			name: "a Backup made before Folders existed holds no Folder to decide",
			in: identityInput{
				picked:        [][]backupRow{{}, {}},
				inBandmate:    map[string]bandmateRow{"ep one": {id: 1, name: "EP One"}},
				matchedByName: true,
				lastUsedID:    1,
			},
			want: []idDecision{},
		},
		{
			name: "a Song from another install is not already here, however it's titled, and is added with a fresh id",
			in: songsPicked([][]backupRow{{{id: 1, key: "song-elsewhere"}}},
				map[string]bandmateRow{"song-here": {id: 4, version: 3}}, 1),
			want: []idDecision{{old: 1, new: 8}},
		},
		{
			name: "fresh ids are handed out in Backup-id order, pick by pick, past the table's last used id",
			in: identityInput{
				picked: [][]backupRow{
					{{id: 9, key: "beat-c"}, {id: 2, key: "beat-a"}, {id: 6, key: "beat-b"}},
					{{id: 1, key: "beat-d"}},
				},
				inBandmate: map[string]bandmateRow{},
				lastUsedID: 20,
			},
			want: []idDecision{{old: 2, new: 21}, {old: 6, new: 22}, {old: 9, new: 23}, {old: 1, new: 24}},
		},
		{
			name: "a pick of Songs, some replaced and some not, takes the ids of those it replaces and fresh ones past the rest",
			in: songsPicked([][]backupRow{{{id: 1, key: "song-a"}}, {{id: 2, key: "song-b"}},
				{{id: 3, key: "song-c"}}},
				map[string]bandmateRow{"song-a": {id: 5, version: 2}, "song-c": {id: 6, version: 4}}, 1, 3),
			want: []idDecision{
				{old: 1, new: 5, replaced: true, priorVersion: following(2)},
				{old: 2, new: 8},
				{old: 3, new: 6, replaced: true, priorVersion: following(4)},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := decideIDs(test.in)
			if !reflect.DeepEqual(got, test.want) {
				t.Errorf("decideIDs() = %s, want %s", showDecisions(got), showDecisions(test.want))
			}
		})
	}
}

// showDecisions is decisions as a test failure reads them.
func showDecisions(decisions []idDecision) string {
	out := "["
	for i, d := range decisions {
		if i > 0 {
			out += " "
		}
		out += showDecision(d)
	}
	return out + "]"
}

// showDecision is one decision as a test failure reads it: the ids, then
// what the new id means.
func showDecision(d idDecision) string {
	out := fmt.Sprintf("%d->%d", d.old, d.new)
	if d.keptBoth {
		out += " keptBoth"
	}
	if d.replaced {
		out += " replaced"
	}
	if d.matched {
		out += " matched"
	}
	if d.matchedName != nil {
		out += fmt.Sprintf(" as %q", *d.matchedName)
	}
	if d.priorVersion != nil {
		out += fmt.Sprintf(" after version %d", *d.priorVersion)
	}
	return out
}
