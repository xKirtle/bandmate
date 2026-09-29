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
	"log"
	"slices"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
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
	// Loop is nil until one is set.
	Loop *Loop `json:"loop"`
}

// Loop is a stretch of the Timeline, in seconds, that playback repeats while
// it's on. Start is always before End.
type Loop struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	On    bool    `json:"on"`
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

// Clip is a stretch of a Beat, or of a set of Takes, placed on a Track.
// Trimming it never changes an audio file.
type Clip struct {
	ID int64 `json:"id"`
	// BeatID is the Beat the Clip plays, or nil for a Clip of Takes.
	BeatID *int64 `json:"beatId"`
	// Takes are a Clip of Takes' Takes, by number, and ActiveTakeID the one
	// it plays. A Clip of a Beat has none.
	Takes        []Take `json:"takes"`
	ActiveTakeID *int64 `json:"activeTakeId"`
	// Start is where the Clip starts on the Timeline, Offset where in its
	// source it starts playing, and Length how long it plays, all in
	// seconds. A Beat's source is its file; Takes' is the span they're laid
	// out in, which starts Offset seconds before the Clip does.
	Start  float64 `json:"start"`
	Offset float64 `json:"offset"`
	Length float64 `json:"length"`
}

// Take is one recording made in the app, a mono 24-bit WAV at the rate it
// was recorded at. It holds no lyrics (ADR 0011).
type Take struct {
	ID int64 `json:"id"`
	// Number tells a Clip's Takes apart, e.g. "Take 3".
	Number int `json:"number"`
	// Size is the file's, in bytes.
	Size int64 `json:"size"`
	// Duration is in seconds, and SampleRate in samples per second.
	Duration   float64 `json:"duration"`
	SampleRate int     `json:"sampleRate"`
	// LatencyOffset is the delay, in seconds, taken off where it was
	// captured to place it.
	LatencyOffset float64 `json:"latencyOffset"`
	// Position is where it starts in its Clip's source span, in seconds.
	Position   float64   `json:"position"`
	RecordedAt time.Time `json:"recordedAt"`
	// Peaks is the waveform, as the browser computed it. The Timeline
	// leaves them out; GetTake includes them.
	Peaks []float64 `json:"peaks,omitempty"`
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
	// takeFiles holds Takes' audio, by Take id.
	takeFiles *audio.Files
}

// NewStore returns a Store backed by db, keeping Takes' audio in takeFiles.
func NewStore(db *sql.DB, takeFiles *audio.Files) *Store {
	return &Store{db: db, takeFiles: takeFiles}
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

	type at struct{ track, clip int }
	clipAt := map[int64]at{}
	err = query(ctx, tx, `SELECT c.id, c.track_id, c.beat_id, c.active_take_id, c.start, c.source_offset, c.length
		FROM clips c JOIN tracks t ON t.id = c.track_id
		WHERE t.song_id = ? ORDER BY c.start, c.id`, []any{songID},
		func(rows *sql.Rows) error {
			c := Clip{Takes: []Take{}}
			var trackID int64
			if err := rows.Scan(&c.ID, &trackID, &c.BeatID, &c.ActiveTakeID, &c.Start, &c.Offset, &c.Length); err != nil {
				return err
			}
			t := &tl.Tracks[trackAt[trackID]]
			clipAt[c.ID] = at{trackAt[trackID], len(t.Clips)}
			t.Clips = append(t.Clips, c)
			return nil
		})
	if err != nil {
		return Timeline{}, fmt.Errorf("reading clips: %w", err)
	}

	err = query(ctx, tx, `SELECT `+takeColumns+`, clip_id FROM takes
		WHERE song_id = ? AND clip_id IS NOT NULL ORDER BY number, id`, []any{songID},
		func(rows *sql.Rows) error {
			var clipID int64
			take, err := scanTake(rows, &clipID)
			if err != nil {
				return err
			}
			a := clipAt[clipID]
			c := &tl.Tracks[a.track].Clips[a.clip]
			c.Takes = append(c.Takes, take)
			return nil
		})
	if err != nil {
		return Timeline{}, fmt.Errorf("reading takes: %w", err)
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

	var l Loop
	err = tx.QueryRowContext(ctx, `SELECT start, end, is_on FROM loops WHERE song_id = ?`, songID).
		Scan(&l.Start, &l.End, &l.On)
	switch {
	case err == nil:
		tl.Loop = &l
	case !errors.Is(err, sql.ErrNoRows):
		return Timeline{}, fmt.Errorf("reading loop: %w", err)
	}
	return tl, nil
}

// AddBeat places the whole of a Beat on the Song's beat Track: the topmost
// Track already holding a Clip of a Beat, or else a new Track named "Beat"
// at the bottom. The Clip goes after the Track's last Clip, or at 0:00.
func (s *Store) AddBeat(ctx context.Context, songID int64, based lyricsheet.Version, beatID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		duration, err := source{beatID: sql.NullInt64{Int64: beatID, Valid: true}}.duration(ctx, tx)
		if err != nil {
			return err
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
		return addClip(ctx, tx, songID, trackID, NewClip{BeatID: &beatID, Start: start, Length: duration})
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

// TrackChanges is a partial update to a Track's name and levels.
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
		if err := checkVolume(c.Value); err != nil {
			return Timeline{}, err
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

// checkVolume checks that a Track's volume is from Silence to MaxVolume.
func checkVolume(volume float64) error {
	if volume < Silence || volume > MaxVolume {
		return &lyricsheet.InvalidError{
			Msg: fmt.Sprintf("a Track's volume goes from %g dB (silence) to +%g dB", Silence, MaxVolume)}
	}
	return nil
}

// errTrackNameRequired refuses a Track without a name.
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

// NewTrack is a Track to add: by default empty, at the bottom of the
// Timeline, at 0 dB and neither muted nor soloed. Undo uses the rest to
// bring a deleted Track back as it was.
type NewTrack struct {
	Name string `json:"name"`
	// Position is where it goes, from 0 (the top) to the number of Tracks
	// (the bottom), pushing those from there down; nil for the bottom.
	Position *int      `json:"position"`
	Volume   float64   `json:"volume"`
	Muted    bool      `json:"muted"`
	Soloed   bool      `json:"soloed"`
	Clips    []NewClip `json:"clips"`
}

// AddTrack adds a Track to the Timeline. Its name can't be blank, its
// volume must be from Silence to MaxVolume, and its Clips follow the same
// rules as placing a Clip.
func (s *Store) AddTrack(ctx context.Context, songID int64, based lyricsheet.Version, t NewTrack) (Timeline, error) {
	name := strings.TrimSpace(t.Name)
	if name == "" {
		return Timeline{}, errTrackNameRequired
	}
	if err := checkVolume(t.Volume); err != nil {
		return Timeline{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		var order []int64
		err := query(ctx, tx, `SELECT id FROM tracks WHERE song_id = ? ORDER BY position, id`, []any{songID},
			func(rows *sql.Rows) error {
				var id int64
				if err := rows.Scan(&id); err != nil {
					return err
				}
				order = append(order, id)
				return nil
			})
		if err != nil {
			return fmt.Errorf("reading tracks: %w", err)
		}
		pos := len(order)
		if t.Position != nil {
			if *t.Position < 0 || *t.Position > len(order) {
				return &lyricsheet.InvalidError{Msg: "a Track's position must be from 0 to the number of Tracks"}
			}
			pos = *t.Position
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO tracks (song_id, name, position, volume, muted, soloed)
			VALUES (?, ?, ?, ?, ?, ?)`, songID, name, pos, t.Volume, t.Muted, t.Soloed)
		if err != nil {
			return fmt.Errorf("adding track: %w", err)
		}
		// Renumbered around it, as deleting Tracks may have left gaps.
		for i, id := range order {
			at := i
			if i >= pos {
				at++
			}
			if _, err := tx.ExecContext(ctx, `UPDATE tracks SET position = ? WHERE id = ?`, at, id); err != nil {
				return fmt.Errorf("making room for the track: %w", err)
			}
		}
		trackID, err := res.LastInsertId()
		if err != nil {
			return err
		}
		for _, c := range t.Clips {
			if err := addClip(ctx, tx, songID, trackID, c); err != nil {
				return err
			}
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
				if err := rows.Scan(&id); err != nil {
					return err
				}
				current[id] = true
				return nil
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
// stay in the Beat Library, and their Takes are detached, to be placed
// again.
func (s *Store) DeleteTrack(ctx context.Context, songID int64, based lyricsheet.Version, trackID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		// Its Clips go with it, by the foreign key, and their Takes leave them.
		res, err := tx.ExecContext(ctx, `DELETE FROM tracks WHERE id = ? AND song_id = ?`, trackID, songID)
		if err != nil {
			return fmt.Errorf("deleting track: %w", err)
		}
		if err := expectOneRow(res); err != nil {
			return err
		}
		return markDetached(ctx, tx, songID)
	})
}

// markDetached notes when the Song's Takes that just left their Clips, by
// the foreign key, were detached.
func markDetached(ctx context.Context, tx *sql.Tx, songID int64) error {
	if _, err := tx.ExecContext(ctx, `UPDATE takes SET detached_at = ?
		WHERE song_id = ? AND clip_id IS NULL AND detached_at IS NULL`,
		time.Now().UTC().Format(timeFormat), songID); err != nil {
		return fmt.Errorf("detaching takes: %w", err)
	}
	return nil
}

// SetLoop sets the Song's Loop to repeat from start to end, which must come
// after start, switched on or off.
func (s *Store) SetLoop(ctx context.Context, songID int64, based lyricsheet.Version, start, end float64, on bool) (Timeline, error) {
	switch {
	case start < -tolerance:
		return Timeline{}, &lyricsheet.InvalidError{Msg: "a Loop can't start before 0:00"}
	case end <= start:
		return Timeline{}, &lyricsheet.InvalidError{Msg: "a Loop's start must be before its end"}
	}
	start = max(start, 0)
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO loops (song_id, start, end, is_on) VALUES (?, ?, ?, ?)
			ON CONFLICT (song_id) DO UPDATE SET start = excluded.start, end = excluded.end, is_on = excluded.is_on`,
			songID, start, end, on); err != nil {
			return fmt.Errorf("setting loop: %w", err)
		}
		return nil
	})
}

// SwitchLoop switches the Song's Loop on or off, keeping its stretch. The
// Song must have a Loop.
func (s *Store) SwitchLoop(ctx context.Context, songID int64, based lyricsheet.Version, on bool) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE loops SET is_on = ? WHERE song_id = ?`, on, songID)
		if err != nil {
			return fmt.Errorf("switching loop: %w", err)
		}
		return expectOneRow(res)
	})
}

// ClearLoop removes the Song's Loop.
func (s *Store) ClearLoop(ctx context.Context, songID int64, based lyricsheet.Version) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM loops WHERE song_id = ?`, songID)
		if err != nil {
			return fmt.Errorf("clearing loop: %w", err)
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
	trackID int64
	source  source
	start   float64
	offset  float64
	length  float64
}

// source is what a Clip plays: a Beat, or Takes, of which it plays the
// active one. The Timeline's rules ask it how long it is rather than
// reaching for a Clip's Beat or Takes.
type source struct {
	beatID sql.NullInt64
	// activeTakeID is set for a Clip of Takes, and takeIDs are all of them.
	activeTakeID sql.NullInt64
	takeIDs      []int64
}

// duration reads how long the source is, in seconds, however a Clip trims
// it: a Beat's file, or the span up to where the last of the Takes ends,
// whichever is active.
func (src source) duration(ctx context.Context, tx *sql.Tx) (float64, error) {
	if src.activeTakeID.Valid {
		var end float64
		for _, id := range src.takeIDs {
			var e float64
			if err := tx.QueryRowContext(ctx, `SELECT position + duration FROM takes WHERE id = ?`, id).
				Scan(&e); err != nil {
				return 0, fmt.Errorf("reading take: %w", err)
			}
			end = max(end, e)
		}
		return end, nil
	}
	var duration float64
	err := tx.QueryRowContext(ctx, `SELECT duration FROM beats WHERE id = ?`, src.beatID.Int64).Scan(&duration)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, &lyricsheet.InvalidError{Msg: "there's no such Beat in the Beat Library"}
	}
	if err != nil {
		return 0, fmt.Errorf("reading beat: %w", err)
	}
	return duration, nil
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
		duration, err := p.source.duration(ctx, tx)
		if err != nil {
			return err
		}
		if err := checkTrim(offset, length, duration); err != nil {
			return err
		}
		offset = max(offset, 0)
		p.start += offset - p.offset
		p.offset, p.length = offset, length
		return place(ctx, tx, clipID, p)
	})
}

// checkTrim checks that a Clip playing length seconds of a source from
// offset stays within the source's duration.
func checkTrim(offset, length, duration float64) error {
	switch {
	case offset < -tolerance:
		return &lyricsheet.InvalidError{Msg: "a Clip can't start before its source does"}
	case length <= 0:
		return &lyricsheet.InvalidError{Msg: "a Clip must play for some time"}
	case offset+length > duration+tolerance:
		return &lyricsheet.InvalidError{Msg: "a Clip can't play past the end of its source"}
	}
	return nil
}

// NewClip is a stretch of a Beat, or of detached Takes, to place on a
// Track: where it starts on the Timeline, and where in its source it starts
// playing and for how long, in seconds.
type NewClip struct {
	// BeatID is the Beat it plays, or else TakeIDs are the Takes it gets
	// back, and ActiveTakeID the one of them it plays.
	BeatID       *int64  `json:"beatId"`
	TakeIDs      []int64 `json:"takeIds"`
	ActiveTakeID *int64  `json:"activeTakeId"`
	Start        float64 `json:"start"`
	Offset       float64 `json:"offset"`
	Length       float64 `json:"length"`
}

// PlaceClip places a stretch of a Beat, or of detached Takes, on a Track of
// the Timeline, e.g. to bring back a deleted Clip as it was. It must stay
// within its source, start on the Timeline and not overlap a Clip already
// there.
func (s *Store) PlaceClip(ctx context.Context, songID int64, based lyricsheet.Version, trackID int64, c NewClip) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		var found int
		err := tx.QueryRowContext(ctx, `SELECT 1 FROM tracks WHERE id = ? AND song_id = ?`, trackID, songID).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return &lyricsheet.InvalidError{Msg: "there's no such Track on this Timeline"}
		}
		if err != nil {
			return fmt.Errorf("reading track: %w", err)
		}
		return addClip(ctx, tx, songID, trackID, c)
	})
}

// addClip adds a new Clip to a Track of the Song, if it stays within its
// source, starts on the Timeline and is clear of the Clips already there.
// Takes it's given are attached to it.
func addClip(ctx context.Context, tx *sql.Tx, songID, trackID int64, c NewClip) error {
	src, err := newSource(ctx, tx, songID, c)
	if err != nil {
		return err
	}
	duration, err := src.duration(ctx, tx)
	if err != nil {
		return err
	}
	if err := checkTrim(c.Offset, c.Length, duration); err != nil {
		return err
	}
	if c.Start < -tolerance {
		return &lyricsheet.InvalidError{Msg: "a Clip can't start before 0:00"}
	}
	p := placement{trackID: trackID, source: src, start: max(c.Start, 0), offset: max(c.Offset, 0), length: c.Length}
	free, err := isFree(ctx, tx, 0, p)
	if err != nil {
		return err
	}
	if !free {
		return errOverlap
	}
	clipID, err := insertClip(ctx, tx, p)
	if err != nil {
		return err
	}
	return attachTakes(ctx, tx, clipID, c.TakeIDs)
}

// newSource checks what a new Clip is to play: a Beat, or detached Takes of
// the Song, the active one among them.
func newSource(ctx context.Context, tx *sql.Tx, songID int64, c NewClip) (source, error) {
	switch {
	case c.BeatID != nil && len(c.TakeIDs) == 0:
		return source{beatID: sql.NullInt64{Int64: *c.BeatID, Valid: true}}, nil
	case c.BeatID != nil || len(c.TakeIDs) == 0:
		return source{}, &lyricsheet.InvalidError{Msg: "a Clip plays either a Beat or Takes"}
	}
	if c.ActiveTakeID == nil || !slices.Contains(c.TakeIDs, *c.ActiveTakeID) {
		return source{}, &lyricsheet.InvalidError{Msg: "a Clip of Takes plays one of them"}
	}
	for i, id := range c.TakeIDs {
		if slices.Contains(c.TakeIDs[:i], id) {
			return source{}, &lyricsheet.InvalidError{Msg: "a Take can only be in a Clip once"}
		}
		var detached bool
		err := tx.QueryRowContext(ctx, `SELECT clip_id IS NULL FROM takes WHERE id = ? AND song_id = ?`,
			id, songID).Scan(&detached)
		if errors.Is(err, sql.ErrNoRows) {
			return source{}, &lyricsheet.InvalidError{Msg: "there's no such Take in this Song"}
		}
		if err != nil {
			return source{}, fmt.Errorf("reading take: %w", err)
		}
		if !detached {
			return source{}, &lyricsheet.ConflictError{Msg: "a Take can only be in one Clip"}
		}
	}
	return source{activeTakeID: sql.NullInt64{Int64: *c.ActiveTakeID, Valid: true}, takeIDs: c.TakeIDs}, nil
}

// attachTakes puts Takes in a Clip.
func attachTakes(ctx context.Context, tx *sql.Tx, clipID int64, takeIDs []int64) error {
	for _, id := range takeIDs {
		if _, err := tx.ExecContext(ctx, `UPDATE takes SET clip_id = ?, detached_at = NULL WHERE id = ?`,
			clipID, id); err != nil {
			return fmt.Errorf("attaching take: %w", err)
		}
	}
	return nil
}

// insertClip stores a new Clip as placed, without checking where, and
// returns its id.
func insertClip(ctx context.Context, tx *sql.Tx, p placement) (int64, error) {
	res, err := tx.ExecContext(ctx,
		`INSERT INTO clips (track_id, beat_id, active_take_id, start, source_offset, length) VALUES (?, ?, ?, ?, ?, ?)`,
		p.trackID, p.source.beatID, p.source.activeTakeID, p.start, p.offset, p.length)
	if err != nil {
		return 0, fmt.Errorf("adding clip: %w", err)
	}
	return res.LastInsertId()
}

// DuplicateClip adds a copy of a Clip, with the same trim, right after it on
// its Track, or after the Track's last Clip if something is in the way. A
// Clip of Takes gets copies of its Takes, sharing their files.
func (s *Store) DuplicateClip(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64) (Timeline, error) {
	var linked []int64
	tl, err := s.change(ctx, songID, based, func(tx *sql.Tx) error {
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
		if !p.source.activeTakeID.Valid {
			_, err := insertClip(ctx, tx, p)
			return err
		}
		copies, err := s.copyTakes(ctx, tx, p.source.takeIDs, &linked)
		if err != nil {
			return err
		}
		p.source.activeTakeID.Int64 = copies[p.source.activeTakeID.Int64]
		copyID, err := insertClip(ctx, tx, p)
		if err != nil {
			return err
		}
		ids := make([]int64, 0, len(copies))
		for _, id := range p.source.takeIDs {
			ids = append(ids, copies[id])
		}
		return attachTakes(ctx, tx, copyID, ids)
	})
	if err != nil {
		s.removeTakeFiles(linked)
	}
	return tl, err
}

// copyTakes adds a detached copy of each of the Takes, sharing its file,
// noting each file linked in linked. It returns the copies' ids by the ids
// of the Takes copied.
func (s *Store) copyTakes(ctx context.Context, tx *sql.Tx, ids []int64, linked *[]int64) (map[int64]int64, error) {
	copies := map[int64]int64{}
	for _, id := range ids {
		res, err := tx.ExecContext(ctx, `INSERT INTO takes (song_id, number, size, duration, sample_rate, peaks,
				latency_offset, position, recorded_at)
			SELECT song_id, number, size, duration, sample_rate, peaks, latency_offset, position, recorded_at
			FROM takes WHERE id = ?`, id)
		if err != nil {
			return nil, fmt.Errorf("copying take: %w", err)
		}
		copyID, err := res.LastInsertId()
		if err != nil {
			return nil, err
		}
		if err := s.takeFiles.Link(id, copyID); err != nil {
			return nil, err
		}
		*linked = append(*linked, copyID)
		copies[id] = copyID
	}
	return copies, nil
}

// removeTakeFiles deletes the files of Takes that aren't in the database.
// A file left behind only takes space, so failures are logged.
func (s *Store) removeTakeFiles(ids []int64) {
	for _, id := range ids {
		if err := s.takeFiles.Remove(id); err != nil {
			log.Printf("deleting take %d: %v", id, err)
		}
	}
}

// DeleteClip removes a Clip from the Timeline. Its Beat stays in the Beat
// Library, and its Takes are detached, to be placed again.
func (s *Store) DeleteClip(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		// Its Takes leave it by the foreign key.
		res, err := tx.ExecContext(ctx, `DELETE FROM clips
			WHERE id = ? AND track_id IN (SELECT id FROM tracks WHERE song_id = ?)`, clipID, songID)
		if err != nil {
			return fmt.Errorf("deleting clip: %w", err)
		}
		if err := expectOneRow(res); err != nil {
			return err
		}
		return markDetached(ctx, tx, songID)
	})
}

// clipPlacement reads where one of the Song's Clips is and what it plays.
func clipPlacement(ctx context.Context, tx *sql.Tx, songID, clipID int64) (placement, error) {
	var p placement
	err := tx.QueryRowContext(ctx, `SELECT c.track_id, c.beat_id, c.active_take_id, c.start, c.source_offset, c.length
		FROM clips c JOIN tracks t ON t.id = c.track_id
		WHERE c.id = ? AND t.song_id = ?`, clipID, songID).
		Scan(&p.trackID, &p.source.beatID, &p.source.activeTakeID, &p.start, &p.offset, &p.length)
	if errors.Is(err, sql.ErrNoRows) {
		return placement{}, lyricsheet.ErrNotFound
	}
	if err != nil {
		return placement{}, fmt.Errorf("reading clip: %w", err)
	}
	err = query(ctx, tx, `SELECT id FROM takes WHERE clip_id = ? ORDER BY number, id`, []any{clipID},
		func(rows *sql.Rows) error {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return err
			}
			p.source.takeIDs = append(p.source.takeIDs, id)
			return nil
		})
	if err != nil {
		return placement{}, fmt.Errorf("reading takes: %w", err)
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
