package timeline

import (
	"context"
	"database/sql"
	"fmt"
	"slices"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// Every change to a Song's Tracks and Clips is a pure change to the whole
// Timeline, checked by checkLayout (ADR 0023) and written by writeTimeline,
// as every change to a Lyric Sheet is (ADR 0024), so no operation says
// anything about the order its rows are written in, and none writes those
// rows itself (ADR 0025). The one change outside the path is the Loop,
// which is the Song's own rather than a Track's or a Clip's (changeLoop).
//
// What a change brings with it is still read and written here, before the
// pure part: a Take recorded with its audio, a Sound imported, and the
// copies a Duplicate or a paste makes of a Clip of Takes' Takes. The pure
// edit is handed those rows and only works out placement; the writer puts
// each Take in its Clip and where its span starts it.

// edit is a pure change to the whole Timeline: it's handed a copy to change
// as it likes, and ids for any rows it adds, and returns the Timeline it
// leaves. It reads nothing, so it's table-tested on plain Timeline values.
type edit func(tl Timeline, ids *ids) (Timeline, error)

// editTimeline makes one change to a Song's Timeline, as every Clip
// placement change is made: it loads the whole Timeline, runs edit on a
// copy of it, checks the Timeline that leaves against the placement rules,
// writes it, and returns it as stored.
func (s *Store) editTimeline(ctx context.Context, songID int64, based songversion.Version,
	change edit) (Timeline, error) {
	return s.editTimelineReading(ctx, songID, based, always(change))
}

// always is a prepare that reads nothing and makes the change given.
func always(change edit) func(context.Context, *sql.Tx, *audio.FileChanges, Timeline) (edit, error) {
	return func(context.Context, *sql.Tx, *audio.FileChanges, Timeline) (edit, error) {
		return change, nil
	}
}

// editTimelineReading is editTimeline for a change that reads rows of its
// own first: the Beat, the Sound or the Takes a Clip it places plays, which
// the Timeline doesn't hold until a Clip plays them, the copies of a Clip of
// Takes' Takes, with their files, and a Take just recorded, with its audio.
// prepare reads and checks them within the change, and returns the pure
// edit that places them, so the pure part only works out placement.
func (s *Store) editTimelineReading(ctx context.Context, songID int64, based songversion.Version,
	prepare func(ctx context.Context, tx *sql.Tx, changes *audio.FileChanges, before Timeline) (edit, error)) (Timeline, error) {
	var tl Timeline
	if err := songversion.Change(ctx, s.db, songID, based, func(tx *sql.Tx, changes *audio.FileChanges) error {
		before, err := read(ctx, tx, songID)
		if err != nil {
			return err
		}
		change, err := prepare(ctx, tx, changes, before)
		if err != nil {
			return err
		}
		newIDs, err := storedIDs(ctx, tx)
		if err != nil {
			return err
		}
		after, err := change(cloneTimeline(before), newIDs)
		if err != nil {
			return err
		}
		if v := checkLayout(before, after); v != nil {
			return v.err()
		}
		if err := writeTimeline(ctx, tx, songID, after); err != nil {
			return err
		}
		// A change can leave Takes out of their Clips, and a Sound unused,
		// or, by undo, use it again.
		if err := markDetached(ctx, tx, songID); err != nil {
			return err
		}
		if err := markUnusedSounds(ctx, tx, songID); err != nil {
			return err
		}
		tl, err = read(ctx, tx, songID)
		return err
	}); err != nil {
		return Timeline{}, err
	}
	return tl, nil
}

// timelineTables are the tables a Timeline's own rows are in. Takes are
// added with their audio, by the operations that record or copy them, so
// their ids aren't handed out here.
var timelineTables = []string{"tracks", "clips"}

// ids hands out the ids of the rows a change to the Timeline adds, each one
// past the last its table handed out, so writeTimeline inserts them as they
// are. Every row a Clip placement edit adds takes its id from here, even one
// bringing a deleted Clip or Track back, which comes back as a new one, so
// the Timeline never holds an id another Song's row could hold.
//
// Its zero value is a plain counter from 1, for tests.
type ids struct {
	last map[string]int64
}

func (i *ids) next(table string) int64 {
	if i.last == nil {
		i.last = map[string]int64{}
	}
	i.last[table]++
	return i.last[table]
}

func (i *ids) track() int64 { return i.next("tracks") }
func (i *ids) clip() int64  { return i.next("clips") }

// storedIDs is ids that count up from each Timeline table's last-used id,
// held by a row now or not. The tables are AUTOINCREMENT, so an id is never
// used twice.
func storedIDs(ctx context.Context, tx *sql.Tx) (*ids, error) {
	last := map[string]int64{}
	for _, table := range timelineTables {
		var id int64
		if err := tx.QueryRowContext(ctx, `SELECT MAX(
			COALESCE((SELECT MAX(id) FROM `+table+`), 0),
			COALESCE((SELECT seq FROM sqlite_sequence WHERE name = ?), 0))`, table).Scan(&id); err != nil {
			return nil, fmt.Errorf("reading the last id of %s: %w", table, err)
		}
		last[table] = id
	}
	return &ids{last: last}, nil
}

// cloneTimeline is a copy of a Timeline sharing nothing with it, so a
// change to one leaves the other as it was.
func cloneTimeline(tl Timeline) Timeline {
	clone := tl
	clone.Beats = slices.Clone(tl.Beats)
	clone.Sounds = slices.Clone(tl.Sounds)
	clone.Tracks = slices.Clone(tl.Tracks)
	for i := range clone.Tracks {
		t := &clone.Tracks[i]
		t.Clips = slices.Clone(t.Clips)
		for j, c := range t.Clips {
			t.Clips[j] = cloneClip(c)
		}
	}
	if tl.Loop != nil {
		loop := *tl.Loop
		clone.Loop = &loop
	}
	return clone
}

// cloneClip is a copy of a Clip sharing nothing with it.
func cloneClip(c Clip) Clip {
	c.Takes = slices.Clone(c.Takes)
	for i := range c.Takes {
		c.Takes[i].Peaks = slices.Clone(c.Takes[i].Peaks)
	}
	c.BeatID, c.SoundID, c.ActiveTakeID = copyID(c.BeatID), copyID(c.SoundID), copyID(c.ActiveTakeID)
	if c.Name != nil {
		name := *c.Name
		c.Name = &name
	}
	return c
}

// copyID is a copy of one of a Clip's optional ids, nil for none.
func copyID(id *int64) *int64 {
	if id == nil {
		return nil
	}
	copied := *id
	return &copied
}
