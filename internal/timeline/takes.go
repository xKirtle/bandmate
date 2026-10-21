package timeline

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// TakePlacement is where a Take was recorded, as the browser sends it with the
// file.
type TakePlacement struct {
	TrackID int64 `json:"trackId"`
	// Start is where its new Clip starts on the Timeline: the Track's
	// append point, where its last Clip ends.
	Start float64 `json:"start"`
	Captured
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
func (s *Store) RecordTake(ctx context.Context, songID int64, based songversion.Version, rec TakePlacement, file *audio.Received) (Timeline, error) {
	defer file.Discard()
	if math.IsNaN(rec.Start) || math.IsInf(rec.Start, 0) {
		return Timeline{}, domain.Invalid("start must be a number")
	}
	if rec.Start < -tolerance {
		return Timeline{}, domain.Invalid("a Clip can't start before 0:00")
	}
	take, err := readTake(file, rec.Captured)
	if err != nil {
		return Timeline{}, err
	}
	start := max(rec.Start, 0)
	return s.addTake(ctx, songID, based, file, func(ctx context.Context, tx *sql.Tx, _ Timeline) (Take, edit, error) {
		// It's the first Take of its Clip, so it's Take 1.
		stored, err := take.insert(ctx, tx, songID, 1)
		if err != nil {
			return Take{}, nil, err
		}
		return stored, func(tl Timeline, ids *ids) (Timeline, error) {
			return tl.recording(rec.TrackID, stored, take.start, start, ids.clip())
		}, nil
	})
}

// Captured is when and how a Take was captured, as the browser sends it
// with the file.
type Captured struct {
	// CaptureStart is the Timeline time capture began, lead-in included,
	// and LatencyOffset the delay taken off it to place the Take, both in
	// seconds.
	CaptureStart  float64 `json:"captureStart"`
	LatencyOffset float64 `json:"latencyOffset"`
	// Peaks is the waveform, 100 per second, from 0 to 1.
	Peaks []float64 `json:"peaks"`
}

// errTakeTooEarly is refusing a Take that has no audio in its Clip.
var errTakeTooEarly = domain.Invalid("the Take ended before its Clip's start")

// newTake is a Take uploaded, checked, and where it was sung on the
// Timeline.
type newTake struct {
	Captured
	wav      audio.WAV
	size     int64
	duration float64
	// start is the Timeline time it starts at: where capture began, less
	// the latency offset.
	start float64
}

// end is the Timeline time the Take ends at.
func (t newTake) end() float64 {
	return t.start + t.duration
}

// readTake checks a Take's file and how it was captured.
func readTake(file *audio.Received, c Captured) (newTake, error) {
	wav, err := file.ReadWAV()
	if errors.Is(err, audio.ErrNotWAV) || (err == nil &&
		(wav.Format != pcmFormat || wav.Channels != takeChannels || wav.BitsPerSample != takeBitDepth)) {
		return newTake{}, domain.Invalid("a Take must be a mono 24-bit WAV file")
	}
	if err != nil {
		return newTake{}, err
	}
	duration := wav.Duration()
	if msg := (audio.Upload{Duration: duration, Peaks: c.Peaks}).Problem(); msg != "" {
		return newTake{}, domain.Invalid(msg)
	}
	for _, v := range []float64{c.CaptureStart, c.LatencyOffset} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return newTake{}, domain.Invalid("captureStart and latencyOffset must be numbers")
		}
	}
	if c.LatencyOffset < 0 {
		return newTake{}, domain.Invalid("a latency offset can't be negative")
	}
	return newTake{Captured: c, wav: wav, size: file.Size, duration: duration,
		start: c.CaptureStart - c.LatencyOffset}, nil
}

// insert stores the Take, numbered, with its audio, in no Clip and at the
// origin of no span yet, and returns it as the Timeline holds it: the edit
// that places it says which Clip it goes in and where it starts in its
// span, and the writer writes that (write.go).
func (t newTake) insert(ctx context.Context, tx *sql.Tx, songID int64, number int) (Take, error) {
	peaks, err := json.Marshal(t.Peaks)
	if err != nil {
		return Take{}, err
	}
	recorded := time.Now().UTC()
	res, err := tx.ExecContext(ctx, `INSERT INTO takes (song_id, number, size, duration, sample_rate, peaks,
			latency_offset, position, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
		songID, number, t.size, t.duration, t.wav.SampleRate, string(peaks), t.LatencyOffset,
		recorded.Format(domain.TimeFormat))
	if err != nil {
		return Take{}, fmt.Errorf("adding take: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Take{}, err
	}
	return Take{ID: id, Number: number, Size: t.size, Duration: t.duration, SampleRate: int(t.wav.SampleRate),
		LatencyOffset: t.LatencyOffset, RecordedAt: recorded}, nil
}

// addTake makes one change to the Song's Timeline that places a Take
// uploaded as file: add stores the Take's row, with its audio, and returns
// it and the pure edit that puts it in a Clip. The file is kept under the
// Take's id if the change is made, and discarded otherwise, so a refusal
// leaves nothing behind.
func (s *Store) addTake(ctx context.Context, songID int64, based songversion.Version, file *audio.Received,
	add func(ctx context.Context, tx *sql.Tx, before Timeline) (Take, edit, error)) (Timeline, error) {
	return s.editTimelineReading(ctx, songID, based,
		func(ctx context.Context, tx *sql.Tx, changes *audio.FileChanges, before Timeline) (edit, error) {
			take, place, err := add(ctx, tx, before)
			if err != nil {
				return nil, err
			}
			changes.Keep(file, take.ID)
			return place, nil
		})
}

// Retake records another Take into a Clip of Takes, numbered after the
// highest still in it, as its active Take. It leads in from before the
// Clip's start like the first, and where it starts before the Clip's source
// span, the span is taken back to where it starts, the Takes already there
// staying where they are on the Timeline. The Clip grows to where it ends,
// but never past the next Clip on its Track: the rest is kept, hidden, to
// trim into view once there's room. Only a Clip at a Tempo of 100% and a
// Pitch of 0 can be retaken. The file is kept if the Take is added, and discarded otherwise.
func (s *Store) Retake(ctx context.Context, songID int64, based songversion.Version, clipID int64, c Captured, file *audio.Received) (Timeline, error) {
	defer file.Discard()
	take, err := readTake(file, c)
	if err != nil {
		return Timeline{}, err
	}
	return s.addTake(ctx, songID, based, file, func(ctx context.Context, tx *sql.Tx, before Timeline) (Take, edit, error) {
		// Its number comes from the Clip the Timeline holds, so the Take is
		// stored numbered before the edit places it.
		_, clip, err := before.findClip(clipID)
		if err != nil {
			return Take{}, nil, err
		}
		stored, err := take.insert(ctx, tx, songID, nextTakeNumber(clip))
		if err != nil {
			return Take{}, nil, err
		}
		return stored, func(tl Timeline, _ *ids) (Timeline, error) {
			return tl.retaking(clipID, stored, take.start)
		}, nil
	})
}

// ClipTakes is how a Clip of Takes is to be: its Takes, each where it
// starts in the Clip's source span, the one it plays, and where it is and
// what of the span it plays, as for NewClip.
type ClipTakes struct {
	Takes        []TakeAt `json:"takes"`
	ActiveTakeID *int64   `json:"activeTakeId"`
	Start        float64  `json:"start"`
	Offset       float64  `json:"offset"`
	Length       float64  `json:"length"`
	// FadeIn and FadeOut, given together, set the Clip's Fades, e.g. to
	// undo a change that shortened them. Otherwise they're kept, shortened
	// to fit if the Clip is now too short for them.
	FadeIn  *float64 `json:"fadeIn"`
	FadeOut *float64 `json:"fadeOut"`
}

// TakeAt is a Take and where it starts in its Clip's source span, in
// seconds.
type TakeAt struct {
	ID       int64   `json:"id"`
	Position float64 `json:"position"`
}

// SetTakes sets a Clip of Takes as it's to be, e.g. to undo or redo a
// Retake exactly. Takes of the Song it's given are put in it, from the
// Clip or detached, and those it isn't given leave it, detached. It keeps
// its Track, and must stay within its Takes and clear of its neighbours.
func (s *Store) SetTakes(ctx context.Context, songID int64, based songversion.Version, clipID int64, ct ClipTakes) (Timeline, error) {
	takeIDs, err := checkTakesAt(ct.Takes, ct.ActiveTakeID)
	if err != nil {
		return Timeline{}, err
	}
	fades, err := FadesGiven(ct.FadeIn, ct.FadeOut)
	if err != nil {
		return Timeline{}, err
	}
	return s.editTimelineReading(ctx, songID, based,
		func(ctx context.Context, tx *sql.Tx, _ *audio.FileChanges, before Timeline) (edit, error) {
			if _, _, err := before.findClipOfTakes(clipID); err != nil {
				return nil, err
			}
			// The Takes it's given may be detached, which the Timeline
			// doesn't hold, so they're read and checked here.
			takes, err := readTakes(ctx, tx, songID, []int64{clipID}, takeIDs)
			if err != nil {
				return nil, err
			}
			return func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.settingTakes(clipID, ct, takes, fades)
			}, nil
		})
}

// checkTakesAt checks the Takes a Clip of Takes is to have, each where it
// starts in the Clip's source span, and the one it plays among them,
// returning their ids.
func checkTakesAt(takes []TakeAt, active *int64) ([]int64, error) {
	ids := make([]int64, len(takes))
	for i, t := range takes {
		ids[i] = t.ID
		if math.IsNaN(t.Position) || math.IsInf(t.Position, 0) || t.Position < -tolerance {
			return nil, domain.Invalid("a Take can't start before its Clip's source")
		}
	}
	if active == nil || !slices.Contains(ids, *active) {
		return nil, domain.Invalid("a Clip of Takes plays one of them")
	}
	return ids, nil
}

// ChooseTake makes one of a Clip's Takes the one it plays, through the same
// window.
func (s *Store) ChooseTake(ctx context.Context, songID int64, based songversion.Version, clipID, takeID int64) (Timeline, error) {
	return s.editTimeline(ctx, songID, based, func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.choosingTake(clipID, takeID)
	})
}

// DeleteTake detaches one of a Clip's Takes, to be brought back by setting
// the Clip's Takes. Deleting the active Take makes the most recent one left
// active, and deleting the last deletes the Clip. The Clip's window shrinks
// to the Takes left, as keepingTakes shrinks it.
func (s *Store) DeleteTake(ctx context.Context, songID int64, based songversion.Version, clipID, takeID int64) (Timeline, error) {
	return s.editTimeline(ctx, songID, based, func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.deletingTake(clipID, takeID)
	})
}

// ClearInactiveTakes detaches all of a Clip's Takes but the active one, to
// be brought back by setting the Clip's Takes. The Clip's window shrinks to
// the Take left, as keepingTakes shrinks it.
func (s *Store) ClearInactiveTakes(ctx context.Context, songID int64, based songversion.Version, clipID int64) (Timeline, error) {
	return s.editTimeline(ctx, songID, based, func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.keepingActiveTake(clipID)
	})
}

// SweepDetachedTakes removes the Takes detached before a time, of every
// Song, with their files. Undo can only bring a Take back within the session
// it was detached in, so one detached long enough ago is gone for good.
func (s *Store) SweepDetachedTakes(ctx context.Context, before time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var ids []int64
	err = query(ctx, tx, `SELECT id FROM takes WHERE clip_id IS NULL AND detached_at < ?`,
		[]any{before.UTC().Format(domain.TimeFormat)}, func(rows *sql.Rows) error {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
			return nil
		})
	if err != nil {
		return fmt.Errorf("listing detached takes: %w", err)
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `DELETE FROM takes WHERE id = ?`, id); err != nil {
			return fmt.Errorf("sweeping take: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.removeTakeFiles(ids)
	return nil
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
	if t.RecordedAt, err = domain.ParseTime(recorded); err != nil {
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
		return Take{}, domain.ErrNotFound
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
// exactly as recorded, with Range support. A download is offered to save
// under the Song's title and the Take's number, e.g. "Night Drive - Take
// 3.wav", rather than played.
func (s *Store) ServeTake(w http.ResponseWriter, r *http.Request, songID, takeID int64, download bool) error {
	var title string
	var number int
	err := s.db.QueryRowContext(r.Context(), `SELECT songs.title, takes.number FROM takes
		JOIN songs ON songs.id = takes.song_id WHERE takes.id = ? AND takes.song_id = ?`, takeID, songID).
		Scan(&title, &number)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading take: %w", err)
	}
	if download {
		// A title's slashes would read as folders.
		audio.OfferToSave(w, fmt.Sprintf("%s - Take %d.wav", strings.NewReplacer("/", "-", `\`, "-").Replace(title), number))
	}
	return s.takeFiles.Serve(w, r, takeID, takeMediaType)
}
