package timeline

import (
	"context"
	"database/sql"
	"fmt"
)

// storedTrack is a Track's row as stored, for the Song it belongs to.
type storedTrack struct {
	name string
	// position is its place from the top of the Timeline.
	position int64
	volume   float64
	muted    bool
	soloed   bool
}

// storedClip is a Clip's row as stored.
type storedClip struct {
	trackID int64
	// beatID is the Beat it plays, or soundID the Sound, or activeTakeID
	// the Take; exactly one is set.
	beatID  sql.NullInt64
	soundID sql.NullInt64
	// name is null for a Clip that isn't named.
	name sql.NullString
	ClipPlayback
	activeTakeID          sql.NullInt64
	start, offset, length float64
}

// storedTake is as much of a Take's row as a Timeline change writes: which
// Clip it's in, if any, and where it starts in that Clip's source span. A
// Take's audio, how it was recorded and its number are written once, by the
// operation that records or copies it. A Take in a Clip is never detached,
// so writing one in puts it back in use (markDetached stamps those left
// out).
type storedTake struct {
	clipID   sql.NullInt64
	position float64
	nudge    float64
}

// writeTimeline makes a Song's stored Tracks, Clips and Takes the Timeline
// tl, writing only the rows that differ: it inserts the rows tl adds, with
// their ids, updates those it changes, takes the Takes it leaves out of
// their Clips, and deletes the Clips and Tracks it doesn't hold. It writes
// exactly the Timeline it's given, so the order an operation built it in
// never matters, and tl must have been checked by checkLayout first.
func writeTimeline(ctx context.Context, tx *sql.Tx, songID int64, tl Timeline) error {
	tracks, clips, takes, err := readStoredRows(ctx, tx, songID)
	if err != nil {
		return err
	}

	// Tracks first, so a Clip can go on one tl adds, and Clips before
	// Takes, so a Take can go in a Clip it adds.
	for i, t := range tl.Tracks {
		want := storedTrack{name: t.Name, position: int64(i), volume: t.Volume, muted: t.Muted, soloed: t.Soloed}
		was, there := tracks[t.ID]
		delete(tracks, t.ID)
		switch {
		case !there:
			_, err = tx.ExecContext(ctx, `INSERT INTO tracks (id, song_id, name, position, volume, muted, soloed)
				VALUES (?, ?, ?, ?, ?, ?, ?)`, t.ID, songID, want.name, want.position, want.volume, want.muted, want.soloed)
		case want != was:
			_, err = tx.ExecContext(ctx, `UPDATE tracks SET name = ?, position = ?, volume = ?, muted = ?, soloed = ?
				WHERE id = ?`, want.name, want.position, want.volume, want.muted, want.soloed, t.ID)
		}
		if err != nil {
			return fmt.Errorf("writing track: %w", err)
		}
	}

	for _, t := range tl.Tracks {
		for _, c := range t.Clips {
			want := storedClipOf(t.ID, c)
			was, there := clips[c.ID]
			delete(clips, c.ID)
			switch {
			case !there:
				_, err = tx.ExecContext(ctx, `INSERT INTO clips (id, track_id, beat_id, sound_id, name,
						gain, tempo, pitch, fade_in, fade_out, active_take_id, start, source_offset, length)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					c.ID, want.trackID, want.beatID, want.soundID, want.name, want.Gain, want.Tempo, want.Pitch,
					want.FadeIn, want.FadeOut, want.activeTakeID, want.start, want.offset, want.length)
			case want != was:
				_, err = tx.ExecContext(ctx, `UPDATE clips SET track_id = ?, beat_id = ?, sound_id = ?, name = ?,
						gain = ?, tempo = ?, pitch = ?, fade_in = ?, fade_out = ?, active_take_id = ?,
						start = ?, source_offset = ?, length = ? WHERE id = ?`,
					want.trackID, want.beatID, want.soundID, want.name, want.Gain, want.Tempo, want.Pitch,
					want.FadeIn, want.FadeOut, want.activeTakeID, want.start, want.offset, want.length, c.ID)
			}
			if err != nil {
				return fmt.Errorf("writing clip: %w", err)
			}
		}
	}

	for _, t := range tl.Tracks {
		for _, c := range t.Clips {
			for _, take := range c.Takes {
				want := storedTake{clipID: sql.NullInt64{Int64: c.ID, Valid: true},
					position: take.Position, nudge: take.Nudge}
				was, there := takes[take.ID]
				delete(takes, take.ID)
				if !there {
					// A Take's row is written once, with its audio, before
					// an edit places it, so this is a bug, not a refusal.
					return fmt.Errorf("take %d isn't one of the Song's", take.ID)
				}
				if want == was {
					continue
				}
				if _, err := tx.ExecContext(ctx, `UPDATE takes SET clip_id = ?, position = ?, nudge = ?,
						detached_at = NULL WHERE id = ?`, want.clipID, want.position, want.nudge, take.ID); err != nil {
					return fmt.Errorf("writing take: %w", err)
				}
			}
		}
	}

	// The Takes left aren't in a Clip of tl, so those in one leave it, to be
	// placed again. markDetached notes when they left.
	for id, was := range takes {
		if !was.clipID.Valid {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE takes SET clip_id = NULL WHERE id = ?`, id); err != nil {
			return fmt.Errorf("taking take out of its clip: %w", err)
		}
	}

	// The Clips and Tracks left aren't in tl. Clips go first, so deleting a
	// Track only cascades to Clips going too.
	for id := range clips {
		if _, err := tx.ExecContext(ctx, `DELETE FROM clips WHERE id = ?`, id); err != nil {
			return fmt.Errorf("deleting clip: %w", err)
		}
	}
	for id := range tracks {
		if _, err := tx.ExecContext(ctx, `DELETE FROM tracks WHERE id = ?`, id); err != nil {
			return fmt.Errorf("deleting track: %w", err)
		}
	}
	return nil
}

// storedClipOf is c, on the Track with the id given, as its row is stored:
// its name trimmed, and a start or offset rounded a hair before 0:00 taken
// as 0:00, which the database won't hold.
func storedClipOf(trackID int64, c Clip) storedClip {
	return storedClip{
		trackID:      trackID,
		beatID:       nullID(c.BeatID),
		soundID:      nullID(c.SoundID),
		name:         clipName(c.Name),
		ClipPlayback: c.ClipPlayback,
		activeTakeID: nullID(c.ActiveTakeID),
		start:        roundedToZero(c.Start),
		offset:       roundedToZero(c.Offset),
		length:       c.Length,
	}
}

// readStoredRows reads the rows of a Song's Timeline as stored, by id: its
// Tracks, their Clips, and its Takes, in a Clip or detached.
func readStoredRows(ctx context.Context, tx *sql.Tx, songID int64) (map[int64]storedTrack,
	map[int64]storedClip, map[int64]storedTake, error) {
	tracks := map[int64]storedTrack{}
	err := query(ctx, tx, `SELECT id, name, position, volume, muted, soloed FROM tracks WHERE song_id = ?`,
		[]any{songID}, func(rows *sql.Rows) error {
			var id int64
			var t storedTrack
			err := rows.Scan(&id, &t.name, &t.position, &t.volume, &t.muted, &t.soloed)
			tracks[id] = t
			return err
		})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("reading tracks: %w", err)
	}
	clips := map[int64]storedClip{}
	err = query(ctx, tx, `SELECT c.id, c.track_id, c.beat_id, c.sound_id, c.name, c.gain, c.tempo, c.pitch,
			c.fade_in, c.fade_out, c.active_take_id, c.start, c.source_offset, c.length
		FROM clips c JOIN tracks t ON t.id = c.track_id WHERE t.song_id = ?`,
		[]any{songID}, func(rows *sql.Rows) error {
			var id int64
			var c storedClip
			err := rows.Scan(&id, &c.trackID, &c.beatID, &c.soundID, &c.name, &c.Gain, &c.Tempo, &c.Pitch,
				&c.FadeIn, &c.FadeOut, &c.activeTakeID, &c.start, &c.offset, &c.length)
			clips[id] = c
			return err
		})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("reading clips: %w", err)
	}
	takes := map[int64]storedTake{}
	err = query(ctx, tx, `SELECT id, clip_id, position, nudge FROM takes WHERE song_id = ?`,
		[]any{songID}, func(rows *sql.Rows) error {
			var id int64
			var t storedTake
			err := rows.Scan(&id, &t.clipID, &t.position, &t.nudge)
			takes[id] = t
			return err
		})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("reading takes: %w", err)
	}
	return tracks, clips, takes, nil
}
