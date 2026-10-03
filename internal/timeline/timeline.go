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
	// Sounds are the Sounds the Clips play, each once, without their peaks.
	Sounds []Sound `json:"sounds"`
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
	// Volume is in dB, from MinVolume to MaxVolume.
	Volume float64 `json:"volume"`
	Muted  bool    `json:"muted"`
	// Soloed Tracks are the only ones heard, when there are any.
	Soloed bool `json:"soloed"`
	// Clips are in the order they start, and never overlap.
	Clips []Clip `json:"clips"`
}

// Clip is a stretch of a Beat or a Sound, or of a set of Takes, placed on a
// Track. Trimming it never changes an audio file.
type Clip struct {
	ID int64 `json:"id"`
	// BeatID is the Beat the Clip plays, or SoundID the Sound; both are nil
	// for a Clip of Takes.
	BeatID  *int64 `json:"beatId"`
	SoundID *int64 `json:"soundId"`
	// Name is the Clip's own name, or nil until it's named, when it goes by
	// its source's.
	Name *string `json:"name"`
	// Gain is how much louder or quieter it plays, in dB, before its Track's
	// volume applies: from MinGain to MaxGain, 0 until it's set.
	Gain float64 `json:"gain"`
	// FadeIn and FadeOut are how long it rises from silence at its start
	// and falls to silence at its end, in seconds, each measured from that
	// edge as trimmed: 0 for none. Together they never run longer than it.
	FadeIn  float64 `json:"fadeIn"`
	FadeOut float64 `json:"fadeOut"`
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
	Position float64 `json:"position"`
	// Nudge is how far it's been moved by hand from where it was recorded,
	// in seconds, later if positive. Position includes it.
	Nudge      float64   `json:"nudge"`
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

// MinVolume and MaxVolume are a Track's lowest and highest volume, in dB.
// Even at its lowest a Track is heard: muting it is what silences it. The
// fader (web/src/lib/mixer.ts) and the tracks table's CHECK use the same range.
const (
	MinVolume = -36.0
	MaxVolume = 36.0
)

// MinGain and MaxGain are a Clip's lowest and highest Gain, in dB, the same
// as a Track's volume: even at its lowest a Clip is heard. The gain line
// (web/src/lib/clipGain.ts) and the clips table's CHECK use the same range.
const (
	MinGain = MinVolume
	MaxGain = MaxVolume
)

// timeFormat is how songs.updated_at is stored.
const timeFormat = "2006-01-02T15:04:05.000000000Z"

// Store reads and changes Timelines.
type Store struct {
	db *sql.DB
	// takeFiles holds Takes' audio, by Take id, and soundFiles Sounds', by
	// Sound id.
	takeFiles  *audio.Files
	soundFiles *audio.Files
}

// NewStore returns a Store backed by db, keeping Takes' audio in takeFiles
// and Sounds' in soundFiles.
func NewStore(db *sql.DB, takeFiles, soundFiles *audio.Files) *Store {
	return &Store{db: db, takeFiles: takeFiles, soundFiles: soundFiles}
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
	tl := Timeline{SongID: songID, Tracks: []Track{}, Beats: []Beat{}, Sounds: []Sound{}}
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
	err = query(ctx, tx, `SELECT c.id, c.track_id, c.beat_id, c.sound_id, c.name, c.gain, c.fade_in, c.fade_out,
			c.active_take_id, c.start, c.source_offset, c.length
		FROM clips c JOIN tracks t ON t.id = c.track_id
		WHERE t.song_id = ? ORDER BY c.start, c.id`, []any{songID},
		func(rows *sql.Rows) error {
			c := Clip{Takes: []Take{}}
			var trackID int64
			if err := rows.Scan(&c.ID, &trackID, &c.BeatID, &c.SoundID, &c.Name, &c.Gain, &c.FadeIn, &c.FadeOut,
				&c.ActiveTakeID, &c.Start, &c.Offset, &c.Length); err != nil {
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

	err = query(ctx, tx, `SELECT id, name, file_name, size, duration FROM sounds
		WHERE id IN (SELECT c.sound_id FROM clips c JOIN tracks t ON t.id = c.track_id WHERE t.song_id = ?)
		ORDER BY id`, []any{songID},
		func(rows *sql.Rows) error {
			var snd Sound
			if err := rows.Scan(&snd.ID, &snd.Name, &snd.FileName, &snd.Size, &snd.Duration); err != nil {
				return err
			}
			tl.Sounds = append(tl.Sounds, snd)
			return nil
		})
	if err != nil {
		return Timeline{}, fmt.Errorf("reading sounds: %w", err)
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

// AddBeat places the whole of a Beat on a Track of the Song, after its last
// Clip, or at 0:00 if it has none.
func (s *Store) AddBeat(ctx context.Context, songID int64, based lyricsheet.Version, trackID, beatID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if err := findTrack(ctx, tx, songID, trackID); err != nil {
			return err
		}
		duration, err := source{beatID: sql.NullInt64{Int64: beatID, Valid: true}}.duration(ctx, tx)
		if err != nil {
			return err
		}
		start, err := trackEnd(ctx, tx, trackID)
		if err != nil {
			return err
		}
		return addClip(ctx, tx, songID, trackID, NewClip{BeatID: &beatID, Start: start, Length: duration})
	})
}

// trackEnd is where a Track's last Clip ends, or 0:00 if it has none: where
// a Clip added to it goes.
func trackEnd(ctx context.Context, tx *sql.Tx, trackID int64) (float64, error) {
	var end float64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(start + length), 0) FROM clips WHERE track_id = ?`,
		trackID).Scan(&end); err != nil {
		return 0, fmt.Errorf("finding the end of the track: %w", err)
	}
	return end, nil
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
// can't be blank, and its volume must be from MinVolume to MaxVolume.
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

// checkVolume checks that a Track's volume is from MinVolume to MaxVolume.
func checkVolume(volume float64) error {
	if volume < MinVolume || volume > MaxVolume {
		return &lyricsheet.InvalidError{
			Msg: fmt.Sprintf("a Track's volume goes from %g dB to +%g dB", MinVolume, MaxVolume)}
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
// volume must be from MinVolume to MaxVolume, and its Clips follow the same
// rules as placing a Clip.
func (s *Store) AddTrack(ctx context.Context, songID int64, based lyricsheet.Version, t NewTrack) (Timeline, error) {
	name, err := trackName(t.Name)
	if err != nil {
		return Timeline{}, err
	}
	if err := checkVolume(t.Volume); err != nil {
		return Timeline{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		trackID, err := insertTrackAt(ctx, tx, songID, name, t.Position, t.Volume, t.Muted, t.Soloed)
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
// stay in the Beat Library, their Sounds are kept a while for undo, and
// their Takes are detached, to be placed again. A Song always has a Track,
// so its last one can't be deleted.
func (s *Store) DeleteTrack(ctx context.Context, songID int64, based lyricsheet.Version, trackID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return deleteTrack(ctx, tx, songID, trackID)
	})
}

// deleteTrack removes one of the Song's Tracks and its Clips, detaching
// their Takes, unless it's the Song's last.
func deleteTrack(ctx context.Context, tx *sql.Tx, songID, trackID int64) error {
	// Its Clips go with it, by the foreign key, and their Takes leave them.
	res, err := tx.ExecContext(ctx, `DELETE FROM tracks WHERE id = ? AND song_id = ?`, trackID, songID)
	if err != nil {
		return fmt.Errorf("deleting track: %w", err)
	}
	if err := expectOneRow(res); err != nil {
		return err
	}
	var left int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM tracks WHERE song_id = ?`, songID).Scan(&left); err != nil {
		return fmt.Errorf("counting tracks: %w", err)
	}
	if left == 0 {
		return errLastTrack
	}
	return markDetached(ctx, tx, songID)
}

// errLastTrack refuses deleting a Song's only Track.
var errLastTrack = &lyricsheet.ConflictError{Msg: "a Song always has a Track, so its last one can't be deleted"}

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

// placement is where a Clip is, what it plays, what it's named, its Gain
// and its Fades, as stored. Its Fades are shortened to fit as it's stored.
type placement struct {
	trackID int64
	source  source
	// name is null for a Clip that isn't named.
	name   sql.NullString
	gain   float64
	fades  Fades
	start  float64
	offset float64
	length float64
}

// source is what a Clip plays: a Beat, a Sound, or Takes, of which it
// plays the active one. The Timeline's rules ask it how long it is rather
// than reaching for a Clip's Beat, Sound or Takes.
type source struct {
	beatID  sql.NullInt64
	soundID sql.NullInt64
	// activeTakeID is set for a Clip of Takes, and takeIDs are all of them.
	activeTakeID sql.NullInt64
	takeIDs      []int64
}

// duration reads how long the source is, in seconds, however a Clip trims
// it: a Beat's or a Sound's file, or the span up to where the last of the
// Takes ends, whichever is active.
func (src source) duration(ctx context.Context, tx *sql.Tx) (float64, error) {
	if src.activeTakeID.Valid {
		var end float64
		for _, id := range src.takeIDs {
			var e float64
			// A Take nudged earlier still reaches where it ended before.
			if err := tx.QueryRowContext(ctx, `SELECT position + duration + MAX(0, -nudge) FROM takes WHERE id = ?`, id).
				Scan(&e); err != nil {
				return 0, fmt.Errorf("reading take: %w", err)
			}
			end = max(end, e)
		}
		return end, nil
	}
	var duration float64
	if src.soundID.Valid {
		if err := tx.QueryRowContext(ctx, `SELECT duration FROM sounds WHERE id = ?`, src.soundID.Int64).
			Scan(&duration); err != nil {
			return 0, fmt.Errorf("reading sound: %w", err)
		}
		return duration, nil
	}
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
		p, err := movedTo(ctx, tx, songID, clipID, trackID, start)
		if err != nil {
			return err
		}
		return place(ctx, tx, clipID, p)
	})
}

// movedTo is where one of the Song's Clips would be, moved to start at a
// time on a Track, if that's on the Song's Timeline.
func movedTo(ctx context.Context, tx *sql.Tx, songID, clipID, trackID int64, start float64) (placement, error) {
	p, err := clipPlacement(ctx, tx, songID, clipID)
	if err != nil {
		return placement{}, err
	}
	if err := findTrackToPlaceOn(ctx, tx, songID, trackID); err != nil {
		return placement{}, err
	}
	p.trackID, p.start = trackID, start
	return onTimeline(p)
}

// ClipMove is where one Clip of several moved at once goes: a Track and a
// start, in seconds.
type ClipMove struct {
	ClipID  int64   `json:"clipId"`
	TrackID int64   `json:"trackId"`
	Start   float64 `json:"start"`
}

// MoveClips moves several Clips at once, each to start at a time on a Track
// of the same Timeline, keeping its trim. Each is checked where it lands
// against the Timeline as the whole move leaves it, so Clips moved together
// may pass each other's old places, but none can overlap another Clip.
// If any can't go where it's moved, none moves.
func (s *Store) MoveClips(ctx context.Context, songID int64, based lyricsheet.Version, moves []ClipMove) (Timeline, error) {
	if len(moves) == 0 {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "clips are required"}
	}
	seen := map[int64]bool{}
	for _, m := range moves {
		if seen[m.ClipID] {
			return Timeline{}, &lyricsheet.InvalidError{Msg: "each Clip can only move once"}
		}
		seen[m.ClipID] = true
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		placed := make([]placement, len(moves))
		for i, m := range moves {
			p, err := movedTo(ctx, tx, songID, m.ClipID, m.TrackID, m.Start)
			if err != nil {
				return err
			}
			if err := store(ctx, tx, m.ClipID, p); err != nil {
				return err
			}
			placed[i] = p
		}
		// Only once every Clip is where it's going.
		for i, m := range moves {
			if err := checkFree(ctx, tx, m.ClipID, placed[i]); err != nil {
				return err
			}
		}
		return nil
	})
}

// TrimClip has a Clip play length seconds of its source from offset,
// without touching the source's file. The audio stays where it was on the
// Timeline, so trimming the start moves where the Clip starts. It can't
// reach beyond the source or into a neighbour. Its Fades go with its edges,
// shortened to fit if it's now too short for them, unless fades, if given,
// sets them, e.g. to undo the trim.
func (s *Store) TrimClip(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64, offset, length float64,
	fades *Fades) (Timeline, error) {
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
		if fades != nil {
			if err := fades.check(length); err != nil {
				return err
			}
			p.fades = *fades
		}
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

// NewClip is a stretch of a Beat or a Sound, or of detached Takes, to
// place on a Track: where it starts on the Timeline, and where in its source
// it starts playing and for how long, in seconds.
type NewClip struct {
	// BeatID is the Beat it plays, or SoundID the Song's Sound, or else
	// TakeIDs are the Takes it gets back, and ActiveTakeID the one of them
	// it plays.
	BeatID  *int64 `json:"beatId"`
	SoundID *int64 `json:"soundId"`
	// Name is its own name, if it has one.
	Name *string `json:"name"`
	// Gain is in dB, 0 if not given.
	Gain float64 `json:"gain"`
	// FadeIn and FadeOut are in seconds, 0 if not given.
	FadeIn       float64 `json:"fadeIn"`
	FadeOut      float64 `json:"fadeOut"`
	TakeIDs      []int64 `json:"takeIds"`
	ActiveTakeID *int64  `json:"activeTakeId"`
	Start        float64 `json:"start"`
	Offset       float64 `json:"offset"`
	Length       float64 `json:"length"`
}

// PlaceClip places a stretch of a Beat or a Sound, or of detached Takes, on
// a Track of the Timeline, e.g. to bring back a deleted Clip as it was. It
// must stay within its source, start on the Timeline and not overlap a Clip
// already there.
func (s *Store) PlaceClip(ctx context.Context, songID int64, based lyricsheet.Version, trackID int64, c NewClip) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return placeOnTrack(ctx, tx, songID, trackID, c)
	})
}

// OnTrack is the Track one of several Clips placed or pasted at once goes
// on: one of the Timeline's, or one of the Tracks added for them.
type OnTrack struct {
	TrackID int64
	// NewTrack, if set, is the index of the Track added for it to go on.
	NewTrack *int
}

// trackOf is the id of the Track a Clip goes on, given the ids of the
// Tracks added for the Clips.
func (o OnTrack) trackOf(added []int64) (int64, error) {
	if o.NewTrack == nil {
		return o.TrackID, nil
	}
	if *o.NewTrack < 0 || *o.NewTrack >= len(added) {
		return 0, &lyricsheet.InvalidError{Msg: "there's no such new Track"}
	}
	return added[*o.NewTrack], nil
}

// trackName is a Track's name as given, trimmed, which can't be blank.
func trackName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errTrackNameRequired
	}
	return name, nil
}

// checkTrackNames checks the names of Tracks to add, returning them trimmed.
func checkTrackNames(names []string) ([]string, error) {
	trimmed := make([]string, len(names))
	for i, n := range names {
		var err error
		if trimmed[i], err = trackName(n); err != nil {
			return nil, err
		}
	}
	return trimmed, nil
}

// insertTrack adds a Track to the Song at a position, returning its id.
func insertTrack(ctx context.Context, tx *sql.Tx, songID int64, name string, position int, volume float64,
	muted, soloed bool) (int64, error) {
	res, err := tx.ExecContext(ctx, `INSERT INTO tracks (song_id, name, position, volume, muted, soloed)
		VALUES (?, ?, ?, ?, ?, ?)`, songID, name, position, volume, muted, soloed)
	if err != nil {
		return 0, fmt.Errorf("adding track: %w", err)
	}
	return res.LastInsertId()
}

// insertTrackAt adds a Track to the Song at position, from 0 (the top) to
// the number of Tracks (the bottom), pushing those from there down, or at
// the bottom for nil, returning its id. Its name must be checked.
func insertTrackAt(ctx context.Context, tx *sql.Tx, songID int64, name string, position *int, volume float64,
	muted, soloed bool) (int64, error) {
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
		return 0, fmt.Errorf("reading tracks: %w", err)
	}
	pos := len(order)
	if position != nil {
		if *position < 0 || *position > len(order) {
			return 0, &lyricsheet.InvalidError{Msg: "a Track's position must be from 0 to the number of Tracks"}
		}
		pos = *position
	}
	trackID, err := insertTrack(ctx, tx, songID, name, pos, volume, muted, soloed)
	if err != nil {
		return 0, err
	}
	// Renumbered around it, as deleting Tracks may have left gaps.
	for i, id := range order {
		at := i
		if i >= pos {
			at++
		}
		if _, err := tx.ExecContext(ctx, `UPDATE tracks SET position = ? WHERE id = ?`, at, id); err != nil {
			return 0, fmt.Errorf("making room for the track: %w", err)
		}
	}
	return trackID, nil
}

// TrackAt is an empty Track to add at a position, from 0 (the top) to the
// number of Tracks (the bottom), pushing those from there down, at 0 dB and
// neither muted nor soloed: e.g. one a Merge adds for its Clip.
type TrackAt struct {
	Name     string `json:"name"`
	Position int    `json:"position"`
}

// insertTracksAt adds Tracks at their positions, in order, each placed
// among the Tracks there once those before it are added, returning their
// ids.
func insertTracksAt(ctx context.Context, tx *sql.Tx, songID int64, tracks []TrackAt) ([]int64, error) {
	ids := make([]int64, len(tracks))
	for i, t := range tracks {
		name, err := trackName(t.Name)
		if err != nil {
			return nil, err
		}
		if ids[i], err = insertTrackAt(ctx, tx, songID, name, &t.Position, 0, false, false); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

// addTracksAtBottom adds empty Tracks with the names given, which must be
// checked, at the bottom of the Timeline in order, at 0 dB and neither
// muted nor soloed, returning their ids.
func addTracksAtBottom(ctx context.Context, tx *sql.Tx, songID int64, names []string) ([]int64, error) {
	var bottom int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(position), -1) + 1 FROM tracks WHERE song_id = ?`,
		songID).Scan(&bottom); err != nil {
		return nil, fmt.Errorf("reading tracks: %w", err)
	}
	ids := make([]int64, len(names))
	for i, name := range names {
		var err error
		if ids[i], err = insertTrack(ctx, tx, songID, name, bottom+i, 0, false, false); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

// PlacedClip is a Clip to place, and the Track it goes on.
type PlacedClip struct {
	OnTrack
	NewClip
}

// PlaceClips places several Clips at once, each as PlaceClip does, e.g. to
// bring back Clips deleted together, or to redo a paste. Tracks named
// newTracks are added at the bottom first, in order, for Clips to go on, as
// a paste adds them. None may overlap a Clip already there, or another of
// them. If any can't be placed, none is, and no Track is added.
func (s *Store) PlaceClips(ctx context.Context, songID int64, based lyricsheet.Version, newTracks []string,
	clips []PlacedClip) (Timeline, error) {
	if len(clips) == 0 {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "clips are required"}
	}
	names, err := checkTrackNames(newTracks)
	if err != nil {
		return Timeline{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		added, err := addTracksAtBottom(ctx, tx, songID, names)
		if err != nil {
			return err
		}
		for _, c := range clips {
			trackID, err := c.trackOf(added)
			if err != nil {
				return err
			}
			// Each placed is there for the next to be checked against.
			if err := placeOnTrack(ctx, tx, songID, trackID, c.NewClip); err != nil {
				return err
			}
		}
		return nil
	})
}

// placeOnTrack adds a new Clip to one of the Song's Tracks, as addClip does.
func placeOnTrack(ctx context.Context, tx *sql.Tx, songID, trackID int64, c NewClip) error {
	if err := findTrackToPlaceOn(ctx, tx, songID, trackID); err != nil {
		return err
	}
	return addClip(ctx, tx, songID, trackID, c)
}

// findTrackToPlaceOn checks that a Track a Clip is to go on is one of the
// Song's, refusing the request if not.
func findTrackToPlaceOn(ctx context.Context, tx *sql.Tx, songID, trackID int64) error {
	if err := findTrack(ctx, tx, songID, trackID); errors.Is(err, lyricsheet.ErrNotFound) {
		return &lyricsheet.InvalidError{Msg: "there's no such Track on this Timeline"}
	} else if err != nil {
		return err
	}
	return nil
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
	if err := checkGain(c.Gain); err != nil {
		return err
	}
	fades := Fades{In: c.FadeIn, Out: c.FadeOut}
	if err := fades.check(c.Length); err != nil {
		return err
	}
	p := placement{trackID: trackID, source: src, name: clipName(c.Name), gain: c.Gain, fades: fades,
		start: max(c.Start, 0), offset: max(c.Offset, 0), length: c.Length}
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

// newSource checks what a new Clip is to play: a Beat, one of the Song's
// Sounds, or detached Takes of the Song, the active one among them.
func newSource(ctx context.Context, tx *sql.Tx, songID int64, c NewClip) (source, error) {
	given := 0
	for _, g := range []bool{c.BeatID != nil, c.SoundID != nil, len(c.TakeIDs) > 0} {
		if g {
			given++
		}
	}
	switch {
	case given != 1:
		return source{}, &lyricsheet.InvalidError{Msg: "a Clip plays one of a Beat, a Sound or Takes"}
	case c.BeatID != nil:
		return source{beatID: sql.NullInt64{Int64: *c.BeatID, Valid: true}}, nil
	case c.SoundID != nil:
		if err := findSound(ctx, tx, songID, *c.SoundID); err != nil {
			return source{}, err
		}
		return source{soundID: sql.NullInt64{Int64: *c.SoundID, Valid: true}}, nil
	}
	if c.ActiveTakeID == nil || !slices.Contains(c.TakeIDs, *c.ActiveTakeID) {
		return source{}, &lyricsheet.InvalidError{Msg: "a Clip of Takes plays one of them"}
	}
	if err := checkTakes(ctx, tx, songID, 0, c.TakeIDs); err != nil {
		return source{}, err
	}
	return source{activeTakeID: sql.NullInt64{Int64: *c.ActiveTakeID, Valid: true}, takeIDs: c.TakeIDs}, nil
}

// checkTakes checks that Takes of the Song can go in a Clip (0 for a new
// one), each once: they must be detached or in it already.
func checkTakes(ctx context.Context, tx *sql.Tx, songID, clipID int64, ids []int64) error {
	in, err := takesOfSong(ctx, tx, songID, ids)
	if err != nil {
		return err
	}
	for _, c := range in {
		if c.Valid && c.Int64 != clipID {
			return &lyricsheet.ConflictError{Msg: "a Take can only be in one Clip"}
		}
	}
	return nil
}

// takesOfSong checks that Takes are the Song's, each given once, and
// returns the Clip each is in, or null for one detached.
func takesOfSong(ctx context.Context, tx *sql.Tx, songID int64, ids []int64) ([]sql.NullInt64, error) {
	in := make([]sql.NullInt64, len(ids))
	for i, id := range ids {
		if slices.Contains(ids[:i], id) {
			return nil, &lyricsheet.InvalidError{Msg: "a Take can only be in a Clip once"}
		}
		err := tx.QueryRowContext(ctx, `SELECT clip_id FROM takes WHERE id = ? AND song_id = ?`,
			id, songID).Scan(&in[i])
		if errors.Is(err, sql.ErrNoRows) {
			return nil, &lyricsheet.InvalidError{Msg: "there's no such Take in this Song"}
		}
		if err != nil {
			return nil, fmt.Errorf("reading take: %w", err)
		}
	}
	return in, nil
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
	fades := p.fades.fitted(p.length)
	res, err := tx.ExecContext(ctx,
		`INSERT INTO clips (track_id, beat_id, sound_id, name, gain, fade_in, fade_out, active_take_id,
				start, source_offset, length)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.trackID, p.source.beatID, p.source.soundID, p.name, p.gain, fades.In, fades.Out, p.source.activeTakeID,
		p.start, p.offset, p.length)
	if err != nil {
		return 0, fmt.Errorf("adding clip: %w", err)
	}
	return res.LastInsertId()
}

// DuplicateClip adds a copy of a Clip, with the same trim, name, Gain and
// Fades, right after it on its Track, or after the Track's last Clip if something is in
// the way. A Clip of Takes gets copies of its Takes, sharing their files.
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

// ClipCopy is a Clip as it was copied, to paste as a new Clip on a Track:
// a stretch of a Beat or a Sound, or of Takes, given as they were then, each
// where it started in the Clip's source span and how far it was nudged.
type ClipCopy struct {
	OnTrack
	BeatID  *int64
	SoundID *int64
	// Name is its own name, if it had one.
	Name *string
	// Gain is in dB.
	Gain float64
	// FadeIn and FadeOut are in seconds.
	FadeIn, FadeOut float64
	// Takes are a Clip of Takes', and ActiveTakeID the one of them it plays.
	Takes        []TakeAt
	ActiveTakeID *int64
	Start        float64
	Offset       float64
	Length       float64
}

// PasteClips adds new Clips copied from others, as they were copied, each
// on its Track: the Clipboard's, pasted. Tracks named newTracks are added
// at the bottom first, in order, for Clips that run past the last Track to
// go on. A Clip of Takes gets copies of the Takes, sharing their files,
// which may be in a Clip still or detached, as a Clip cut is. Each must stay
// within its source, start on the Timeline and not overlap a Clip already
// there, or another of them. If any can't be pasted, none is, and no Track
// is added.
func (s *Store) PasteClips(ctx context.Context, songID int64, based lyricsheet.Version, newTracks []string,
	clips []ClipCopy) (Timeline, error) {
	if len(clips) == 0 {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "clips are required"}
	}
	names, err := checkTrackNames(newTracks)
	if err != nil {
		return Timeline{}, err
	}
	for _, c := range clips {
		if len(c.Takes) == 0 {
			continue
		}
		if _, err := checkTakesAt(c.Takes, c.ActiveTakeID); err != nil {
			return Timeline{}, err
		}
	}
	var linked []int64
	tl, err := s.change(ctx, songID, based, func(tx *sql.Tx) error {
		added, err := addTracksAtBottom(ctx, tx, songID, names)
		if err != nil {
			return err
		}
		for _, c := range clips {
			trackID, err := c.trackOf(added)
			if err != nil {
				return err
			}
			nc := NewClip{BeatID: c.BeatID, SoundID: c.SoundID, Name: c.Name, Gain: c.Gain,
				FadeIn: c.FadeIn, FadeOut: c.FadeOut, Start: c.Start, Offset: c.Offset, Length: c.Length}
			if len(c.Takes) > 0 {
				ids, active, err := s.copyTakesAt(ctx, tx, songID, c.Takes, *c.ActiveTakeID, &linked)
				if err != nil {
					return err
				}
				nc.TakeIDs, nc.ActiveTakeID = ids, &active
			}
			// Each pasted is there for the next to be checked against.
			if err := placeOnTrack(ctx, tx, songID, trackID, nc); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.removeTakeFiles(linked)
	}
	return tl, err
}

// copyTakesAt adds a detached copy of each of the Song's Takes, sharing its
// file, where it's given to start in its span and nudged as given, noting
// each file linked in linked. It returns the copies' ids, in order, and the
// id of the copy of active.
func (s *Store) copyTakesAt(ctx context.Context, tx *sql.Tx, songID int64, takes []TakeAt, active int64,
	linked *[]int64) ([]int64, int64, error) {
	ids := make([]int64, len(takes))
	for i, t := range takes {
		ids[i] = t.ID
	}
	// In a Clip or detached, as a Clip cut leaves them.
	if _, err := takesOfSong(ctx, tx, songID, ids); err != nil {
		return nil, 0, err
	}
	copies, err := s.copyTakes(ctx, tx, ids, linked)
	if err != nil {
		return nil, 0, err
	}
	for i, t := range takes {
		ids[i] = copies[t.ID]
		if _, err := tx.ExecContext(ctx, `UPDATE takes SET position = ?, nudge = ? WHERE id = ?`,
			max(t.Position, 0), t.Nudge, ids[i]); err != nil {
			return nil, 0, fmt.Errorf("placing take: %w", err)
		}
	}
	return ids, copies[active], nil
}

// copyTakes adds a detached copy of each of the Takes, sharing its file,
// noting each file linked in linked. It returns the copies' ids by the ids
// of the Takes copied.
func (s *Store) copyTakes(ctx context.Context, tx *sql.Tx, ids []int64, linked *[]int64) (map[int64]int64, error) {
	copies := map[int64]int64{}
	for _, id := range ids {
		res, err := tx.ExecContext(ctx, `INSERT INTO takes (song_id, number, size, duration, sample_rate, peaks,
				latency_offset, position, nudge, recorded_at)
			SELECT song_id, number, size, duration, sample_rate, peaks, latency_offset, position, nudge, recorded_at
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

// RenameClip gives a Clip a name of its own, or, given a blank one, clears
// it, so the Clip goes by its source's name again.
func (s *Store) RenameClip(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64, name string) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE clips SET name = ?
			WHERE id = ? AND track_id IN (SELECT id FROM tracks WHERE song_id = ?)`, clipName(&name), clipID, songID)
		if err != nil {
			return fmt.Errorf("renaming clip: %w", err)
		}
		return expectOneRow(res)
	})
}

// SetClipGain sets how much louder or quieter a Clip plays, in dB, from
// MinGain to MaxGain.
func (s *Store) SetClipGain(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64, gain float64) (Timeline, error) {
	if err := checkGain(gain); err != nil {
		return Timeline{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE clips SET gain = ?
			WHERE id = ? AND track_id IN (SELECT id FROM tracks WHERE song_id = ?)`, gain, clipID, songID)
		if err != nil {
			return fmt.Errorf("setting clip gain: %w", err)
		}
		return expectOneRow(res)
	})
}

// checkGain checks that a Clip's Gain is from MinGain to MaxGain.
func checkGain(gain float64) error {
	if gain < MinGain || gain > MaxGain {
		return &lyricsheet.InvalidError{Msg: fmt.Sprintf("a Clip's Gain goes from %g dB to +%g dB", MinGain, MaxGain)}
	}
	return nil
}

// SetClipFades sets how long a Clip rises from silence at its start and
// falls to silence at its end, in seconds: 0 for no Fade. Together they
// can't run longer than the Clip.
func (s *Store) SetClipFades(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64, fades Fades) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		p, err := clipPlacement(ctx, tx, songID, clipID)
		if err != nil {
			return err
		}
		if err := fades.check(p.length); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE clips SET fade_in = ?, fade_out = ? WHERE id = ?`,
			fades.In, fades.Out, clipID); err != nil {
			return fmt.Errorf("setting clip fades: %w", err)
		}
		return nil
	})
}

// Fades are how long a Clip rises from silence at its start (In) and falls
// to silence at its end (Out), in seconds, each measured from that edge.
type Fades struct {
	In, Out float64
}

// FadesGiven are the Fades a request sets along with something else, e.g. a
// trim, if it gives them: both, or neither, to keep the Clip's.
func FadesGiven(in, out *float64) (*Fades, error) {
	if (in == nil) != (out == nil) {
		return nil, &lyricsheet.InvalidError{Msg: "fadeIn and fadeOut go together"}
	}
	if in == nil {
		return nil, nil
	}
	return &Fades{In: *in, Out: *out}, nil
}

// check checks that Fades are each at least nothing, and together no
// longer than a Clip length seconds long.
func (f Fades) check(length float64) error {
	switch {
	case f.In < 0 || f.Out < 0:
		return &lyricsheet.InvalidError{Msg: "a Fade can't be shorter than nothing"}
	case f.In+f.Out > length+tolerance:
		return &lyricsheet.InvalidError{Msg: "a Clip's Fades can't together run longer than it"}
	}
	return nil
}

// fitted is the Fades of a Clip now length seconds long: as they are, if
// they fit, or else each shortened by the same share, to meet. The web
// app's fitFades (web/src/lib/clipFade.ts) works it out the same way.
func (f Fades) fitted(length float64) Fades {
	if f.In+f.Out <= length {
		return f
	}
	share := length / (f.In + f.Out)
	return Fades{In: f.In * share, Out: min(f.Out*share, length-f.In*share)}
}

// clipName is a Clip's name as stored: trimmed, and null if it has none or
// it's blank.
func clipName(name *string) sql.NullString {
	if name == nil {
		return sql.NullString{}
	}
	n := strings.TrimSpace(*name)
	return sql.NullString{String: n, Valid: n != ""}
}

// DeleteClip removes a Clip from the Timeline. Its Beat stays in the Beat
// Library, its Sound is kept a while for undo, and its Takes are detached,
// to be placed again.
func (s *Store) DeleteClip(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		return deleteClip(ctx, tx, songID, clipID)
	})
}

// DeleteClips removes several Clips from the Timeline at once, as
// DeleteClip does each, and then the Tracks trackIDs with any Clips left on
// them, as DeleteTrack does each: e.g. to undo a paste that added Tracks.
// If any isn't on the Song's Timeline, or none of its Tracks would be left,
// nothing is removed.
func (s *Store) DeleteClips(ctx context.Context, songID int64, based lyricsheet.Version, clipIDs, trackIDs []int64) (Timeline, error) {
	if len(clipIDs) == 0 {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "clipIds are required"}
	}
	if err := checkDeletedOnce(clipIDs); err != nil {
		return Timeline{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		for _, id := range clipIDs {
			if err := deleteClip(ctx, tx, songID, id); err != nil {
				return err
			}
		}
		for _, id := range trackIDs {
			if err := deleteTrack(ctx, tx, songID, id); err != nil {
				return err
			}
		}
		return nil
	})
}

// checkDeletedOnce refuses Clips to delete that name one twice.
func checkDeletedOnce(clipIDs []int64) error {
	for i, id := range clipIDs {
		if slices.Contains(clipIDs[:i], id) {
			return &lyricsheet.InvalidError{Msg: "each Clip can only be deleted once"}
		}
	}
	return nil
}

// deleteClip removes one of the Song's Clips, detaching its Takes.
func deleteClip(ctx context.Context, tx *sql.Tx, songID, clipID int64) error {
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
}

// clipPlacement reads where one of the Song's Clips is and what it plays.
func clipPlacement(ctx context.Context, tx *sql.Tx, songID, clipID int64) (placement, error) {
	var p placement
	err := tx.QueryRowContext(ctx, `SELECT c.track_id, c.beat_id, c.sound_id, c.name, c.gain, c.fade_in, c.fade_out,
			c.active_take_id, c.start, c.source_offset, c.length
		FROM clips c JOIN tracks t ON t.id = c.track_id
		WHERE c.id = ? AND t.song_id = ?`, clipID, songID).
		Scan(&p.trackID, &p.source.beatID, &p.source.soundID, &p.name, &p.gain, &p.fades.In, &p.fades.Out,
			&p.source.activeTakeID, &p.start, &p.offset, &p.length)
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
	p, err := onTimeline(p)
	if err != nil {
		return err
	}
	if err := checkFree(ctx, tx, clipID, p); err != nil {
		return err
	}
	return store(ctx, tx, clipID, p)
}

// onTimeline is p, if it starts on the Timeline, a start rounded a hair
// before 0:00 taken as 0:00.
func onTimeline(p placement) (placement, error) {
	if p.start < -tolerance {
		return placement{}, &lyricsheet.InvalidError{Msg: "a Clip can't start before 0:00"}
	}
	p.start = max(p.start, 0)
	return p, nil
}

// checkFree refuses p if its stretch of its Track isn't clear of Clips
// other than clipID.
func checkFree(ctx context.Context, tx *sql.Tx, clipID int64, p placement) error {
	free, err := isFree(ctx, tx, clipID, p)
	if err != nil {
		return err
	}
	if !free {
		return errOverlap
	}
	return nil
}

// store writes a Clip's placement, unchecked, its Fades shortened to fit.
func store(ctx context.Context, tx *sql.Tx, clipID int64, p placement) error {
	fades := p.fades.fitted(p.length)
	if _, err := tx.ExecContext(ctx, `UPDATE clips SET track_id = ?, start = ?, source_offset = ?, length = ?,
			fade_in = ?, fade_out = ? WHERE id = ?`,
		p.trackID, p.start, p.offset, p.length, fades.In, fades.Out, clipID); err != nil {
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
	// Any change can leave a Sound unused, or, by undo, use it again.
	if err := markUnusedSounds(ctx, tx, songID); err != nil {
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
