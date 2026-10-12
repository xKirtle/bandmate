package backups

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"syscall"
	"time"

	"github.com/xKirtle/bandmate/internal/domain"
)

// Period is how often the schedule makes a Scheduled Backup.
type Period string

const (
	Daily   Period = "daily"
	Weekly  Period = "weekly"
	Monthly Period = "monthly"
)

// periodLength is how long each Period is, in months and days, so a monthly
// one ends on the same day of the next month.
var periodLength = map[Period]struct{ months, days int }{
	Daily:   {0, 1},
	Weekly:  {0, 7},
	Monthly: {1, 0},
}

// endsAfter is when a period that starts at t ends.
func (p Period) endsAfter(t time.Time) time.Time {
	l := periodLength[p]
	return t.AddDate(0, l.months, l.days)
}

// The fewest and most Scheduled Backups the schedule can keep.
const (
	MinKeep = 1
	MaxKeep = 30
)

// Schedule is when Scheduled Backups are made, for the whole install: each
// is a Backup of Everything, made once a Period has passed since the
// schedule last made one, unless nothing has changed since, and only the
// newest Keep of them are kept.
type Schedule struct {
	On     bool   `json:"on"`
	Period Period `json:"period"`
	Keep   int    `json:"keep"`
	// Due tells whether a Scheduled Backup is due now, while it's on: when
	// the schedule has never tried to make one, its last try failed, or a
	// Period has passed since its last try that didn't fail.
	// It, and the status below, are ignored when the schedule is set.
	Due bool `json:"due"`
	// LastMadeAt is when the schedule last made a Scheduled Backup, nil if
	// it never has.
	LastMadeAt *time.Time `json:"lastMadeAt"`
	// Last is the schedule's last try at one, nil if it hasn't tried.
	Last *Try `json:"last"`
}

// Outcome is how a try at a Scheduled Backup ended.
type Outcome string

const (
	// Made means it made one.
	Made Outcome = "made"
	// Unchanged means it made none, as no Song or Beat had changed since it
	// last made one.
	Unchanged Outcome = "unchanged"
	// Empty means it made none, as there was no Song and no Beat to back up.
	Empty Outcome = "empty"
	// Failed means it couldn't make one, so it's tried again at the next
	// check.
	Failed Outcome = "failed"
)

// Try is a try at a Scheduled Backup: when, how it ended, and, if it
// failed, why.
type Try struct {
	At      time.Time `json:"at"`
	Outcome Outcome   `json:"outcome"`
	Error   string    `json:"error,omitempty"`
}

// DefaultSchedule is the schedule until it's first set: off.
var DefaultSchedule = Schedule{On: false, Period: Weekly, Keep: 4}

// CheckEvery is how often the schedule is checked for a Scheduled Backup
// that's due, besides at start-up and when the schedule is set.
const CheckEvery = time.Hour

// Schedule returns the schedule Scheduled Backups are made on, whether one
// is due now, and how the last try at one went.
func (s *Store) Schedule(ctx context.Context) (Schedule, error) {
	sch, _, err := s.schedule(ctx)
	return sch, err
}

// lastMade is what a due Scheduled Backup is compared with, to tell whether
// to skip it.
type lastMade struct {
	// empty tells whether there's nothing to back up: no Song and no Beat.
	empty bool
	// there tells whether the Backup the schedule last made, kept or not,
	// hasn't been deleted.
	there bool
	// fingerprint is the fingerprint of what it held, "" if the schedule
	// never made one.
	fingerprint string
}

// schedule returns the schedule, and what a Scheduled Backup due now is
// compared with.
func (s *Store) schedule(ctx context.Context) (sch Schedule, last lastMade, err error) {
	sch = DefaultSchedule
	var lastMadeAt, triedAt, outcome, failure, fingerprint sql.NullString
	err = s.db.QueryRowContext(ctx, `SELECT turned_on, period, keep, last_made_at, tried_at, outcome, failure,
		made_fingerprint, EXISTS (SELECT 1 FROM backups WHERE id = last_made_id),
		NOT EXISTS (SELECT 1 FROM songs) AND NOT EXISTS (SELECT 1 FROM beats)
		FROM backup_schedule WHERE id = 1`).
		Scan(&sch.On, &sch.Period, &sch.Keep, &lastMadeAt, &triedAt, &outcome, &failure,
			&fingerprint, &last.there, &last.empty)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultSchedule, last, nil
	}
	if err != nil {
		return sch, last, fmt.Errorf("reading the backup schedule: %w", err)
	}
	last.fingerprint = fingerprint.String
	if lastMadeAt.Valid {
		t, err := domain.ParseTime(lastMadeAt.String)
		if err != nil {
			return sch, last, err
		}
		sch.LastMadeAt = &t
	}
	if triedAt.Valid {
		t, err := domain.ParseTime(triedAt.String)
		if err != nil {
			return sch, last, err
		}
		sch.Last = &Try{At: t, Outcome: Outcome(outcome.String), Error: failure.String}
	}
	sch.Due = sch.On && (sch.Last == nil || sch.Last.Outcome == Failed ||
		!s.now().Before(sch.Period.endsAfter(sch.Last.At)))
	return sch, last, nil
}

// SetSchedule sets the schedule Scheduled Backups are made on, and returns
// it, saying whether one is due. If one is, it's made at once, in the
// background.
// Neither turning it off nor keeping fewer deletes a Backup: the extras go
// when the next one is made.
func (s *Store) SetSchedule(ctx context.Context, sch Schedule) (Schedule, error) {
	if _, ok := periodLength[sch.Period]; !ok {
		return Schedule{}, domain.Invalid("a schedule is daily, weekly or monthly")
	}
	if sch.Keep < MinKeep || sch.Keep > MaxKeep {
		return Schedule{}, domain.Invalid(fmt.Sprintf("a schedule keeps from %d to %d Scheduled Backups", MinKeep, MaxKeep))
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO backup_schedule (id, turned_on, period, keep) VALUES (1, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET turned_on = excluded.turned_on, period = excluded.period, keep = excluded.keep`,
		sch.On, sch.Period, sch.Keep)
	if err != nil {
		return Schedule{}, fmt.Errorf("setting the backup schedule: %w", err)
	}
	set, err := s.Schedule(ctx)
	if err != nil {
		return set, err
	}
	if set.Due {
		// One wake waiting is enough: the check reads the latest schedule.
		select {
		case s.wake <- struct{}{}:
		default:
		}
	}
	return set, nil
}

// runSchedule checks for a Scheduled Backup that's due at once, then every
// CheckEvery and whenever woken, until the store is closed.
func (s *Store) runSchedule(ctx context.Context) {
	defer close(s.scheduleDone)
	s.CheckSchedule(ctx)
	tick := time.NewTicker(CheckEvery)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		case <-s.wake:
		}
		s.CheckSchedule(ctx)
	}
}

// CheckSchedule makes a Scheduled Backup of Everything if one is due (see
// Schedule.Due). However many periods have passed, it makes one. If there's
// nothing to back up, or no Song or Beat has changed since it last made one
// and that one hasn't been deleted, it makes none, and the next is due a
// period from now. Once one is made, the oldest Scheduled Backups
// beyond the number kept are deleted. A Backup that couldn't be made is
// logged, and tried again at the next check. Each try is recorded, for the
// schedule's status.
func (s *Store) CheckSchedule(ctx context.Context) {
	s.scheduling.Lock()
	defer s.scheduling.Unlock()
	sch, last, err := s.schedule(ctx)
	if err != nil {
		log.Printf("checking for a Scheduled Backup: %v", err)
		return
	}
	if !sch.Due {
		return
	}
	if last.empty {
		log.Printf("made no Scheduled Backup, as there's nothing to back up")
		s.recordTry(ctx, Empty, "")
		return
	}
	failed := func(err error) {
		if ctx.Err() == nil {
			log.Printf("making a Scheduled Backup failed, to be tried again within an hour: %v", err)
			s.recordTry(ctx, Failed, failureReason(err))
		}
	}
	// Worked out before the Backup is made, so a change made meanwhile,
	// which it may miss, makes the next one differ.
	fingerprint, err := s.fingerprint(ctx)
	if err != nil {
		failed(err)
		return
	}
	if last.there && fingerprint == last.fingerprint {
		log.Printf("made no Scheduled Backup, as nothing has changed since the last")
		s.recordTry(ctx, Unchanged, "")
		return
	}
	b, err := s.make(ctx, Contents{AllSongs: true, BeatLibrary: true}, fingerprint)
	if err != nil {
		failed(err)
		return
	}
	log.Printf("made Scheduled Backup %d (%d Songs, %d Beats)", b.ID, b.Songs, b.Beats)
	if err := s.pruneScheduled(ctx); err != nil {
		log.Printf("deleting old Scheduled Backups: %v", err)
	}
}

// recordTry records a try at a Scheduled Backup that made none: when, how it
// ended, and why if it failed. One made is recorded as it's kept.
func (s *Store) recordTry(ctx context.Context, outcome Outcome, failure string) {
	_, err := s.db.ExecContext(ctx, `UPDATE backup_schedule SET tried_at = ?, outcome = ?, failure = NULLIF(?, '')`,
		s.now().UTC().Format(domain.TimeFormat), outcome, failure)
	if err != nil {
		log.Printf("recording the try at a Scheduled Backup: %v", err)
	}
}

// failureReason is why a Scheduled Backup couldn't be made, as the
// schedule's status says it: in words for a full disk, the likeliest thing
// to stop one, and as the error says otherwise.
func failureReason(err error) string {
	if errors.Is(err, syscall.ENOSPC) {
		return "the disk is full"
	}
	return err.Error()
}

// pruneScheduled deletes the oldest Scheduled Backups beyond the number the
// schedule keeps, unless it was turned off meanwhile.
func (s *Store) pruneScheduled(ctx context.Context) error {
	sch, err := s.Schedule(ctx)
	if err != nil || !sch.On {
		return err
	}
	ids, err := queryIDs(ctx, s.db, `SELECT id FROM backups WHERE scheduled
		ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?`, sch.Keep)
	if err != nil {
		return err
	}
	for _, id := range ids {
		// One deleted by hand meanwhile is gone already.
		if err := s.Delete(ctx, id); err != nil && !errors.Is(err, domain.ErrNotFound) {
			return err
		}
	}
	return nil
}
