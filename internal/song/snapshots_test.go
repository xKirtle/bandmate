package song

import (
	"fmt"
	"testing"
	"time"
)

func TestDecideSnapshot(t *testing.T) {
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	verse := labelled("Verse", section(1, alternate(1, true, line(1, "City lights", nil))))
	verseEdited := labelled("Verse", section(1, alternate(1, true, line(1, "City lights fade", nil))))
	verseCued := labelled("Verse", section(1, alternate(1, true, line(1, "City lights", cue(4.5)))))
	idea := labelled("Idea", section(2, alternate(2, true, line(2, "Neon rain", nil))))
	unlabelled := section(2, alternate(2, true, line(2, "", nil), line(3, "[Am]Neon rain", nil)))
	wordless := section(2, alternate(2, true, line(2, "[Am]", nil)))
	empty := sheetOf(0)
	sheet := sheetOf(1, verse)
	withIdea := sheetOf(1, verse, idea)

	// A Verse with an active Alternate, one named Darker and one unnamed.
	alternates := func(keep ...int64) LyricSheet {
		all := []Alternate{
			alternate(1, true, line(1, "City lights", nil)),
			named("Darker", alternate(2, false, line(2, "City nights", nil))),
			alternate(3, false, line(3, "City sights", nil)),
		}
		var alts []Alternate
		for _, alt := range all {
			for _, id := range keep {
				if alt.ID == id {
					alts = append(alts, alt)
				}
			}
		}
		return sheetOf(1, labelled("Verse", section(1, alts...)))
	}

	type history struct {
		changedAgo time.Duration // 0: the sheet has never changed
		newest     *LyricSheet
	}
	none := snapshotDecision{}
	editing := snapshotDecision{take: true, reason: BeforeEditing, changed: true}
	noSnapshot := snapshotDecision{changed: true}
	deleting := func(name string) snapshotDecision {
		return snapshotDecision{take: true, reason: BeforeDeleting, deleted: name, changed: true}
	}
	restoring := snapshotDecision{take: true, reason: BeforeRestoring, changed: true}

	tests := []struct {
		name          string
		before, after LyricSheet
		history       history
		reason        SnapshotReason
		want          snapshotDecision
	}{
		{
			name:   "the first change to a sheet starts an editing session",
			before: sheet, after: sheetOf(1, verseEdited),
			want: editing,
		},
		{
			name:   "a change 10 minutes after the last starts one",
			before: sheet, after: sheetOf(1, verseEdited),
			history: history{changedAgo: EditingSession},
			want:    editing,
		},
		{
			name:   "a change within 10 minutes of the last doesn't",
			before: sheet, after: sheetOf(1, verseEdited),
			history: history{changedAgo: EditingSession - time.Second},
			want:    noSnapshot,
		},
		{
			name:   "a change to Cues alone neither takes one nor marks the sheet changed",
			before: sheet, after: sheetOf(1, verseCued),
			history: history{changedAgo: time.Hour},
			want:    none,
		},
		{
			name:   "nor does a change that changes nothing",
			before: sheet, after: sheet,
			history: history{changedAgo: time.Hour},
			want:    none,
		},
		{
			name:   "none is taken of a sheet with no Sections",
			before: empty, after: sheet,
			history: history{changedAgo: time.Hour},
			want:    noSnapshot,
		},
		{
			name:   "none is taken of a sheet the same as the newest Snapshot's",
			before: sheet, after: sheetOf(1, verseEdited),
			history: history{changedAgo: time.Hour, newest: &sheet},
			want:    noSnapshot,
		},
		{
			name:   "one is taken of a sheet the same as the newest Snapshot's but for a Cue",
			before: sheetOf(1, verseCued), after: sheetOf(1, verseEdited),
			history: history{changedAgo: time.Hour, newest: &sheet},
			want:    editing,
		},
		{
			name:   "deleting a Section names it by its Label",
			before: withIdea, after: sheet,
			history: history{changedAgo: time.Minute},
			reason:  BeforeDeleting,
			want:    deleting("Idea"),
		},
		{
			name:   "else by its active Alternate's first Line with words",
			before: sheetOf(1, verse, unlabelled), after: sheet,
			reason: BeforeDeleting,
			want:   deleting("Neon rain"),
		},
		{
			name:   "else by nothing",
			before: sheetOf(1, verse, wordless), after: sheet,
			reason: BeforeDeleting,
			want:   deleting(""),
		},
		{
			name:   "deleting an Alternate names it by its name",
			before: alternates(1, 2, 3), after: alternates(1, 3),
			reason: BeforeDeleting,
			want:   deleting("Darker"),
		},
		{
			name:   "else by its place in its Section before",
			before: alternates(1, 2, 3), after: alternates(1, 2),
			reason: BeforeDeleting,
			want:   deleting("Alternate 3"),
		},
		{
			name:   "a Section's own Alternates go with it, so it alone is named",
			before: sheetOf(1, verse, labelled("Idea", section(2, alternate(2, true), alternate(3, false)))), after: sheet,
			reason: BeforeDeleting,
			want:   deleting("Idea"),
		},
		{
			name:   "deleting more than one names nothing",
			before: sheetOf(1, verse, idea, labelled("Bridge", section(3, alternate(3, true)))), after: sheet,
			reason: BeforeDeleting,
			want:   deleting(""),
		},
		{
			name:   "deleting nothing names nothing",
			before: withIdea, after: withIdea,
			reason: BeforeDeleting,
			want:   deleting(""),
		},
		{
			name:   "deleting takes one of a sheet the same as the newest Snapshot's, standing in for the session's",
			before: withIdea, after: sheet,
			history: history{changedAgo: time.Hour, newest: &withIdea},
			reason:  BeforeDeleting,
			want:    deleting("Idea"),
		},
		{
			name:   "restoring takes one within an editing session",
			before: sheetOf(1, verseEdited), after: sheet,
			history: history{changedAgo: time.Minute},
			reason:  BeforeRestoring,
			want:    restoring,
		},
		{
			name:   "and of a sheet with no Sections, the same as the newest Snapshot's",
			before: empty, after: sheet,
			history: history{changedAgo: time.Hour, newest: &empty},
			reason:  BeforeRestoring,
			want:    restoring,
		},
		{
			name:   "and of one restored to itself",
			before: sheet, after: sheet,
			reason: BeforeRestoring,
			want:   restoring,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var history sheetHistory
			if tt.history.changedAgo != 0 {
				history.changedAt = now.Add(-tt.history.changedAgo)
			}
			if tt.history.newest != nil {
				history.newest = encodeHeld(toHeld(*tt.history.newest))
			}
			got := decideSnapshot(tt.before, tt.after, history, tt.reason, now)
			if got.take != tt.want.take || got.changed != tt.want.changed ||
				(got.take && (got.reason != tt.want.reason || got.deleted != tt.want.deleted)) {
				t.Errorf("decision = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestThinSnapshots(t *testing.T) {
	// when is a time on a day of 2026, in UTC.
	when := func(month time.Month, day, hour int) time.Time {
		return time.Date(2026, month, day, hour, 0, 0, 0, time.UTC)
	}
	// taken is a Snapshot taken at a time, on that time's date in UTC.
	taken := func(id int64, at time.Time) takenSnapshot {
		return takenSnapshot{id: id, takenAt: at, takenOn: at.Truncate(24 * time.Hour)}
	}
	kept := func(s takenSnapshot) takenSnapshot {
		s.kept = true
		return s
	}
	// on is a Snapshot taken on another date than its time's in UTC, as
	// where it was taken was far from UTC.
	on := func(s takenSnapshot, date time.Time) takenSnapshot {
		s.takenOn = date
		return s
	}
	oct, nov, dec := time.October, time.November, time.December
	tests := []struct {
		name  string
		taken []takenSnapshot
		now   time.Time
		want  []int64
	}{
		{
			name:  "every one from the last day stays",
			taken: []takenSnapshot{taken(1, when(oct, 13, 9)), taken(2, when(oct, 13, 10)), taken(3, when(oct, 14, 8))},
			now:   when(oct, 14, 9),
		},
		{
			name: "then the newest of each day, for a month",
			taken: []takenSnapshot{taken(1, when(oct, 13, 10)), taken(2, when(oct, 13, 11)), taken(3, when(oct, 13, 12)),
				taken(4, when(oct, 14, 8)), taken(5, when(oct, 15, 12))},
			now:  when(oct, 15, 12),
			want: []int64{2, 1},
		},
		{
			name: "then the newest of each ISO week",
			// Tuesday to Thursday of one week, then Tuesday and Wednesday of
			// the next, the first over a month old, the second not.
			taken: []takenSnapshot{taken(1, when(oct, 13, 10)), taken(2, when(oct, 14, 10)), taken(3, when(oct, 15, 10)),
				taken(4, when(oct, 20, 10)), taken(5, when(oct, 21, 10))},
			now:  when(nov, 19, 12),
			want: []int64{2, 1},
		},
		{
			name:  "the newest of a day is the one taken last, whatever order they're given in",
			taken: []takenSnapshot{taken(3, when(oct, 13, 12)), taken(1, when(oct, 13, 10)), taken(2, when(oct, 13, 11))},
			now:   when(oct, 20, 12),
			want:  []int64{2, 1},
		},
		{
			name:  "of two taken at once, the newer is the later id",
			taken: []takenSnapshot{taken(1, when(oct, 13, 10)), taken(2, when(oct, 13, 10))},
			now:   when(oct, 20, 12),
			want:  []int64{1},
		},
		{
			name: "a day is the date where it was taken",
			// Monday 22:00 and Tuesday 08:00 in Auckland, both Monday in UTC.
			taken: []takenSnapshot{on(taken(1, when(oct, 19, 9)), when(oct, 19, 0)),
				on(taken(2, when(oct, 19, 19)), when(oct, 20, 0))},
			now: when(oct, 21, 23),
		},
		{
			name: "a kept one is never thinned, nor counts as its day's newest",
			taken: []takenSnapshot{kept(taken(1, when(oct, 13, 10))), taken(2, when(oct, 13, 11)),
				kept(taken(3, when(oct, 13, 12))), taken(4, when(oct, 13, 9))},
			now:  when(dec, 31, 12),
			want: []int64{4},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := thinSnapshots(tt.taken, tt.now); fmt.Sprint(got) != fmt.Sprint(tt.want) {
				t.Errorf("thinned = %v, want %v", got, tt.want)
			}
		})
	}
}
