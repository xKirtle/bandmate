package timeline

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// A Merge turns Clips on one Track into one Clip of a new Sound, whose
// audio the browser renders as playback of them would sound: lossless and
// never normalised, as a Mixdown is. The Sound covers exactly the Clips'
// span, so the merged Clip plays all of it.

// MergedName is what a Sound made by a Merge is called, and so what its
// Clip goes by.
const MergedName = "Merged Clip"

// mergedBitDepth is a merged Clip's audio's: integer PCM, as a Take's, in
// whatever channels the browser rendered.
const mergedBitDepth = 24

// errNotMergedWAV is refusing merged audio that isn't lossless as a Mixdown is.
var errNotMergedWAV = &lyricsheet.InvalidError{Msg: "a merged Clip's audio must be a 24-bit WAV file"}

// ClipMerge is which Clips a Merge merges and the waveform of their audio,
// as the browser sends it with the file.
type ClipMerge struct {
	ClipIDs []int64 `json:"clipIds"`
	// Peaks is the waveform, 100 per second, from 0 to 1.
	Peaks []float64 `json:"peaks"`
}

// MergeClips replaces two or more Clips on one Track of the Song with one
// Clip of a new Sound, "Merged Clip", from the file: the audio they play
// together, from the earliest one's start to the latest one's end, which
// the file must last. Their Takes are detached, as deleting them does. The
// file is kept if the Merge is made, and discarded otherwise.
func (s *Store) MergeClips(ctx context.Context, songID int64, based lyricsheet.Version, m ClipMerge,
	file *audio.Received) (Timeline, error) {
	defer file.Discard()
	if len(m.ClipIDs) < 2 {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "merge two or more Clips"}
	}
	for i, id := range m.ClipIDs {
		if slices.Contains(m.ClipIDs[:i], id) {
			return Timeline{}, &lyricsheet.InvalidError{Msg: "each Clip can only be merged once"}
		}
	}
	wav, err := file.ReadWAV()
	if errors.Is(err, audio.ErrNotWAV) || (err == nil && (wav.Format != pcmFormat || wav.BitsPerSample != mergedBitDepth)) {
		return Timeline{}, errNotMergedWAV
	}
	if err != nil {
		return Timeline{}, err
	}
	duration := wav.Duration()
	if msg := (audio.Upload{Duration: duration, Peaks: m.Peaks}).Problem(); msg != "" {
		return Timeline{}, &lyricsheet.InvalidError{Msg: msg}
	}
	peaks, err := json.Marshal(m.Peaks)
	if err != nil {
		return Timeline{}, err
	}
	var kept int64
	tl, err := s.change(ctx, songID, based, func(tx *sql.Tx) error {
		trackID, start, end, err := mergedSpan(ctx, tx, songID, m.ClipIDs)
		if err != nil {
			return err
		}
		// Rendered to whole samples, it may fall short by part of one.
		length := end - start
		if duration < length-1/float64(wav.SampleRate) {
			return &lyricsheet.InvalidError{Msg: "the merged audio must last as long as the Clips merged"}
		}
		length = min(length, duration)
		for _, id := range m.ClipIDs {
			if err := deleteClip(ctx, tx, songID, id); err != nil {
				return err
			}
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO sounds (song_id, name, file_name, content_type, size, duration,
				peaks, added_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			songID, MergedName, MergedName+".wav", takeMediaType, file.Size, duration, string(peaks),
			time.Now().UTC().Format(timeFormat))
		if err != nil {
			return fmt.Errorf("adding sound: %w", err)
		}
		soundID, err := res.LastInsertId()
		if err != nil {
			return err
		}
		if err := addClip(ctx, tx, songID, trackID,
			NewClip{SoundID: &soundID, Start: start, Length: length}); err != nil {
			return err
		}
		// Kept last, so nothing after it can fail but the commit.
		if err := file.Keep(soundID); err != nil {
			return err
		}
		kept = soundID
		return nil
	})
	if err != nil && kept != 0 {
		s.removeSoundFiles([]int64{kept})
	}
	return tl, err
}

// mergedSpan is the Track the Song's Clips are on, which must be the same
// one, and where on the Timeline the earliest starts and the latest ends.
func mergedSpan(ctx context.Context, tx *sql.Tx, songID int64, clipIDs []int64) (trackID int64, start, end float64, err error) {
	for i, id := range clipIDs {
		p, err := clipPlacement(ctx, tx, songID, id)
		if err != nil {
			return 0, 0, 0, err
		}
		if i == 0 {
			trackID, start, end = p.trackID, p.start, p.start+p.length
			continue
		}
		if p.trackID != trackID {
			return 0, 0, 0, &lyricsheet.InvalidError{Msg: "Clips merged must be on one Track"}
		}
		start, end = min(start, p.start), max(end, p.start+p.length)
	}
	return trackID, start, end, nil
}

// ReplaceClips deletes Clips from the Timeline and places others on its
// Tracks in one step, as DeleteClips and PlaceClips do: e.g. to undo a
// Merge by placing back the Clips it merged, or to redo it by placing its
// Clip back. If any can't be deleted or placed, nothing changes.
func (s *Store) ReplaceClips(ctx context.Context, songID int64, based lyricsheet.Version, clipIDs []int64,
	clips []PlacedClip) (Timeline, error) {
	if len(clipIDs) == 0 {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "clipIds are required"}
	}
	if len(clips) == 0 {
		return Timeline{}, &lyricsheet.InvalidError{Msg: "clips are required"}
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
		for _, c := range clips {
			trackID, err := c.trackOf(nil)
			if err != nil {
				return err
			}
			if err := placeOnTrack(ctx, tx, songID, trackID, c.NewClip); err != nil {
				return err
			}
		}
		return nil
	})
}
