package app_test

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
)

// backupSchedule is the schedule Scheduled Backups are made on, as the API
// tells it.
type backupSchedule struct {
	On     bool   `json:"on"`
	Period string `json:"period"`
	Keep   int    `json:"keep"`
}

const schedulePath = "/api/backups/schedule"

func (ts *testServer) schedule() backupSchedule {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, schedulePath, nil)
	expectStatus(ts.t, res, http.StatusOK)
	var s backupSchedule
	res.JSON(ts.t, &s)
	return s
}

// setSchedule sets the schedule, and checks it's answered with what was set.
func (ts *testServer) setSchedule(s backupSchedule) {
	ts.t.Helper()
	res := ts.Do(http.MethodPut, schedulePath, s)
	expectStatus(ts.t, res, http.StatusOK)
	var got backupSchedule
	res.JSON(ts.t, &got)
	if got != s {
		ts.t.Fatalf("schedule set = %+v, want %+v", got, s)
	}
}

// waitForBackups waits, as a user would watch the list, until n Backups are
// listed, and returns them, failing the test if they aren't within seconds.
func (ts *testServer) waitForBackups(n int) []backup {
	ts.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		list := ts.listBackups()
		if len(list) == n {
			return list
		}
		if time.Now().After(deadline) {
			ts.t.Fatalf("backups = %+v, want %d", list, n)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// scheduledServer starts a server on clock, holding a Song, with the
// schedule turned on as s, and waits for the Scheduled Backup that makes
// at once.
func scheduledServer(t *testing.T, clock *testClock, s backupSchedule) *testServer {
	t.Helper()
	ts := newTestServerWith(t, func(c *app.Config) { c.Now = clock.Now })
	ts.createSong("Night Drive")
	ts.setSchedule(s)
	ts.waitForBackups(1)
	return ts
}

func newScheduleClock() *testClock {
	return &testClock{now: time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)}
}

// scheduledIDs lists the Scheduled Backups' ids, newest first.
func scheduledIDs(list []backup) []int64 {
	var ids []int64
	for _, b := range list {
		if b.Scheduled {
			ids = append(ids, b.ID)
		}
	}
	return ids
}

func TestTheBackupScheduleIsOffOnANewInstall(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Night Drive")

	if got, want := ts.schedule(), (backupSchedule{On: false, Period: "weekly", Keep: 4}); got != want {
		t.Errorf("schedule = %+v, want %+v", got, want)
	}
	ts.app.CheckBackupSchedule()
	if list := ts.listBackups(); len(list) != 0 {
		t.Errorf("backups = %+v, want none", list)
	}
}

func TestTheBackupScheduleIsKeptAcrossRestarts(t *testing.T) {
	ts := newTestServer(t)
	ts.setSchedule(backupSchedule{On: false, Period: "monthly", Keep: 12})

	ts.Stop()
	again := startTestServer(t, ts.DataDir)

	if got, want := again.schedule(), (backupSchedule{On: false, Period: "monthly", Keep: 12}); got != want {
		t.Errorf("schedule = %+v, want %+v", got, want)
	}
}

func TestABackupScheduleOutsideItsChoicesIsRefused(t *testing.T) {
	ts := newTestServer(t)

	for _, s := range []backupSchedule{
		{On: true, Period: "hourly", Keep: 4},
		{On: true, Period: "", Keep: 4},
		{On: true, Period: "weekly", Keep: 0},
		{On: true, Period: "weekly", Keep: 31},
	} {
		res := ts.Do(http.MethodPut, schedulePath, s)
		expectStatus(t, res, http.StatusBadRequest)
	}
	if got, want := ts.schedule(), (backupSchedule{On: false, Period: "weekly", Keep: 4}); got != want {
		t.Errorf("schedule = %+v, want it unchanged, %+v", got, want)
	}
}

func TestTurningTheScheduleOnMakesAScheduledBackupOfEverythingAtOnce(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Night Drive")
	ts.createSong("Low Tide")
	ts.uploadBeat(fakeAudio("dark.mp3").with(map[string]any{"title": "Dark Trap"}))

	ts.setSchedule(backupSchedule{On: true, Period: "weekly", Keep: 4})

	b := ts.waitForBackups(1)[0]
	if !b.Scheduled || !b.AllSongs || !b.BeatLibrary || b.Songs != 2 || b.Beats != 1 {
		t.Errorf("backup = %+v, want a Scheduled Backup of Everything: 2 Songs and 1 Beat", b)
	}
}

func TestTheNextScheduledBackupIsMadeOnceAPeriodHasPassed(t *testing.T) {
	for _, c := range []struct {
		period string
		after  time.Duration
	}{
		{"daily", 24 * time.Hour},
		{"weekly", 7 * 24 * time.Hour},
		// From 12 October to 12 November.
		{"monthly", 31 * 24 * time.Hour},
	} {
		t.Run(c.period, func(t *testing.T) {
			clock := newScheduleClock()
			ts := scheduledServer(t, clock, backupSchedule{On: true, Period: c.period, Keep: 4})

			clock.Advance(c.after - time.Minute)
			ts.app.CheckBackupSchedule()
			if list := ts.listBackups(); len(list) != 1 {
				t.Fatalf("a minute before the period has passed, backups = %+v, want 1", list)
			}
			clock.Advance(time.Minute)
			ts.app.CheckBackupSchedule()
			list := ts.listBackups()
			if len(list) != 2 || !list[0].Scheduled {
				t.Fatalf("once the period has passed, backups = %+v, want 2, the newest scheduled", list)
			}
		})
	}
}

func TestOnlyOneScheduledBackupIsMadeAfterALongGap(t *testing.T) {
	clock := newScheduleClock()
	ts := scheduledServer(t, clock, backupSchedule{On: true, Period: "daily", Keep: 10})

	clock.Advance(30 * 24 * time.Hour)
	ts.app.CheckBackupSchedule()
	ts.app.CheckBackupSchedule()

	if list := ts.listBackups(); len(list) != 2 {
		t.Errorf("backups = %+v, want 2: one made after the gap", list)
	}
}

func TestAScheduledBackupThatCameDueWhileBandmateWasOffIsMadeAtStartUp(t *testing.T) {
	clock := newScheduleClock()
	ts := scheduledServer(t, clock, backupSchedule{On: true, Period: "weekly", Keep: 4})
	ts.Stop()

	clock.Advance(8 * 24 * time.Hour)
	again := startTestServer(t, ts.DataDir, func(c *app.Config) { c.Now = clock.Now })

	again.waitForBackups(2)
}

func TestScheduledBackupsBeyondThoseKeptAreDeletedOldestFirst(t *testing.T) {
	clock := newScheduleClock()
	elsewhere := newTestServer(t)
	elsewhere.createSong("From Elsewhere")
	ts := scheduledServer(t, clock, backupSchedule{On: true, Period: "daily", Keep: 2})
	handMade := ts.backUp(map[string]any{"allSongs": true})
	uploaded := ts.uploadFrom(elsewhere, elsewhere.backUp(map[string]any{"allSongs": true}))
	first := scheduledIDs(ts.listBackups())[0]

	var made []int64
	for range 3 {
		clock.Advance(24 * time.Hour)
		ts.app.CheckBackupSchedule()
		made = append([]int64{scheduledIDs(ts.listBackups())[0]}, made...)
	}

	list := ts.listBackups()
	if got, want := scheduledIDs(list), made[:2]; !slices.Equal(got, want) {
		t.Errorf("scheduled backups = %v, want the newest two, %v (first was %d)", got, want, first)
	}
	for _, kept := range []backup{handMade, uploaded} {
		if !slices.ContainsFunc(list, func(b backup) bool { return b.ID == kept.ID && !b.Scheduled }) {
			t.Errorf("backup %d, not scheduled, was deleted or marked; backups = %+v", kept.ID, list)
		}
	}
}

func TestTurningTheScheduleOffOrKeepingFewerDeletesNothing(t *testing.T) {
	clock := newScheduleClock()
	ts := scheduledServer(t, clock, backupSchedule{On: true, Period: "daily", Keep: 3})
	for range 2 {
		clock.Advance(24 * time.Hour)
		ts.app.CheckBackupSchedule()
	}

	ts.setSchedule(backupSchedule{On: true, Period: "daily", Keep: 1})
	ts.app.CheckBackupSchedule()
	if list := ts.listBackups(); len(list) != 3 {
		t.Fatalf("after keeping fewer, backups = %+v, want all 3", list)
	}
	ts.setSchedule(backupSchedule{On: false, Period: "daily", Keep: 1})
	clock.Advance(24 * time.Hour)
	ts.app.CheckBackupSchedule()
	if list := ts.listBackups(); len(list) != 3 {
		t.Fatalf("after turning it off, backups = %+v, want all 3 and none made", list)
	}

	// The extras go with the next one made.
	ts.setSchedule(backupSchedule{On: true, Period: "daily", Keep: 1})
	ts.app.CheckBackupSchedule()
	if list := ts.waitForBackups(1); !list[0].Scheduled {
		t.Errorf("backups = %+v, want only the one just made", list)
	}
}

func TestBackupsMadeByHandOrUploadedAreNotScheduled(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Night Drive")

	made := ts.backUp(map[string]any{"allSongs": true})
	uploaded := ts.uploadFrom(ts, made)

	if made.Scheduled || uploaded.Scheduled {
		t.Errorf("made = %+v, uploaded = %+v, want neither scheduled", made, uploaded)
	}
}
