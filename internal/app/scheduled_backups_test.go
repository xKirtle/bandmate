package app_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
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
	// Due tells whether a Scheduled Backup is due now, so one is being made;
	// it's left out of what's set, as are the status fields below.
	Due bool `json:"due,omitempty"`
	// LastMadeAt is when the schedule last made a Scheduled Backup.
	LastMadeAt *time.Time `json:"lastMadeAt,omitempty"`
	// Last is the schedule's last try at one, nil if it hasn't tried.
	Last *scheduleTry `json:"last,omitempty"`
}

// scheduleTry is the schedule's last try at a Scheduled Backup.
type scheduleTry struct {
	At time.Time `json:"at"`
	// Outcome is "made", "unchanged" or "failed".
	Outcome string `json:"outcome"`
	// Error is why it failed.
	Error string `json:"error"`
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

// setSchedule sets the schedule, checks it's answered with what was set, and
// returns the answer, which says whether a Scheduled Backup is due.
func (ts *testServer) setSchedule(s backupSchedule) backupSchedule {
	ts.t.Helper()
	res := ts.Do(http.MethodPut, schedulePath, s)
	expectStatus(ts.t, res, http.StatusOK)
	var got backupSchedule
	res.JSON(ts.t, &got)
	if set := (backupSchedule{On: got.On, Period: got.Period, Keep: got.Keep}); set != s {
		ts.t.Fatalf("schedule set = %+v, want %+v", set, s)
	}
	return got
}

func TestTheScheduleSaysWhenTurningItOnMakesOneAtOnce(t *testing.T) {
	clock := newScheduleClock()
	ts := newTestServerWith(t, func(c *app.Config) { c.Now = clock.Now })
	ts.createSong("Night Drive")
	weekly := backupSchedule{On: true, Period: "weekly", Keep: 4}
	off := backupSchedule{On: false, Period: "weekly", Keep: 4}

	if !ts.setSchedule(weekly).Due {
		t.Fatal("turned on for the first time, a Scheduled Backup isn't due")
	}
	ts.waitForBackups(1)
	if ts.schedule().Due {
		t.Error("once one is made, another is due")
	}

	// Turned off and on again within the week: none is made.
	if ts.setSchedule(off).Due {
		t.Error("turned off, a Scheduled Backup is due")
	}
	clock.Advance(6 * 24 * time.Hour)
	if ts.setSchedule(weekly).Due {
		t.Error("turned on again within the week, a Scheduled Backup is due")
	}
	ts.app.CheckBackupSchedule()
	if list := ts.listBackups(); len(list) != 1 {
		t.Errorf("backups = %+v, want still 1", list)
	}

	// A week after the last, with a change since: one is.
	ts.setSchedule(off)
	ts.createSong("Low Tide")
	clock.Advance(24 * time.Hour)
	if !ts.setSchedule(weekly).Due {
		t.Error("turned on a week after the last one, a Scheduled Backup isn't due")
	}
	ts.waitForBackups(2)
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

			ts.createSong("Low Tide")
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

	ts.createSong("Low Tide")
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
	ts.createSong("Low Tide")
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
	for i := range 3 {
		ts.createSong(fmt.Sprintf("Song %d", i))
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
	for i := range 2 {
		ts.createSong(fmt.Sprintf("Song %d", i))
		clock.Advance(24 * time.Hour)
		ts.app.CheckBackupSchedule()
	}

	ts.setSchedule(backupSchedule{On: true, Period: "daily", Keep: 1})
	ts.app.CheckBackupSchedule()
	if list := ts.listBackups(); len(list) != 3 {
		t.Fatalf("after keeping fewer, backups = %+v, want all 3", list)
	}
	ts.setSchedule(backupSchedule{On: false, Period: "daily", Keep: 1})
	ts.createSong("Low Tide")
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

func TestADueScheduledBackupIsSkippedWhenNothingHasChanged(t *testing.T) {
	clock := newScheduleClock()
	ts := scheduledServer(t, clock, backupSchedule{On: true, Period: "weekly", Keep: 4})
	made := clock.Now()

	clock.Advance(7 * 24 * time.Hour)
	ts.app.CheckBackupSchedule()

	if list := ts.listBackups(); len(list) != 1 {
		t.Fatalf("backups = %+v, want still 1", list)
	}
	s := ts.schedule()
	if s.Due || s.Last == nil || s.Last.Outcome != "unchanged" || !s.Last.At.Equal(clock.Now()) ||
		s.LastMadeAt == nil || !s.LastMadeAt.Equal(made) {
		t.Errorf("schedule = %+v, last = %+v, want nothing changed now, since the one made at %v", s, s.Last, made)
	}

	// Nothing is checked again until the next week, change or not.
	ts.createSong("Low Tide")
	clock.Advance(6 * 24 * time.Hour)
	ts.app.CheckBackupSchedule()
	if list := ts.listBackups(); len(list) != 1 {
		t.Fatalf("within the week after nothing had changed, backups = %+v, want still 1", list)
	}
	clock.Advance(24 * time.Hour)
	ts.app.CheckBackupSchedule()
	if list := ts.listBackups(); len(list) != 2 {
		t.Errorf("a week after nothing had changed, with a change since, backups = %+v, want 2", list)
	}
}

func TestAnyChangeToASongOrBeatMakesTheNextScheduledBackup(t *testing.T) {
	for _, c := range []struct {
		name   string
		change func(ts *testServer, song song, beat beat)
	}{
		{"a Song renamed", func(ts *testServer, s song, _ beat) {
			ts.updateSong(s.ID, map[string]any{"title": "Night Drive (demo)"})
		}},
		{"a Song added", func(ts *testServer, _ song, _ beat) { ts.createSong("Low Tide") }},
		{"a Song deleted", func(ts *testServer, s song, _ beat) {
			expectStatus(ts.t, ts.Do(http.MethodDelete, songPath(s.ID), nil), http.StatusNoContent)
		}},
		{"a Section added", func(ts *testServer, s song, _ beat) { ts.addSection(s.ID, map[string]any{"label": "Verse"}) }},
		{"a Beat added", func(ts *testServer, _ song, _ beat) {
			ts.uploadBeat(fakeAudio("low.mp3").with(map[string]any{"title": "Low"}))
		}},
		{"a Beat's details changed", func(ts *testServer, _ song, b beat) {
			expectStatus(ts.t, ts.Do(http.MethodPatch, beatPath(b.ID), map[string]any{"title": "Darker Trap"}), http.StatusOK)
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			clock := newScheduleClock()
			ts := newTestServerWith(t, func(cfg *app.Config) { cfg.Now = clock.Now })
			s := ts.createSong("Night Drive")
			b := ts.uploadBeat(fakeAudio("dark.mp3").with(map[string]any{"title": "Dark Trap"}))
			ts.setSchedule(backupSchedule{On: true, Period: "daily", Keep: 4})
			ts.waitForBackups(1)

			c.change(ts, s, b)
			clock.Advance(24 * time.Hour)
			ts.app.CheckBackupSchedule()

			if list := ts.listBackups(); len(list) != 2 {
				t.Errorf("backups = %+v, want 2", list)
			}
			if last := ts.schedule().Last; last == nil || last.Outcome != "made" || !last.At.Equal(clock.Now()) {
				t.Errorf("last = %+v, want made now", last)
			}
		})
	}
}

func TestTheScheduleSaysWhenItLastMadeOne(t *testing.T) {
	clock := newScheduleClock()
	ts := scheduledServer(t, clock, backupSchedule{On: true, Period: "weekly", Keep: 4})

	s := ts.schedule()
	if s.Last == nil || s.Last.Outcome != "made" || !s.Last.At.Equal(clock.Now()) || s.Last.Error != "" ||
		s.LastMadeAt == nil || !s.LastMadeAt.Equal(clock.Now()) {
		t.Errorf("schedule = %+v, last = %+v, want one made now", s, s.Last)
	}
}

func TestAFailedScheduledBackupIsReportedAndTriedAgainAtTheNextCheck(t *testing.T) {
	clock := newScheduleClock()
	ts := newTestServerWith(t, func(c *app.Config) { c.Now = clock.Now })
	ts.createSong("Night Drive")
	ts.setSchedule(backupSchedule{On: false, Period: "weekly", Keep: 4})
	fixed := ts.failStatements(inserts, "backups")

	ts.setSchedule(backupSchedule{On: true, Period: "weekly", Keep: 4})
	ts.app.CheckBackupSchedule()

	s := ts.schedule()
	if !s.Due || s.Last == nil || s.Last.Outcome != "failed" || !s.Last.At.Equal(clock.Now()) ||
		!strings.Contains(s.Last.Error, "injected fault") || s.LastMadeAt != nil {
		t.Fatalf("schedule = %+v, last = %+v, want still due, having failed now with why", s, s.Last)
	}

	// Still failing an hour later, it says so again.
	clock.Advance(time.Hour)
	ts.app.CheckBackupSchedule()
	if last := ts.schedule().Last; last.Outcome != "failed" || !last.At.Equal(clock.Now()) {
		t.Errorf("last = %+v, want failed again now", last)
	}

	// Once whatever failed is fixed, the next hourly check makes it.
	fixed()
	clock.Advance(time.Hour)
	ts.app.CheckBackupSchedule()
	if list := ts.listBackups(); len(list) != 1 || !list[0].Scheduled {
		t.Errorf("backups = %+v, want the Scheduled Backup", list)
	}
	if last := ts.schedule().Last; last.Outcome != "made" || last.Error != "" {
		t.Errorf("last = %+v, want made, with no error", last)
	}
}

func TestSweepingWhatUndoKeptAtStartUpIsNoChange(t *testing.T) {
	// Undo's leftovers are swept by when they were left, by the real clock.
	clock := &testClock{now: time.Now().UTC()}
	ts := newTestServerWith(t, func(c *app.Config) { c.Now = clock.Now })
	s, _, c := songWithSound(t, ts)
	timelineChange(t, ts.deleteClip(s.ID, c.ID))
	ts.setSchedule(backupSchedule{On: true, Period: "daily", Keep: 4})
	ts.waitForBackups(1)

	ts.Stop()
	clock.Advance(2 * 24 * time.Hour)
	ts = startTestServer(t, ts.DataDir, func(cfg *app.Config) { cfg.Now = clock.Now })
	expectStatus(t, ts.Do(http.MethodGet, soundPath(s.ID, *c.SoundID), nil), http.StatusNotFound)
	// The check at start-up may come before the sweep or after it.
	clock.Advance(2 * 24 * time.Hour)
	ts.app.CheckBackupSchedule()

	if list := ts.listBackups(); len(list) != 1 {
		t.Errorf("backups = %+v, want still 1, as the Sound swept is in none", list)
	}
}
