// Package timeline owns a Song's Timeline: its Tracks and the Clips on them.
// All its rules live here; the HTTP layer only maps requests onto these
// operations. Every change marks the Song as edited and returns the full,
// updated Timeline.
package timeline

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// Timeline is a Song's audio space, measured in seconds.
type Timeline struct {
	SongID int64 `json:"songId"`
	// Version and UpdatedAt are the Song's, which every Timeline change
	// moves on.
	Version   lyricsheet.Version `json:"version"`
	UpdatedAt time.Time          `json:"updatedAt"`
	// Tracks are top to bottom.
	Tracks []Track `json:"tracks"`
	// Beats are the Beats the Clips play, each once, without their peaks.
	Beats []Beat `json:"beats"`
}

// Track is a named lane on the Timeline holding Clips, with its own volume,
// mute and solo.
type Track struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	// Volume is in dB, from Silence to MaxVolume.
	Volume float64 `json:"volume"`
	Muted  bool    `json:"muted"`
	// Soloed Tracks are the only ones heard, when there are any.
	Soloed bool `json:"soloed"`
	// Clips are in the order they start, and never overlap.
	Clips []Clip `json:"clips"`
}

// Clip is a stretch of a Beat placed on a Track. Trimming it never changes
// the Beat's file.
type Clip struct {
	ID     int64 `json:"id"`
	BeatID int64 `json:"beatId"`
	// Start is where the Clip starts on the Timeline, Offset where in the
	// Beat it starts playing, and Length how long it plays, all in seconds.
	Start  float64 `json:"start"`
	Offset float64 `json:"offset"`
	Length float64 `json:"length"`
}

// Beat is what playing a Clip needs to know about its Beat.
type Beat struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
	BPM   *int   `json:"bpm"`
	// FileName, Size and Duration (in seconds) tell the audio file's
	// versions apart.
	FileName string  `json:"fileName"`
	Size     int64   `json:"size"`
	Duration float64 `json:"duration"`
}

// Silence is a Track's lowest volume, in dB, at which it isn't heard at all.
// MaxVolume is its highest.
const (
	Silence   = -60.0
	MaxVolume = 6.0
)

// timeFormat is how songs.updated_at is stored.
const timeFormat = "2006-01-02T15:04:05.000000000Z"

// beatTrackName is the name of the Track a Song's first Beat goes on.
const beatTrackName = "Beat"

// Store reads and changes Timelines.
type Store struct {
	db *sql.DB
}

// NewStore returns a Store backed by db.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Get returns a Song's Timeline.
func (s *Store) Get(ctx context.Context, songID int64) (Timeline, error) {
	// Read in one transaction, so the version matches what's read with it.
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return Timeline{}, err
	}
	defer tx.Rollback()
	return read(ctx, tx, songID)
}

// read returns a Song's Timeline as tx sees it.
func read(ctx context.Context, tx *sql.Tx, songID int64) (Timeline, error) {
	tl := Timeline{SongID: songID, Tracks: []Track{}, Beats: []Beat{}}
	var updated string
	err := tx.QueryRowContext(ctx, `SELECT version, updated_at FROM songs WHERE id = ?`, songID).
		Scan(&tl.Version, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Timeline{}, lyricsheet.ErrNotFound
	}
	if err != nil {
		return Timeline{}, fmt.Errorf("reading song: %w", err)
	}
	if tl.UpdatedAt, err = time.Parse(timeFormat, updated); err != nil {
		return Timeline{}, fmt.Errorf("parsing stored time %q: %w", updated, err)
	}

	trackAt := map[int64]int{}
	err = query(ctx, tx, `SELECT id, name, volume, muted, soloed FROM tracks
		WHERE song_id = ? ORDER BY position, id`, []any{songID},
		func(rows *sql.Rows) error {
			t := Track{Clips: []Clip{}}
			if err := rows.Scan(&t.ID, &t.Name, &t.Volume, &t.Muted, &t.Soloed); err != nil {
				return err
			}
			trackAt[t.ID] = len(tl.Tracks)
			tl.Tracks = append(tl.Tracks, t)
			return nil
		})
	if err != nil {
		return Timeline{}, fmt.Errorf("reading tracks: %w", err)
	}

	err = query(ctx, tx, `SELECT c.id, c.track_id, c.beat_id, c.start, c.source_offset, c.length
		FROM clips c JOIN tracks t ON t.id = c.track_id
		WHERE t.song_id = ? ORDER BY c.start, c.id`, []any{songID},
		func(rows *sql.Rows) error {
			var c Clip
			var trackID int64
			if err := rows.Scan(&c.ID, &trackID, &c.BeatID, &c.Start, &c.Offset, &c.Length); err != nil {
				return err
			}
			t := &tl.Tracks[trackAt[trackID]]
			t.Clips = append(t.Clips, c)
			return nil
		})
	if err != nil {
		return Timeline{}, fmt.Errorf("reading clips: %w", err)
	}

	err = query(ctx, tx, `SELECT id, title, bpm, file_name, size, duration FROM beats
		WHERE id IN (SELECT c.beat_id FROM clips c JOIN tracks t ON t.id = c.track_id WHERE t.song_id = ?)
		ORDER BY id`, []any{songID},
		func(rows *sql.Rows) error {
			var b Beat
			var bpm sql.NullInt64
			if err := rows.Scan(&b.ID, &b.Title, &bpm, &b.FileName, &b.Size, &b.Duration); err != nil {
				return err
			}
			if bpm.Valid {
				n := int(bpm.Int64)
				b.BPM = &n
			}
			tl.Beats = append(tl.Beats, b)
			return nil
		})
	if err != nil {
		return Timeline{}, fmt.Errorf("reading beats: %w", err)
	}
	return tl, nil
}

// AddBeat places the whole of a Beat on the Song's beat Track: the topmost
// Track already holding a Clip of a Beat, or else a new Track named "Beat"
// at the bottom. The Clip goes after the Track's last Clip, or at 0:00.
func (s *Store) AddBeat(ctx context.Context, songID int64, based lyricsheet.Version, beatID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		var duration float64
		err := tx.QueryRowContext(ctx, `SELECT duration FROM beats WHERE id = ?`, beatID).Scan(&duration)
		if errors.Is(err, sql.ErrNoRows) {
			return &lyricsheet.InvalidError{Msg: "there's no such Beat in the Beat Library"}
		}
		if err != nil {
			return fmt.Errorf("reading beat: %w", err)
		}
		trackID, err := beatTrack(ctx, tx, songID)
		if err != nil {
			return err
		}
		var start float64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(start + length), 0) FROM clips WHERE track_id = ?`,
			trackID).Scan(&start); err != nil {
			return fmt.Errorf("finding the end of the track: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO clips (track_id, beat_id, start, source_offset, length) VALUES (?, ?, ?, 0, ?)`,
			trackID, beatID, start, duration); err != nil {
			return fmt.Errorf("adding clip: %w", err)
		}
		return nil
	})
}

// beatTrack returns the Song's beat Track, creating it if there is none.
func beatTrack(ctx context.Context, tx *sql.Tx, songID int64) (int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT t.id FROM tracks t
		WHERE t.song_id = ? AND EXISTS (SELECT 1 FROM clips c WHERE c.track_id = t.id AND c.beat_id IS NOT NULL)
		ORDER BY t.position, t.id LIMIT 1`, songID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("finding the beat track: %w", err)
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO tracks (song_id, name, position)
		VALUES (?1, ?2, (SELECT COALESCE(MAX(position) + 1, 0) FROM tracks WHERE song_id = ?1))`,
		songID, beatTrackName)
	if err != nil {
		return 0, fmt.Errorf("adding the beat track: %w", err)
	}
	return res.LastInsertId()
}

// TrackChanges is a partial update to a Track's name and mixer values.
// Fields not Set are unchanged.
type TrackChanges struct {
	Name   lyricsheet.Change[string]  `json:"name"`
	Volume lyricsheet.Change[float64] `json:"volume"`
	Muted  lyricsheet.Change[bool]    `json:"muted"`
	Soloed lyricsheet.Change[bool]    `json:"soloed"`
}

// UpdateTrack renames a Track or sets its volume, mute or solo. Its name
// can't be blank, and its volume must be from Silence to MaxVolume.
func (s *Store) UpdateTrack(ctx context.Context, songID int64, based lyricsheet.Version, trackID int64, changes TrackChanges) (Timeline, error) {
	var sets []string
	var args []any
	if c := changes.Name; c.Set {
		name := strings.TrimSpace(c.Value)
		if name == "" {
			return Timeline{}, errTrackNameRequired
		}
		sets, args = append(sets, "name = ?"), append(args, name)
	}
	if c := changes.Volume; c.Set {
		if c.Value < Silence || c.Value > MaxVolume {
			return Timeline{}, &lyricsheet.InvalidError{
				Msg: fmt.Sprintf("a Track's volume goes from %g dB (silence) to +%g dB", Silence, MaxVolume)}
		}
		sets, args = append(sets, "volume = ?"), append(args, c.Value)
	}
	if c := changes.Muted; c.Set {
		sets, args = append(sets, "muted = ?"), append(args, c.Value)
	}
	if c := changes.Soloed; c.Set {
		sets, args = append(sets, "soloed = ?"), append(args, c.Value)
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if len(sets) == 0 {
			return findTrack(ctx, tx, songID, trackID)
		}
		res, err := tx.ExecContext(ctx, `UPDATE tracks SET `+strings.Join(sets, ", ")+` WHERE id = ? AND song_id = ?`,
			append(args, trackID, songID)...)
		if err != nil {
			return fmt.Errorf("updating track: %w", err)
		}
		return expectOneRow(res)
	})
}

// errTrackNameRequired is refusing a Track without a name.
var errTrackNameRequired = &lyricsheet.InvalidError{Msg: "a Track's name is required"}

// findTrack checks that a Track is on the Song's Timeline.
func findTrack(ctx context.Context, tx *sql.Tx, songID, trackID int64) error {
	var found int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM tracks WHERE id = ? AND song_id = ?`, trackID, songID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return lyricsheet.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading track: %w", err)
	}
	return nil
}

// expectOneRow turns a change that touched no row into ErrNotFound.
func expectOneRow(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return lyricsheet.ErrNotFound
	}
	return nil
}

// AddTrack adds an empty Track at the bottom of the Timeline. Its name
// can't be blank.
func (s *Store) AddTrack(ctx context.Context, songID int64, based lyricsheet.Version, name string) (Timeline, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Timeline{}, errTrackNameRequired
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO tracks (song_id, name, position)
			VALUES (?1, ?2, (SELECT COALESCE(MAX(position) + 1, 0) FROM tracks WHERE song_id = ?1))`,
			songID, name); err != nil {
			return fmt.Errorf("adding track: %w", err)
		}
		return nil
	})
}

// ReorderTracks puts a Song's Tracks in the given order, top to bottom,
// which must list every one of them exactly once. Their Clips go with them.
func (s *Store) ReorderTracks(ctx context.Context, songID int64, based lyricsheet.Version, order []int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		current := map[int64]bool{}
		err := query(ctx, tx, `SELECT id FROM tracks WHERE song_id = ?`, []any{songID},
			func(rows *sql.Rows) error {
				var id int64
				err := rows.Scan(&id)
				current[id] = true
				return err
			})
		if err != nil {
			return fmt.Errorf("reading tracks: %w", err)
		}
		errOrder := &lyricsheet.InvalidError{Msg: "the new order must list every Track exactly once"}
		if len(order) != len(current) {
			return errOrder
		}
		for _, id := range order {
			if !current[id] {
				return errOrder
			}
			delete(current, id)
		}
		for pos, id := range order {
			if _, err := tx.ExecContext(ctx, `UPDATE tracks SET position = ? WHERE id = ?`, pos, id); err != nil {
				return fmt.Errorf("reordering tracks: %w", err)
			}
		}
		return nil
	})
}

// DeleteTrack removes a Track and its Clips from the Timeline. Their Beats
// stay in the Beat Library.
func (s *Store) DeleteTrack(ctx context.Context, songID int64, based lyricsheet.Version, trackID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		// Its Clips go with it, by the foreign key.
		res, err := tx.ExecContext(ctx, `DELETE FROM tracks WHERE id = ? AND song_id = ?`, trackID, songID)
		if err != nil {
			return fmt.Errorf("deleting track: %w", err)
		}
		return expectOneRow(res)
	})
}

// tolerance absorbs rounding when comparing times, e.g. a Clip placed right
// at a neighbour's end as the browser worked it out.
const tolerance = 1e-6

// errOverlap is refusing a Clip where another already plays on its Track.
var errOverlap = &lyricsheet.ConflictError{Msg: "Clips can't overlap on a Track"}

// placement is where a Clip is and what it plays, as stored.
type placement struct {
	trackID  int64
	beatID   int64
	start    float64
	offset   float64
	length   float64
	duration float64 // the source's
}

// MoveClip moves a Clip to start at a time on a Track of the same Timeline,
// keeping its trim. It can't overlap a Clip already there.
func (s *Store) MoveClip(ctx context.Context, songID int64, based lyricsheet.Version, clipID, trackID int64, start float64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		p, err := clipPlacement(ctx, tx, songID, clipID)
		if err != nil {
			return err
		}
		var found int
		err = tx.QueryRowContext(ctx, `SELECT 1 FROM tracks WHERE id = ? AND song_id = ?`, trackID, songID).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return &lyricsheet.InvalidError{Msg: "there's no such Track on this Timeline"}
		}
		if err != nil {
			return fmt.Errorf("reading track: %w", err)
		}
		p.trackID, p.start = trackID, start
		return place(ctx, tx, clipID, p)
	})
}

// TrimClip has a Clip play length seconds of its source from offset,
// without touching the source's file. The audio stays where it was on the
// Timeline, so trimming the start moves where the Clip starts. It can't
// reach beyond the source or into a neighbour.
func (s *Store) TrimClip(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64, offset, length float64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		p, err := clipPlacement(ctx, tx, songID, clipID)
		if err != nil {
			return err
		}
		switch {
		case offset < -tolerance:
			return &lyricsheet.InvalidError{Msg: "a Clip can't start before its source does"}
		case length <= 0:
			return &lyricsheet.InvalidError{Msg: "a Clip must play for some time"}
		case offset+length > p.duration+tolerance:
			return &lyricsheet.InvalidError{Msg: "a Clip can't play past the end of its source"}
		}
		offset = max(offset, 0)
		p.start += offset - p.offset
		p.offset, p.length = offset, length
		return place(ctx, tx, clipID, p)
	})
}

// DuplicateClip adds a copy of a Clip, with the same trim, right after it on
// its Track, or after the Track's last Clip if something is in the way.
func (s *Store) DuplicateClip(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		p, err := clipPlacement(ctx, tx, songID, clipID)
		if err != nil {
			return err
		}
		p.start += p.length
		free, err := isFree(ctx, tx, 0, p)
		if err != nil {
			return err
		}
		if !free {
			if err := tx.QueryRowContext(ctx, `SELECT MAX(start + length) FROM clips WHERE track_id = ?`,
				p.trackID).Scan(&p.start); err != nil {
				return fmt.Errorf("finding the end of the track: %w", err)
			}
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO clips (track_id, beat_id, start, source_offset, length) VALUES (?, ?, ?, ?, ?)`,
			p.trackID, p.beatID, p.start, p.offset, p.length); err != nil {
			return fmt.Errorf("adding clip: %w", err)
		}
		return nil
	})
}

// DeleteClip removes a Clip from the Timeline. Its Beat stays in the Beat
// Library.
func (s *Store) DeleteClip(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM clips
			WHERE id = ? AND track_id IN (SELECT id FROM tracks WHERE song_id = ?)`, clipID, songID)
		if err != nil {
			return fmt.Errorf("deleting clip: %w", err)
		}
		return expectOneRow(res)
	})
}

// clipPlacement reads where one of the Song's Clips is and what it plays.
func clipPlacement(ctx context.Context, tx *sql.Tx, songID, clipID int64) (placement, error) {
	var p placement
	err := tx.QueryRowContext(ctx, `SELECT c.track_id, c.beat_id, c.start, c.source_offset, c.length, b.duration
		FROM clips c JOIN tracks t ON t.id = c.track_id JOIN beats b ON b.id = c.beat_id
		WHERE c.id = ? AND t.song_id = ?`, clipID, songID).
		Scan(&p.trackID, &p.beatID, &p.start, &p.offset, &p.length, &p.duration)
	if errors.Is(err, sql.ErrNoRows) {
		return placement{}, lyricsheet.ErrNotFound
	}
	if err != nil {
		return placement{}, fmt.Errorf("reading clip: %w", err)
	}
	return p, nil
}

// place stores a Clip's new placement, if it starts on the Timeline and is
// clear of the other Clips on its Track.
func place(ctx context.Context, tx *sql.Tx, clipID int64, p placement) error {
	if p.start < -tolerance {
		return &lyricsheet.InvalidError{Msg: "a Clip can't start before 0:00"}
	}
	p.start = max(p.start, 0)
	free, err := isFree(ctx, tx, clipID, p)
	if err != nil {
		return err
	}
	if !free {
		return errOverlap
	}
	if _, err := tx.ExecContext(ctx, `UPDATE clips SET track_id = ?, start = ?, source_offset = ?, length = ? WHERE id = ?`,
		p.trackID, p.start, p.offset, p.length, clipID); err != nil {
		return fmt.Errorf("placing clip: %w", err)
	}
	return nil
}

// isFree tells whether p's stretch of its Track is clear of Clips other than
// clipID (0 for a new Clip). Touching a neighbour's edge is fine.
func isFree(ctx context.Context, tx *sql.Tx, clipID int64, p placement) (bool, error) {
	var n int
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM clips
		WHERE track_id = ? AND id != ? AND start < ? AND start + length > ?`,
		p.trackID, clipID, p.start+p.length-tolerance, p.start+tolerance).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("checking for overlaps: %w", err)
	}
	return n == 0, nil
}

// change runs one change to a Song's Timeline in a transaction, marks the
// Song as edited, and returns the updated Timeline. If the Song is no longer
// at the version the change was based on, or fn fails, nothing changes.
func (s *Store) change(ctx context.Context, songID int64, based lyricsheet.Version, fn func(tx *sql.Tx) error) (Timeline, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Timeline{}, err
	}
	defer tx.Rollback()
	if err := lyricsheet.Touch(ctx, tx, songID, based); err != nil {
		return Timeline{}, err
	}
	if err := fn(tx); err != nil {
		return Timeline{}, err
	}
	tl, err := read(ctx, tx, songID)
	if err != nil {
		return Timeline{}, err
	}
	return tl, tx.Commit()
}

// query runs a query and calls row for each result row.
func query(ctx context.Context, tx *sql.Tx, stmt string, args []any, row func(*sql.Rows) error) error {
	rows, err := tx.QueryContext(ctx, stmt, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := row(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}
