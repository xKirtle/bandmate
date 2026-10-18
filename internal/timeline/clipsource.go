package timeline

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/domain"
)

// What a Clip being placed plays is read and checked before the pure edit
// places it (edit.go): the Timeline only holds the Beats and Sounds its
// Clips already play, and a Clip's detached Takes aren't on it at all. The
// edit is handed the rows, so it only works out placement.

// clipSource is what a new Clip is to play, already read and checked: a
// Beat, one of the Song's Sounds, or Takes of the Song, the active one
// among them.
type clipSource struct {
	beat  *Beat
	sound *Sound
	// takes are a Clip of Takes' Takes, in the order they're numbered, and
	// activeTakeID the one of them it plays.
	takes        []Take
	activeTakeID *int64
}

// readClipSource reads and checks what a new Clip is to play: a Beat in the
// Beat Library, one of the Song's Sounds, or detached Takes of the Song,
// the active one among them.
func readClipSource(ctx context.Context, tx *sql.Tx, songID int64, c NewClip) (clipSource, error) {
	given := 0
	for _, g := range []bool{c.BeatID != nil, c.SoundID != nil, len(c.TakeIDs) > 0} {
		if g {
			given++
		}
	}
	switch {
	case given != 1:
		return clipSource{}, domain.Invalid("a Clip plays one of a Beat, a Sound or Takes")
	case c.BeatID != nil:
		beat, err := readBeat(ctx, tx, *c.BeatID)
		if err != nil {
			return clipSource{}, err
		}
		return clipSource{beat: &beat}, nil
	case c.SoundID != nil:
		sound, err := readSound(ctx, tx, songID, *c.SoundID)
		if err != nil {
			return clipSource{}, err
		}
		return clipSource{sound: &sound}, nil
	}
	if c.ActiveTakeID == nil || !slices.Contains(c.TakeIDs, *c.ActiveTakeID) {
		return clipSource{}, domain.Invalid("a Clip of Takes plays one of them")
	}
	takes, err := readTakes(ctx, tx, songID, 0, c.TakeIDs)
	if err != nil {
		return clipSource{}, err
	}
	return clipSource{takes: takes, activeTakeID: c.ActiveTakeID}, nil
}

// clip is a new Clip, with the id given, playing src as c asks.
func (src clipSource) clip(clipID int64, c NewClip) Clip {
	placed := Clip{ID: clipID, Name: c.Name, ClipPlayback: c.ClipPlayback, Takes: []Take{},
		Start: c.Start, Offset: c.Offset, Length: c.Length}
	switch {
	case src.beat != nil:
		placed.BeatID = &src.beat.ID
	case src.sound != nil:
		placed.SoundID = &src.sound.ID
	default:
		placed.Takes, placed.ActiveTakeID = src.takes, src.activeTakeID
	}
	return placed
}

// playing is tl holding the Beat or the Sound src plays, so the placement
// rules can measure how long the source is. The Timeline leaves out a Beat
// or a Sound no Clip plays.
func (tl Timeline) playing(src clipSource) Timeline {
	switch {
	case src.beat != nil:
		if !slices.ContainsFunc(tl.Beats, func(b Beat) bool { return b.ID == src.beat.ID }) {
			tl.Beats = append(slices.Clone(tl.Beats), *src.beat)
		}
	case src.sound != nil:
		if !slices.ContainsFunc(tl.Sounds, func(s Sound) bool { return s.ID == src.sound.ID }) {
			tl.Sounds = append(slices.Clone(tl.Sounds), *src.sound)
		}
	}
	return tl
}

// readBeat reads a Beat of the Beat Library, as a Clip plays it.
func readBeat(ctx context.Context, tx *sql.Tx, beatID int64) (Beat, error) {
	var b Beat
	var bpm sql.NullInt64
	err := tx.QueryRowContext(ctx, `SELECT id, title, bpm, file_name, size, duration FROM beats WHERE id = ?`,
		beatID).Scan(&b.ID, &b.Title, &bpm, &b.FileName, &b.Size, &b.Duration)
	if errors.Is(err, sql.ErrNoRows) {
		return Beat{}, domain.Invalid("there's no such Beat in the Beat Library")
	}
	if err != nil {
		return Beat{}, fmt.Errorf("reading beat: %w", err)
	}
	if bpm.Valid {
		n := int(bpm.Int64)
		b.BPM = &n
	}
	return b, nil
}

// readSound reads one of the Song's Sounds, as a Clip plays it.
func readSound(ctx context.Context, tx *sql.Tx, songID, soundID int64) (Sound, error) {
	var s Sound
	err := tx.QueryRowContext(ctx, `SELECT id, name, file_name, size, duration FROM sounds
		WHERE id = ? AND song_id = ?`, soundID, songID).Scan(&s.ID, &s.Name, &s.FileName, &s.Size, &s.Duration)
	if errors.Is(err, sql.ErrNoRows) {
		return Sound{}, domain.Invalid("there's no such Sound in this Song")
	}
	if err != nil {
		return Sound{}, fmt.Errorf("reading sound: %w", err)
	}
	return s, nil
}

// readTakes reads Takes of the Song to go in a Clip (0 for a new one), each
// once, as checkTakes checks them: each must be detached or in that Clip
// already. They come back in the order they're numbered, as the Timeline
// holds them.
func readTakes(ctx context.Context, tx *sql.Tx, songID, clipID int64, ids []int64) ([]Take, error) {
	in, err := takesOfSong(ctx, tx, songID, ids)
	if err != nil {
		return nil, err
	}
	takes := make([]Take, 0, len(ids))
	for i, id := range ids {
		if in[i].Valid && in[i].Int64 != clipID {
			return nil, domain.Conflict("a Take can only be in one Clip")
		}
		take, err := scanTake(tx.QueryRowContext(ctx, `SELECT `+takeColumns+` FROM takes WHERE id = ?`, id))
		if err != nil {
			return nil, fmt.Errorf("reading take: %w", err)
		}
		takes = append(takes, take)
	}
	slices.SortStableFunc(takes, func(a, b Take) int {
		return cmp.Or(cmp.Compare(a.Number, b.Number), cmp.Compare(a.ID, b.ID))
	})
	return takes, nil
}

// copyTakesOf adds a detached copy of each of a Clip of Takes' Takes,
// sharing its file, linked by changes once committed, and returns the
// copies as the Clip's copy holds them, and the id of the copy of the Take
// it plays. A Clip that has no Takes gets none.
func (s *Store) copyTakesOf(ctx context.Context, tx *sql.Tx, changes *audio.FileChanges, c Clip) ([]Take, *int64, error) {
	if c.ActiveTakeID == nil {
		return []Take{}, nil, nil
	}
	ids := make([]int64, len(c.Takes))
	for i, take := range c.Takes {
		ids[i] = take.ID
	}
	copies, err := s.copyTakes(ctx, tx, changes, ids)
	if err != nil {
		return nil, nil, err
	}
	takes := make([]Take, len(c.Takes))
	for i, take := range c.Takes {
		takes[i] = take
		takes[i].ID = copies[take.ID]
	}
	active := copies[*c.ActiveTakeID]
	return takes, &active, nil
}
