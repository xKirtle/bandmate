package timeline

import (
	"context"
	"database/sql"
	"errors"
	"slices"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
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
var errNotMergedWAV = domain.Invalid("a merged Clip's audio must be a 24-bit WAV file")

// errMergedTrack refuses a Merge that doesn't say which one Track its Clip goes on.
var errMergedTrack = domain.Invalid("a merged Clip goes on one Track, of the Timeline's or a new one")

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
func (s *Store) MergeClips(ctx context.Context, songID int64, based songversion.Version, m ClipMerge,
	file *audio.Received) (Timeline, error) {
	defer file.Discard()
	if len(m.ClipIDs) < 2 {
		return Timeline{}, domain.Invalid("merge two or more Clips")
	}
	for i, id := range m.ClipIDs {
		if slices.Contains(m.ClipIDs[:i], id) {
			return Timeline{}, domain.Invalid("each Clip can only be merged once")
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
		return Timeline{}, domain.Invalid(msg)
	}
	merged := Sound{Name: MergedName, FileName: MergedName + ".wav", Size: file.Size, Duration: duration}
	return s.editTimelineReading(ctx, songID, based,
		func(ctx context.Context, tx *sql.Tx, changes *audio.FileChanges, _ Timeline) (edit, error) {
			snd, err := insertSound(ctx, tx, songID, merged, takeMediaType, m.Peaks)
			if err != nil {
				return nil, err
			}
			changes.Keep(file, snd.ID)
			return func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.merging(m, snd, float64(wav.SampleRate), ids)
			}, nil
		})
}

// mergedSpan is where on the Timeline the earliest of tl's Clips merged
// starts and the latest ends.
func (tl Timeline) mergedSpan(clipIDs []int64) (start, end float64, err error) {
	for i, id := range clipIDs {
		_, c, err := tl.findClip(id)
		if err != nil {
			return 0, 0, err
		}
		if i == 0 {
			start, end = c.Start, c.Start+c.Length
			continue
		}
		start, end = min(start, c.Start), max(end, c.Start+c.Length)
	}
	return start, end, nil
}

// ReplaceClips deletes Clips from the Timeline and places others on its
// Tracks in one step, as DeleteClips and PlaceClips do: e.g. to undo a
// Merge by placing back the Clips it merged, or to redo it by placing its
// Clip back. The Tracks trackIDs go too, with any Clips left on them, and
// an empty Track of each of newTracks is added where it says, for the Clips
// to go on: e.g. the Track a Merge added for its Clip. A Clip it places can
// have the Takes of one it takes off. If any can't be deleted, added or
// placed, nothing changes.
func (s *Store) ReplaceClips(ctx context.Context, songID int64, based songversion.Version, clipIDs, trackIDs []int64,
	newTracks []TrackAt, clips []PlacedClip) (Timeline, error) {
	if len(clipIDs) == 0 {
		return Timeline{}, domain.Invalid("clipIds are required")
	}
	if len(clips) == 0 {
		return Timeline{}, domain.Invalid("clips are required")
	}
	if err := checkDeletedOnce(clipIDs); err != nil {
		return Timeline{}, err
	}
	return s.editTimelineReading(ctx, songID, based,
		func(ctx context.Context, tx *sql.Tx, _ *audio.FileChanges, before Timeline) (edit, error) {
			// The Clips it takes off the Timeline give their Takes up, so
			// one of them can go in a Clip it places back.
			sources, err := readPlacedSources(ctx, tx, songID, clips, before.clipsLeaving(clipIDs, trackIDs))
			if err != nil {
				return nil, err
			}
			return func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.replacingClips(clipIDs, trackIDs, newTracks, clips, sources, ids)
			}, nil
		})
}
