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

// A Merge turns Clips, on any Tracks, into one Clip of a new Sound, whose
// audio the browser renders as playback of them would sound: lossless and
// never normalised, as a Mixdown is. The Sound covers exactly the Clips'
// span, so the merged Clip plays all of it. The browser also says which
// Track it goes on, since it renders each Clip's level relative to that
// Track's: one of the Timeline's, or a new one added for it.

// MergedName is what a Sound made by a Merge is called, and so what its
// Clip goes by.
const MergedName = "Merged Clip"

// mergedBitDepth is a merged Clip's audio's: integer PCM, as a Take's, in
// whatever channels the browser rendered.
const mergedBitDepth = 24

// errNotMergedWAV is refusing merged audio that isn't lossless as a Mixdown is.
var errNotMergedWAV = &lyricsheet.InvalidError{Msg: "a merged Clip's audio must be a 24-bit WAV file"}

// errMergedTrack refuses a Merge that doesn't say which one Track its Clip goes on.
var errMergedTrack = &lyricsheet.InvalidError{Msg: "a merged Clip goes on one Track, of the Timeline's or a new one"}

// ClipMerge is which Clips a Merge merges, the waveform of their audio and
// the Track its Clip goes on, as the browser sends them with the file.
type ClipMerge struct {
	ClipIDs []int64 `json:"clipIds"`
	// Peaks is the waveform, 100 per second, from 0 to 1.
	Peaks []float64 `json:"peaks"`
	// TrackID is the Timeline's Track the merged Clip goes on, unless
	// NewTrack is the Track to add for it instead: exactly one is set.
	TrackID  *int64   `json:"trackId"`
	NewTrack *TrackAt `json:"newTrack"`
}

// MergeClips replaces two or more of the Song's Clips with one Clip of a
// new Sound, "Merged Clip", from the file: the audio they play together,
// from the earliest one's start to the latest one's end, which the file
// must last. It goes on the Track m names, or on the new Track m names,
// added there, and can't overlap a Clip left on it. Their Takes are
// detached, as deleting them does. The file is kept if the Merge is made,
// and discarded otherwise.
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
	if (m.TrackID == nil) == (m.NewTrack == nil) {
		return Timeline{}, errMergedTrack
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
	return s.changeWithFiles(ctx, songID, based, func(tx *sql.Tx, changes *audio.FileChanges) error {
		start, end, err := mergedSpan(ctx, tx, songID, m.ClipIDs)
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
		trackID, err := m.landingTrack(ctx, tx, songID)
		if err != nil {
			return err
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
		changes.Keep(file, soundID)
		return addClip(ctx, tx, songID, trackID, NewClip{SoundID: &soundID, Start: start, Length: length})
	})
}

// mergedSpan is where on the Timeline the earliest of the Song's Clips
// starts and the latest ends.
func mergedSpan(ctx context.Context, tx *sql.Tx, songID int64, clipIDs []int64) (start, end float64, err error) {
	for i, id := range clipIDs {
		p, err := clipPlacement(ctx, tx, songID, id)
		if err != nil {
			return 0, 0, err
		}
		if i == 0 {
			start, end = p.start, p.start+p.length
			continue
		}
		start, end = min(start, p.start), max(end, p.start+p.length)
	}
	return start, end, nil
}

// landingTrack is the id of the Track a merged Clip goes on: the Song's Track m
// names, or the new one, which it adds where m says.
func (m ClipMerge) landingTrack(ctx context.Context, tx *sql.Tx, songID int64) (int64, error) {
	if m.NewTrack == nil {
		return *m.TrackID, findTrackToPlaceOn(ctx, tx, songID, *m.TrackID)
	}
	added, err := insertTracksAt(ctx, tx, songID, []TrackAt{*m.NewTrack})
	if err != nil {
		return 0, err
	}
	return added[0], nil
}

// ReplaceClips deletes Clips from the Timeline and places others on its
// Tracks in one step, as DeleteClips and PlaceClips do: e.g. to undo a
// Merge by placing back the Clips it merged, or to redo it by placing its
// Clip back. The Tracks trackIDs are deleted after the Clips, and newTracks
// added, in order, before the Clips are placed, for them to go on: e.g. the
// Track a Merge added for its Clip. If any can't be deleted, added or
// placed, nothing changes.
func (s *Store) ReplaceClips(ctx context.Context, songID int64, based lyricsheet.Version, clipIDs, trackIDs []int64,
	newTracks []TrackAt, clips []PlacedClip) (Timeline, error) {
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
		for _, id := range trackIDs {
			if err := deleteTrack(ctx, tx, songID, id); err != nil {
				return err
			}
		}
		added, err := insertTracksAt(ctx, tx, songID, newTracks)
		if err != nil {
			return err
		}
		for _, c := range clips {
			trackID, err := c.trackOf(added)
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
