package timeline

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"mime"
	"net/http"
	"slices"
	"strings"
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
func (s *Store) RecordTake(ctx context.Context, songID int64, based lyricsheet.Version, rec TakePlacement, file *audio.Received) (Timeline, error) {
	defer file.Discard()
	if math.IsNaN(rec.Start) || math.IsInf(rec.Start, 0) {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "start must be a number"}
	}
	if rec.Start < -tolerance {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "a Clip can't start before 0:00"}
	}
	take, err := readTake(file, rec.Captured)
	if err != nil {
		return Timeline{}, err
	}
	start := max(rec.Start, 0)
	// The span's origin is the Take's start, or the Clip's if the Take
	// starts later, so the Clip never starts before its source.
	offset := max(0, start-take.start)
	length := take.end() - start
	if length <= tolerance {
		return Timeline{}, errTakeTooEarly
	}
	return s.addTake(ctx, songID, based, file, func(tx *sql.Tx) (int64, error) {
		if err := findTrack(ctx, tx, songID, rec.TrackID); errors.Is(err, lyricsheet.ErrNotFound) {
			return 0, &lyricsheet.InvalidError{Msg: "there's no such Track on this Timeline"}
		} else if err != nil {
			return 0, err
		}
		takeID, err := take.insert(ctx, tx, songID, 1, take.start-(start-offset))
		if err != nil {
			return 0, err
		}
		c := NewClip{TakeIDs: []int64{takeID}, ActiveTakeID: &takeID, Start: start, Offset: offset, Length: length}
		return takeID, addClip(ctx, tx, songID, rec.TrackID, c)
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
var errTakeTooEarly = &lyricsheet.InvalidError{Msg: "the Take ended before its Clip's start"}

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
		return newTake{}, &lyricsheet.InvalidError{Msg: "a Take must be a mono 24-bit WAV file"}
	}
	if err != nil {
		return newTake{}, err
	}
	duration := wav.Duration()
	if msg := (audio.Upload{Duration: duration, Peaks: c.Peaks}).Problem(); msg != "" {
		return newTake{}, &lyricsheet.InvalidError{Msg: msg}
	}
	for _, v := range []float64{c.CaptureStart, c.LatencyOffset} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return newTake{}, &lyricsheet.InvalidError{Msg: "captureStart and latencyOffset must be numbers"}
		}
	}
	if c.LatencyOffset < 0 {
		return newTake{}, &lyricsheet.InvalidError{Msg: "a latency offset can't be negative"}
	}
	return newTake{Captured: c, wav: wav, size: file.Size, duration: duration,
		start: c.CaptureStart - c.LatencyOffset}, nil
}

// insert stores the Take, numbered and at a position in a source span, in
// no Clip yet, and returns its id.
func (t newTake) insert(ctx context.Context, tx *sql.Tx, songID int64, number int, position float64) (int64, error) {
	peaks, err := json.Marshal(t.Peaks)
	if err != nil {
		return 0, err
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO takes (song_id, number, size, duration, sample_rate, peaks,
			latency_offset, position, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		songID, number, t.size, t.duration, t.wav.SampleRate, string(peaks), t.LatencyOffset, position,
		time.Now().UTC().Format(timeFormat))
	if err != nil {
		return 0, fmt.Errorf("adding take: %w", err)
	}
	return res.LastInsertId()
}

// addTake runs a change to the Song's Timeline that adds a Take uploaded
// as file, and keeps the file under the id the change gives it, if it's
// made. Otherwise the file is discarded.
func (s *Store) addTake(ctx context.Context, songID int64, based lyricsheet.Version, file *audio.Received,
	add func(tx *sql.Tx) (int64, error)) (Timeline, error) {
	var kept int64
	tl, err := s.change(ctx, songID, based, func(tx *sql.Tx) error {
		takeID, err := add(tx)
		if err != nil {
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

// Retake records another Take into a Clip of Takes, as its next number and
// its active Take. It leads in from before the Clip's start like the first,
// and where it starts before the Clip's source span, the span is taken back
// to where it starts, the Takes already there staying where they are on the
// Timeline. The Clip grows to where it ends, but never past the next Clip
// on its Track: the rest is kept, hidden, to trim into view once there's
// room. The file is kept if the Take is added, and discarded otherwise.
func (s *Store) Retake(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64, c Captured, file *audio.Received) (Timeline, error) {
	defer file.Discard()
	take, err := readTake(file, c)
	if err != nil {
		return Timeline{}, err
	}
	return s.addTake(ctx, songID, based, file, func(tx *sql.Tx) (int64, error) {
		p, err := clipPlacement(ctx, tx, songID, clipID)
		if err != nil {
			return 0, err
		}
		if !p.source.activeTakeID.Valid {
			return 0, &lyricsheet.InvalidError{Msg: "only a Clip of Takes can be retaken"}
		}
		if take.end() <= p.start+tolerance {
			return 0, errTakeTooEarly
		}
		if err := takeSpanBack(ctx, tx, clipID, &p, (p.start-p.offset)-take.start); err != nil {
			return 0, err
		}
		var next sql.NullFloat64
		if err := tx.QueryRowContext(ctx, `SELECT MIN(start) FROM clips WHERE track_id = ? AND id != ? AND start >= ?`,
			p.trackID, clipID, p.start+p.length-tolerance).Scan(&next); err != nil {
			return 0, fmt.Errorf("finding the next clip: %w", err)
		}
		end := take.end()
		if next.Valid {
			end = min(end, next.Float64)
		}
		p.length = max(p.length, end-p.start)
		number := p.source.lastTakeNumber + 1
		takeID, err := take.insert(ctx, tx, songID, number, take.start-(p.start-p.offset))
		if err != nil {
			return 0, err
		}
		if err := attachTakes(ctx, tx, clipID, []int64{takeID}); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE clips SET active_take_id = ?, last_take_number = ? WHERE id = ?`,
			takeID, number, clipID); err != nil {
			return 0, fmt.Errorf("retaking clip: %w", err)
		}
		return takeID, place(ctx, tx, clipID, p)
	})
}

// takeSpanBack has a Clip of Takes' source span start earlier by some
// seconds, if any, its Takes and its window staying where they are on the
// Timeline.
func takeSpanBack(ctx context.Context, tx *sql.Tx, clipID int64, p *placement, earlier float64) error {
	if earlier <= 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE takes SET position = position + ? WHERE clip_id = ?`,
		earlier, clipID); err != nil {
		return fmt.Errorf("moving takes: %w", err)
	}
	p.offset += earlier
	return nil
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
}

// TakeAt is a Take, where it starts in its Clip's source span, and how far
// it's nudged, in seconds.
type TakeAt struct {
	ID       int64   `json:"id"`
	Position float64 `json:"position"`
	Nudge    float64 `json:"nudge"`
}

// SetTakes sets a Clip of Takes as it's to be, e.g. to undo or redo a
// Retake exactly. Takes of the Song it's given are put in it, from the
// Clip or detached, and those it isn't given leave it, detached. It keeps
// its Track, and must stay within its Takes and clear of its neighbours.
func (s *Store) SetTakes(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64, ct ClipTakes) (Timeline, error) {
	ids := make([]int64, len(ct.Takes))
	for i, t := range ct.Takes {
		ids[i] = t.ID
		if math.IsNaN(t.Position) || math.IsInf(t.Position, 0) || t.Position < -tolerance {
			return Timeline{}, &lyricsheet.InvalidError{Msg: "a Take can't start before its Clip's source"}
		}
		if err := checkNudge(t.Nudge); err != nil {
			return Timeline{}, err
		}
	}
	if ct.ActiveTakeID == nil || !slices.Contains(ids, *ct.ActiveTakeID) {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "a Clip of Takes plays one of them"}
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		p, err := takeClip(ctx, tx, songID, clipID)
		if err != nil {
			return err
		}
		last, err := checkTakes(ctx, tx, songID, clipID, ids)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE takes SET clip_id = NULL WHERE clip_id = ?`, clipID); err != nil {
			return fmt.Errorf("detaching takes: %w", err)
		}
		for _, t := range ct.Takes {
			if _, err := tx.ExecContext(ctx, `UPDATE takes SET clip_id = ?, position = ?, nudge = ?, detached_at = NULL
				WHERE id = ?`, clipID, max(t.Position, 0), t.Nudge, t.ID); err != nil {
				return fmt.Errorf("attaching take: %w", err)
			}
		}
		if err := markDetached(ctx, tx, songID); err != nil {
			return err
		}
		src := source{activeTakeID: sql.NullInt64{Int64: *ct.ActiveTakeID, Valid: true}, takeIDs: ids}
		duration, err := src.duration(ctx, tx)
		if err != nil {
			return err
		}
		if err := checkTrim(ct.Offset, ct.Length, duration); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE clips SET active_take_id = ?,
				last_take_number = MAX(last_take_number, ?) WHERE id = ?`,
			*ct.ActiveTakeID, last, clipID); err != nil {
			return fmt.Errorf("setting takes: %w", err)
		}
		p.start, p.offset, p.length = ct.Start, max(ct.Offset, 0), ct.Length
		return place(ctx, tx, clipID, p)
	})
}

// NudgeTake moves one of a Clip's Takes by hand, to be nudge seconds from
// where it was recorded, later if positive. Only the Take moves: the Clip's
// window stays where it is, and where the Take goes before the Clip's source
// span, the span is taken back to where it starts, as for a Retake. It's
// refused if the Clip would then play past where its Takes end, which only
// a Clip trimmed out to a Take nudged later can.
func (s *Store) NudgeTake(ctx context.Context, songID int64, based lyricsheet.Version, clipID, takeID int64, nudge float64) (Timeline, error) {
	if err := checkNudge(nudge); err != nil {
		return Timeline{}, err
	}
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		p, err := takeClip(ctx, tx, songID, clipID)
		if err != nil {
			return err
		}
		if !slices.Contains(p.source.takeIDs, takeID) {
			return lyricsheet.ErrNotFound
		}
		var position, was float64
		if err := tx.QueryRowContext(ctx, `SELECT position, nudge FROM takes WHERE id = ?`, takeID).
			Scan(&position, &was); err != nil {
			return fmt.Errorf("reading take: %w", err)
		}
		position += nudge - was
		if err := takeSpanBack(ctx, tx, clipID, &p, -position); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE takes SET position = MAX(0, ?), nudge = ? WHERE id = ?`,
			position, nudge, takeID); err != nil {
			return fmt.Errorf("nudging take: %w", err)
		}
		end, err := p.source.duration(ctx, tx)
		if err != nil {
			return err
		}
		if p.offset+p.length > end+tolerance {
			return &lyricsheet.InvalidError{Msg: "the Clip would play past where its Takes end; trim it first"}
		}
		return place(ctx, tx, clipID, p)
	})
}

// checkNudge checks how far a Take is nudged.
func checkNudge(nudge float64) error {
	if math.IsNaN(nudge) || math.IsInf(nudge, 0) {
		return &lyricsheet.InvalidError{Msg: "a nudge must be a number"}
	}
	return nil
}

// takeClip reads where one of the Song's Clips of Takes is and what it
// plays.
func takeClip(ctx context.Context, tx *sql.Tx, songID, clipID int64) (placement, error) {
	p, err := clipPlacement(ctx, tx, songID, clipID)
	if err != nil {
		return placement{}, err
	}
	if !p.source.activeTakeID.Valid {
		return placement{}, &lyricsheet.InvalidError{Msg: "only a Clip of Takes has Takes"}
	}
	return p, nil
}

// ChooseTake makes one of a Clip's Takes the one it plays, through the same
// window.
func (s *Store) ChooseTake(ctx context.Context, songID int64, based lyricsheet.Version, clipID, takeID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		p, err := takeClip(ctx, tx, songID, clipID)
		if err != nil {
			return err
		}
		if !slices.Contains(p.source.takeIDs, takeID) {
			return &lyricsheet.InvalidError{Msg: "a Clip of Takes plays one of them"}
		}
		return setActiveTake(ctx, tx, clipID, takeID)
	})
}

// setActiveTake makes a Take the one its Clip plays.
func setActiveTake(ctx context.Context, tx *sql.Tx, clipID, takeID int64) error {
	if _, err := tx.ExecContext(ctx, `UPDATE clips SET active_take_id = ? WHERE id = ?`, takeID, clipID); err != nil {
		return fmt.Errorf("choosing take: %w", err)
	}
	return nil
}

// DeleteTake detaches one of a Clip's Takes, to be brought back by setting
// the Clip's Takes. Deleting the active Take makes the most recent one left
// active, and deleting the last deletes the Clip. The Clip's window shrinks
// to the Takes left, as for keepTakes.
func (s *Store) DeleteTake(ctx context.Context, songID int64, based lyricsheet.Version, clipID, takeID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		p, err := takeClip(ctx, tx, songID, clipID)
		if err != nil {
			return err
		}
		if !slices.Contains(p.source.takeIDs, takeID) {
			return lyricsheet.ErrNotFound
		}
		if len(p.source.takeIDs) == 1 {
			return deleteClip(ctx, tx, songID, clipID)
		}
		keep := slices.DeleteFunc(slices.Clone(p.source.takeIDs), func(id int64) bool { return id == takeID })
		return keepTakes(ctx, tx, songID, clipID, p, keep)
	})
}

// ClearInactiveTakes detaches all of a Clip's Takes but the active one, to
// be brought back by setting the Clip's Takes. The Clip's window shrinks to
// the Take left, as for keepTakes.
func (s *Store) ClearInactiveTakes(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64) (Timeline, error) {
	return s.change(ctx, songID, based, func(tx *sql.Tx) error {
		p, err := takeClip(ctx, tx, songID, clipID)
		if err != nil {
			return err
		}
		return keepTakes(ctx, tx, songID, clipID, p, []int64{p.source.activeTakeID.Int64})
	})
}

// keepTakes detaches the Takes of a Clip, placed at p, but those in keep,
// ids of some of them in the order of their numbers. If its active Take
// goes, the most recent one kept is active. The Clip's window shrinks to end
// where the Takes kept do, and if they all end before it starts, it moves
// back to end there, its audio staying where it is on the Timeline.
func keepTakes(ctx context.Context, tx *sql.Tx, songID, clipID int64, p placement, keep []int64) error {
	for _, id := range p.source.takeIDs {
		if slices.Contains(keep, id) {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE takes SET clip_id = NULL WHERE id = ?`, id); err != nil {
			return fmt.Errorf("detaching take: %w", err)
		}
	}
	if err := markDetached(ctx, tx, songID); err != nil {
		return err
	}
	p.source.takeIDs = keep
	if !slices.Contains(keep, p.source.activeTakeID.Int64) {
		p.source.activeTakeID.Int64 = keep[len(keep)-1]
	}
	end, err := p.source.duration(ctx, tx)
	if err != nil {
		return err
	}
	if end <= p.offset+tolerance {
		back := p.offset - max(0, end-p.length)
		p.start -= back
		p.offset -= back
	}
	p.length = min(p.length, end-p.offset)
	if err := setActiveTake(ctx, tx, clipID, p.source.activeTakeID.Int64); err != nil {
		return err
	}
	return place(ctx, tx, clipID, p)
}

// takeColumns are the takes columns scanTake reads, in its order.
const takeColumns = `id, number, size, duration, sample_rate, latency_offset, position, nudge, recorded_at`

// scanTake reads one row of takeColumns. Columns selected after them are
// read into extra.
func scanTake(row interface{ Scan(...any) error }, extra ...any) (Take, error) {
	var t Take
	var recorded string
	err := row.Scan(append([]any{&t.ID, &t.Number, &t.Size, &t.Duration, &t.SampleRate, &t.LatencyOffset,
		&t.Position, &t.Nudge, &recorded}, extra...)...)
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
		return lyricsheet.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading take: %w", err)
	}
	if download {
		// A title's slashes would read as folders.
		name := fmt.Sprintf("%s - Take %d.wav", strings.NewReplacer("/", "-", `\`, "-").Replace(title), number)
		disposition := mime.FormatMediaType("attachment", map[string]string{"filename": name})
		if disposition == "" {
			disposition = "attachment"
		}
		w.Header().Set("Content-Disposition", disposition)
	}
	return s.takeFiles.Serve(w, r, takeID, takeMediaType)
}
