package timeline

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// TakePlacement is where a Take was recorded, as the browser sends it with the
// file.
type TakePlacement struct {
	TrackID int64 `json:"trackId"`
	// Start is where its new Clip starts on the Timeline: the Track's
	// append point, where its last Clip ends.
	Start float64 `json:"start"`
	// CaptureStart is the Timeline time capture began, lead-in included,
	// and LatencyOffset the delay taken off it to place the Take, both in
	// seconds.
	CaptureStart  float64 `json:"captureStart"`
	LatencyOffset float64 `json:"latencyOffset"`
	// Peaks is the waveform, 100 per second, from 0 to 1.
	Peaks []float64 `json:"peaks"`
}

// Takes are recorded as 24-bit integer PCM in one channel (ADR 0003).
const (
	pcmFormat     = 1
	takeBitDepth  = 24
	takeChannels  = 1
	takeMediaType = "audio/wav"
)

// RecordTake places a Take just recorded in a new Clip on a Track, as its
// first and active Take. The Take starts where capture began, less the
// latency offset. Whatever it holds before the Clip's start (the lead-in)
// is kept, hidden behind it, so the Clip plays from its start to the
// Take's end. It can't overlap a Clip already there. The file is kept if
// the Take is added, and discarded otherwise.
func (s *Store) RecordTake(ctx context.Context, songID int64, based lyricsheet.Version, rec TakePlacement, file *audio.Received) (Timeline, error) {
	defer file.Discard()
	wav, err := file.ReadWAV()
	if errors.Is(err, audio.ErrNotWAV) || (err == nil &&
		(wav.Format != pcmFormat || wav.Channels != takeChannels || wav.BitsPerSample != takeBitDepth)) {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "a Take must be a mono 24-bit WAV file"}
	}
	if err != nil {
		return Timeline{}, err
	}
	duration := wav.Duration()
	if msg := (audio.Upload{Duration: duration, Peaks: rec.Peaks}).Problem(); msg != "" {
		return Timeline{}, &lyricsheet.InvalidError{Msg: msg}
	}
	for _, v := range []float64{rec.Start, rec.CaptureStart, rec.LatencyOffset} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return Timeline{}, &lyricsheet.InvalidError{Msg: "start, captureStart and latencyOffset must be numbers"}
		}
	}
	switch {
	case rec.Start < -tolerance:
		return Timeline{}, &lyricsheet.InvalidError{Msg: "a Clip can't start before 0:00"}
	case rec.LatencyOffset < 0:
		return Timeline{}, &lyricsheet.InvalidError{Msg: "a latency offset can't be negative"}
	}
	start := max(rec.Start, 0)
	// The span's origin is the Take's start, or the Clip's if the Take
	// starts later, so the Clip never starts before its source.
	takeStart := rec.CaptureStart - rec.LatencyOffset
	offset := max(0, start-takeStart)
	position := takeStart - (start - offset)
	length := takeStart + duration - start
	if length <= tolerance {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "the Take ended before its Clip's start"}
	}
	peaks, err := json.Marshal(rec.Peaks)
	if err != nil {
		return Timeline{}, err
	}
	var kept int64
	tl, err := s.change(ctx, songID, based, func(tx *sql.Tx) error {
		if err := findTrack(ctx, tx, songID, rec.TrackID); errors.Is(err, lyricsheet.ErrNotFound) {
			return &lyricsheet.InvalidError{Msg: "there's no such Track on this Timeline"}
		} else if err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO takes (song_id, number, size, duration, sample_rate, peaks,
				latency_offset, position, recorded_at)
			VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
			songID, file.Size, duration, wav.SampleRate, string(peaks), rec.LatencyOffset, position,
			time.Now().UTC().Format(timeFormat))
		if err != nil {
			return fmt.Errorf("adding take: %w", err)
		}
		takeID, err := res.LastInsertId()
		if err != nil {
			return err
		}
		c := NewClip{TakeIDs: []int64{takeID}, ActiveTakeID: &takeID, Start: start, Offset: offset, Length: length}
		if err := addClip(ctx, tx, songID, rec.TrackID, c); err != nil {
			return err
		}
		// Kept last, so nothing after it can fail but the commit.
		if err := file.Keep(takeID); err != nil {
			return err
		}
		kept = takeID
		return nil
	})
	if err != nil && kept != 0 {
		s.removeTakeFiles([]int64{kept})
	}
	return tl, err
}

// takeColumns are the takes columns scanTake reads, in its order.
const takeColumns = `id, number, size, duration, sample_rate, latency_offset, position, recorded_at`

// scanTake reads one row of takeColumns. Columns selected after them are
// read into extra.
func scanTake(row interface{ Scan(...any) error }, extra ...any) (Take, error) {
	var t Take
	var recorded string
	err := row.Scan(append([]any{&t.ID, &t.Number, &t.Size, &t.Duration, &t.SampleRate, &t.LatencyOffset,
		&t.Position, &recorded}, extra...)...)
	if err != nil {
		return Take{}, err
	}
	if t.RecordedAt, err = time.Parse(timeFormat, recorded); err != nil {
		return Take{}, fmt.Errorf("parsing stored time %q: %w", recorded, err)
	}
	return t, nil
}

// GetTake returns one of a Song's Takes, in a Clip or detached, with its
// peaks.
func (s *Store) GetTake(ctx context.Context, songID, takeID int64) (Take, error) {
	var peaks string
	t, err := scanTake(s.db.QueryRowContext(ctx, `SELECT `+takeColumns+`, peaks FROM takes
		WHERE id = ? AND song_id = ?`, takeID, songID), &peaks)
	if errors.Is(err, sql.ErrNoRows) {
		return Take{}, lyricsheet.ErrNotFound
	}
	if err != nil {
		return Take{}, fmt.Errorf("reading take: %w", err)
	}
	if err := json.Unmarshal([]byte(peaks), &t.Peaks); err != nil {
		return Take{}, fmt.Errorf("reading take peaks: %w", err)
	}
	return t, nil
}

// ServeTake answers a request for one of a Song's Takes' audio file,
// exactly as recorded, with Range support.
func (s *Store) ServeTake(w http.ResponseWriter, r *http.Request, songID, takeID int64) error {
	var found int
	err := s.db.QueryRowContext(r.Context(), `SELECT 1 FROM takes WHERE id = ? AND song_id = ?`, takeID, songID).
		Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return lyricsheet.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading take: %w", err)
	}
	return s.takeFiles.Serve(w, r, takeID, takeMediaType)
}
