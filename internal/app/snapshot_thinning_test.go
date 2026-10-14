package app_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// snapshotTaker takes Snapshots of one Song, each at a time of the test's
// choosing, by changing its Section's Label after a gap long enough to
// start an editing session.
type snapshotTaker struct {
	ts      *testServer
	clock   *testClock
	song    song
	changes int
}

func newSnapshotTaker(t *testing.T) *snapshotTaker {
	t.Helper()
	ts, clock, s := snapshotServer(t, "City lights")
	return &snapshotTaker{ts: ts, clock: clock, song: s}
}

// takeAt takes a Snapshot at at, which must be 10 minutes or more after the
// last change.
func (st *snapshotTaker) takeAt(at time.Time) {
	st.ts.t.Helper()
	st.clock.Advance(at.Sub(st.clock.Now()))
	st.changes++
	st.ts.setLabel(st.song.ID, st.song.Sections[0].ID, fmt.Sprintf("Verse %d", st.changes))
}

// taken lists when each of the Song's Snapshots was taken, newest first.
func (st *snapshotTaker) taken() []string {
	st.ts.t.Helper()
	var at []string
	for _, s := range st.ts.listSnapshots(st.song.ID) {
		at = append(at, parseTime(st.ts.t, s.TakenAt).Format("Jan 2 15:04"))
	}
	return at
}

// keep keeps or un-keeps a Snapshot.
func (ts *testServer) keepSnapshot(songID, snapshotID int64, kept bool) response {
	ts.t.Helper()
	return ts.Do(http.MethodPatch, fmt.Sprintf("/api/songs/%d/snapshots/%d", songID, snapshotID), map[string]any{"kept": kept})
}

// on is a time on a day of October or November 2026, in UTC.
func on(month time.Month, day, hour, min int) time.Time {
	return time.Date(2026, month, day, hour, min, 0, 0, time.UTC)
}

func TestEverySnapshotFromTheLastDayIsKept(t *testing.T) {
	st := newSnapshotTaker(t)
	st.takeAt(on(time.October, 13, 9, 10))
	st.takeAt(on(time.October, 13, 9, 20))
	st.takeAt(on(time.October, 14, 9, 0))

	if got := fmt.Sprint(st.taken()); got != "[Oct 14 09:00 Oct 13 09:20 Oct 13 09:10]" {
		t.Errorf("snapshots taken = %s, want all three, as none is a day old", got)
	}
}

func TestOnlyTheNewestOfEachDayIsKeptForAMonth(t *testing.T) {
	st := newSnapshotTaker(t)
	st.takeAt(on(time.October, 13, 10, 0))
	st.takeAt(on(time.October, 13, 11, 0))
	st.takeAt(on(time.October, 13, 12, 0))
	st.takeAt(on(time.October, 14, 8, 0))
	st.takeAt(on(time.October, 15, 12, 0))

	if got := fmt.Sprint(st.taken()); got != "[Oct 15 12:00 Oct 14 08:00 Oct 13 12:00]" {
		t.Errorf("snapshots taken = %s, want the newest of Oct 13 and the one of Oct 14", got)
	}
}

func TestOnlyTheNewestOfEachWeekIsKeptAfterAMonth(t *testing.T) {
	st := newSnapshotTaker(t)
	// Tuesday to Thursday of one week, then Tuesday and Wednesday of the next.
	for _, day := range []int{13, 14, 15, 20, 21} {
		st.takeAt(on(time.October, day, 10, 0))
	}
	// Over a month after the first week, under a month after the second.
	st.takeAt(on(time.November, 19, 12, 0))

	if got := fmt.Sprint(st.taken()); got != "[Nov 19 12:00 Oct 21 10:00 Oct 20 10:00 Oct 15 10:00]" {
		t.Errorf("snapshots taken = %s, want both days of the second week, and only the newest of the first", got)
	}

	// Once the second week is over a month old too, it keeps only its newest.
	st.takeAt(on(time.November, 23, 12, 0))
	if got := fmt.Sprint(st.taken()); got != "[Nov 23 12:00 Nov 19 12:00 Oct 21 10:00 Oct 15 10:00]" {
		t.Errorf("snapshots taken = %s, want only the newest of each week over a month old", got)
	}
}

// lateNightThenMorning takes a Snapshot late on Monday 19 October and one
// early the next morning in New Zealand (UTC+13), both on Monday in UTC,
// then one two days later, which thins them.
func lateNightThenMorning(st *snapshotTaker) {
	st.takeAt(on(time.October, 19, 9, 0))  // Monday 22:00 in Auckland
	st.takeAt(on(time.October, 19, 19, 0)) // Tuesday 08:00 in Auckland
	st.takeAt(on(time.October, 21, 23, 0)) // Thursday 12:00 in Auckland
}

func TestADayIsTheDayWhereTheSnapshotWasTaken(t *testing.T) {
	st := newSnapshotTaker(t)
	st.ts.zone = "Pacific/Auckland"
	lateNightThenMorning(st)

	if got := fmt.Sprint(st.taken()); got != "[Oct 21 23:00 Oct 19 19:00 Oct 19 09:00]" {
		t.Errorf("snapshots taken = %s, want Monday night's and Tuesday morning's, as they're two days in Auckland", got)
	}
}

func TestADayIsAUTCDayWhenTheTimeZoneIsUnknown(t *testing.T) {
	for _, zone := range []string{"", "Mars/Olympus_Mons", "Local"} {
		st := newSnapshotTaker(t)
		st.ts.zone = zone
		lateNightThenMorning(st)

		if got := fmt.Sprint(st.taken()); got != "[Oct 21 23:00 Oct 19 19:00]" {
			t.Errorf("zone %q: snapshots taken = %s, want only the newest of Monday in UTC", zone, got)
		}
	}
}

func TestAKeptSnapshotIsNeverThinnedUntilItsUnkept(t *testing.T) {
	st := newSnapshotTaker(t)
	st.takeAt(on(time.October, 13, 10, 0))
	st.takeAt(on(time.October, 13, 11, 0))
	st.takeAt(on(time.October, 13, 12, 0))
	first := st.ts.listSnapshots(st.song.ID)[2]

	res := st.ts.keepSnapshot(st.song.ID, first.ID, true)
	expectStatus(t, res, http.StatusOK)
	var kept snapshotSummary
	res.JSON(t, &kept)
	if kept.ID != first.ID || !kept.Kept || kept.TakenAt != first.TakenAt {
		t.Errorf("kept = %+v, want the Snapshot, kept", kept)
	}

	st.takeAt(on(time.December, 31, 12, 0))
	if got := fmt.Sprint(st.taken()); got != "[Dec 31 12:00 Oct 13 12:00 Oct 13 10:00]" {
		t.Errorf("snapshots taken = %s, want the kept one, and the newest of the others that day", got)
	}
	list := st.ts.listSnapshots(st.song.ID)
	if list[2].ID != first.ID || !list[2].Kept || list[1].Kept || list[0].Kept {
		t.Errorf("snapshots = %+v, want only the first kept", list)
	}

	expectStatus(t, st.ts.keepSnapshot(st.song.ID, first.ID, false), http.StatusOK)
	if list := st.ts.listSnapshots(st.song.ID); list[2].Kept {
		t.Errorf("snapshot = %+v, want it un-kept", list[2])
	}
	st.takeAt(on(time.December, 31, 13, 0))
	if got := fmt.Sprint(st.taken()); got != "[Dec 31 13:00 Dec 31 12:00 Oct 13 12:00]" {
		t.Errorf("snapshots taken = %s, want the un-kept one thinned like the rest", got)
	}
}

func TestKeepingASnapshotOfAnotherSongIsntFound(t *testing.T) {
	st := newSnapshotTaker(t)
	st.takeAt(on(time.October, 13, 10, 0))
	id := st.ts.listSnapshots(st.song.ID)[0].ID
	other := st.ts.createSong("Other")

	expectStatus(t, st.ts.keepSnapshot(other.ID, id, true), http.StatusNotFound)
	expectStatus(t, st.ts.keepSnapshot(st.song.ID, id+1, true), http.StatusNotFound)
	expectStatus(t, st.ts.Do(http.MethodPatch, fmt.Sprintf("/api/songs/%d/snapshots/%d", st.song.ID, id),
		map[string]any{}), http.StatusBadRequest)
}

func TestKeepingASnapshotLeavesTheSongsVersion(t *testing.T) {
	st := newSnapshotTaker(t)
	st.takeAt(on(time.October, 13, 10, 0))
	before := st.ts.getSong(st.song.ID)

	expectStatus(t, st.ts.keepSnapshot(st.song.ID, st.ts.listSnapshots(st.song.ID)[0].ID, true), http.StatusOK)
	if got := st.ts.getSong(st.song.ID); got.Version != before.Version {
		t.Errorf("version = %d, want %d: keeping a Snapshot doesn't change the Song", got.Version, before.Version)
	}
}
