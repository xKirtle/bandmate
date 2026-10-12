package backups

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
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
// schedule last made one, and only the newest Keep of them are kept.
type Schedule struct {
	On     bool   `json:"on"`
	Period Period `json:"period"`
	Keep   int    `json:"keep"`
	// Due tells whether a Scheduled Backup is due now, while it's on: when
	// the schedule has never made one, or a Period has passed since it last
	// did. It's ignored when the schedule is set.
	Due bool `json:"due"`
}

// DefaultSchedule is the schedule until it's first set: off.
var DefaultSchedule = Schedule{On: false, Period: Weekly, Keep: 4}

// CheckEvery is how often the schedule is checked for a Scheduled Backup
// that's due, besides at start-up and when the schedule is set.
const CheckEvery = time.Hour

// Schedule returns the schedule Scheduled Backups are made on, and whether
// one is due now.
func (s *Store) Schedule(ctx context.Context) (Schedule, error) {
	sch := DefaultSchedule
	var lastMade sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT turned_on, period, keep, last_made_at FROM backup_schedule WHERE id = 1`).
		Scan(&sch.On, &sch.Period, &sch.Keep, &lastMade)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultSchedule, nil
	}
	if err != nil {
		return sch, fmt.Errorf("reading the backup schedule: %w", err)
	}
	var last time.Time
	if lastMade.Valid {
		if last, err = domain.ParseTime(lastMade.String); err != nil {
			return sch, err
		}
	}
	sch.Due = sch.On && (last.IsZero() || !s.now().Before(sch.Period.endsAfter(last)))
	return sch, nil
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

// CheckSchedule makes a Scheduled Backup of Everything if one is due: while
// the schedule is on, when it has never made one, or a period has passed
// since it last made one. However many periods have passed, it makes one.
// Then the oldest Scheduled Backups beyond the number kept are deleted. A
// Backup that couldn't be made is logged, and tried again at the next check.
func (s *Store) CheckSchedule(ctx context.Context) {
	s.scheduling.Lock()
	defer s.scheduling.Unlock()
	sch, err := s.Schedule(ctx)
	if err != nil {
		log.Printf("checking for a Scheduled Backup: %v", err)
		return
	}
	if !sch.Due {
		return
	}
	b, err := s.make(ctx, Contents{AllSongs: true, BeatLibrary: true}, true)
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("making a Scheduled Backup failed, to be tried again within an hour: %v", err)
		}
		return
	}
	log.Printf("made Scheduled Backup %d (%d Songs, %d Beats)", b.ID, b.Songs, b.Beats)
	if err := s.pruneScheduled(ctx); err != nil {
		log.Printf("deleting old Scheduled Backups: %v", err)
	}
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
