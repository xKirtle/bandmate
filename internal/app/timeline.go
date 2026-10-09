package app

import (
	"context"
	"net/http"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
	"github.com/xKirtle/bandmate/internal/timeline"
)

// Every Timeline change answers with the full, updated Timeline, and counts
// as editing the Song. Each is based on the Song version in the request's
// If-Match header, if any.

func (a *App) getTimeline(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	tl, err := a.timelines.Get(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tl)
}

func (a *App) addBeatToTimeline(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TrackID *int64 `json:"trackId"`
		BeatID  *int64 `json:"beatId"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		if req.TrackID == nil || req.BeatID == nil {
			return timeline.Timeline{}, domain.Invalid("trackId and beatId are required")
		}
		return a.timelines.AddBeat(r.Context(), id, based, *req.TrackID, *req.BeatID)
	})
}

func (a *App) updateTrack(w http.ResponseWriter, r *http.Request) {
	trackID, ok := pathID(w, r, "trackID")
	if !ok {
		return
	}
	var changes timeline.TrackChanges
	a.changeTimeline(w, r, &changes, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		return a.timelines.UpdateTrack(r.Context(), id, based, trackID, changes)
	})
}

func (a *App) addTrack(w http.ResponseWriter, r *http.Request) {
	var req timeline.NewTrack
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		return a.timelines.AddTrack(r.Context(), id, based, req)
	})
}

func (a *App) deleteTrack(w http.ResponseWriter, r *http.Request) {
	trackID, ok := pathID(w, r, "trackID")
	if !ok {
		return
	}
	a.changeTimeline(w, r, nil, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		return a.timelines.DeleteTrack(r.Context(), id, based, trackID)
	})
}

func (a *App) reorderTracks(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Tracks []int64 `json:"tracks"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		return a.timelines.ReorderTracks(r.Context(), id, based, req.Tracks)
	})
}

func (a *App) setLoop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Start *float64 `json:"start"`
		End   *float64 `json:"end"`
		On    bool     `json:"on"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		if req.Start == nil || req.End == nil {
			return timeline.Timeline{}, domain.Invalid("start and end are required")
		}
		return a.timelines.SetLoop(r.Context(), id, based, *req.Start, *req.End, req.On)
	})
}

func (a *App) switchLoop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		On *bool `json:"on"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		if req.On == nil {
			return timeline.Timeline{}, domain.Invalid("on is required")
		}
		return a.timelines.SwitchLoop(r.Context(), id, based, *req.On)
	})
}

func (a *App) clearLoop(w http.ResponseWriter, r *http.Request) {
	a.changeTimeline(w, r, nil, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		return a.timelines.ClearLoop(r.Context(), id, based)
	})
}

func (a *App) moveClip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TrackID *int64   `json:"trackId"`
		Start   *float64 `json:"start"`
	}
	a.changeClip(w, r, &req, func(ctx context.Context, id int64, based songversion.Version, clipID int64) (timeline.Timeline, error) {
		if req.TrackID == nil || req.Start == nil {
			return timeline.Timeline{}, domain.Invalid("trackId and start are required")
		}
		return a.timelines.MoveClip(ctx, id, based, clipID, *req.TrackID, *req.Start)
	})
}

func (a *App) moveClips(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Clips []timeline.ClipMove `json:"clips"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		return a.timelines.MoveClips(r.Context(), id, based, req.Clips)
	})
}

func (a *App) setClipTempos(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Clips []timeline.ClipTempo `json:"clips"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		return a.timelines.SetClipTempos(r.Context(), id, based, req.Clips)
	})
}

func (a *App) setClipPitches(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Clips []timeline.ClipPitch `json:"clips"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		return a.timelines.SetClipPitches(r.Context(), id, based, req.Clips)
	})
}

func (a *App) trimClip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Offset *float64 `json:"offset"`
		Length *float64 `json:"length"`
		// FadeIn and FadeOut, given together, set the Clip's Fades, e.g.
		// to undo a trim that shortened them.
		FadeIn  *float64 `json:"fadeIn"`
		FadeOut *float64 `json:"fadeOut"`
	}
	a.changeClip(w, r, &req, func(ctx context.Context, id int64, based songversion.Version, clipID int64) (timeline.Timeline, error) {
		if req.Offset == nil || req.Length == nil {
			return timeline.Timeline{}, domain.Invalid("offset and length are required")
		}
		fades, err := timeline.FadesGiven(req.FadeIn, req.FadeOut)
		if err != nil {
			return timeline.Timeline{}, err
		}
		return a.timelines.TrimClip(ctx, id, based, clipID, *req.Offset, *req.Length, fades)
	})
}

// clipToPlace is a Clip to place on a Track, as a request gives it: on one
// of the Timeline's Tracks, or, by its index, on a Track the request adds.
type clipToPlace struct {
	TrackID  *int64  `json:"trackId"`
	NewTrack *int    `json:"newTrack"`
	BeatID   *int64  `json:"beatId"`
	SoundID  *int64  `json:"soundId"`
	Name     *string `json:"name"`
	Gain     float64 `json:"gain"`
	// Tempo is a ratio of as recorded, 1 if not given.
	Tempo *float64 `json:"tempo"`
	// Pitch is in semitones, 0 if not given.
	Pitch        float64  `json:"pitch"`
	FadeIn       float64  `json:"fadeIn"`
	FadeOut      float64  `json:"fadeOut"`
	TakeIDs      []int64  `json:"takeIds"`
	ActiveTakeID *int64   `json:"activeTakeId"`
	Start        *float64 `json:"start"`
	Offset       *float64 `json:"offset"`
	Length       *float64 `json:"length"`
}

// placed is the Clip and the Track it goes on, if the request gave both,
// the Track as one of the Timeline's or one the request adds, not both.
func (c clipToPlace) placed() (timeline.PlacedClip, error) {
	if c.TrackID != nil && c.NewTrack != nil {
		return timeline.PlacedClip{}, domain.Invalid("a Clip goes on a Track or a new Track, not both")
	}
	if (c.TrackID == nil && c.NewTrack == nil) || c.Start == nil || c.Offset == nil || c.Length == nil {
		return timeline.PlacedClip{}, domain.Invalid("trackId or newTrack, start, offset and length are required")
	}
	tempo := 1.0
	if c.Tempo != nil {
		tempo = *c.Tempo
	}
	on := timeline.OnTrack{NewTrack: c.NewTrack}
	if c.TrackID != nil {
		on.TrackID = *c.TrackID
	}
	return timeline.PlacedClip{OnTrack: on, NewClip: timeline.NewClip{
		BeatID: c.BeatID, SoundID: c.SoundID, Name: c.Name, Gain: c.Gain, Tempo: tempo, Pitch: c.Pitch, FadeIn: c.FadeIn, FadeOut: c.FadeOut,
		TakeIDs: c.TakeIDs, ActiveTakeID: c.ActiveTakeID,
		Start: *c.Start, Offset: *c.Offset, Length: *c.Length,
	}}, nil
}

// placedClips is each Clip and the Track it goes on, as placed reads them.
func placedClips(cs []clipToPlace) ([]timeline.PlacedClip, error) {
	clips := make([]timeline.PlacedClip, len(cs))
	for i, c := range cs {
		p, err := c.placed()
		if err != nil {
			return nil, err
		}
		clips[i] = p
	}
	return clips, nil
}

func (a *App) placeClip(w http.ResponseWriter, r *http.Request) {
	var req clipToPlace
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		p, err := req.placed()
		if err != nil {
			return timeline.Timeline{}, err
		}
		if p.NewTrack != nil {
			return timeline.Timeline{}, domain.Invalid("there's no such new Track")
		}
		return a.timelines.PlaceClip(r.Context(), id, based, p.TrackID, p.NewClip)
	})
}

func (a *App) placeClips(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NewTracks []newTrack    `json:"newTracks"`
		Clips     []clipToPlace `json:"clips"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		clips, err := placedClips(req.Clips)
		if err != nil {
			return timeline.Timeline{}, err
		}
		return a.timelines.PlaceClips(r.Context(), id, based, trackNames(req.NewTracks), clips)
	})
}

func (a *App) renameClip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name *string `json:"name"`
	}
	a.changeClip(w, r, &req, func(ctx context.Context, id int64, based songversion.Version, clipID int64) (timeline.Timeline, error) {
		if req.Name == nil {
			return timeline.Timeline{}, domain.Invalid("name is required")
		}
		return a.timelines.RenameClip(ctx, id, based, clipID, *req.Name)
	})
}

func (a *App) setClipGain(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Gain *float64 `json:"gain"`
	}
	a.changeClip(w, r, &req, func(ctx context.Context, id int64, based songversion.Version, clipID int64) (timeline.Timeline, error) {
		if req.Gain == nil {
			return timeline.Timeline{}, domain.Invalid("gain is required")
		}
		return a.timelines.SetClipGain(ctx, id, based, clipID, *req.Gain)
	})
}

func (a *App) setClipFades(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FadeIn  *float64 `json:"fadeIn"`
		FadeOut *float64 `json:"fadeOut"`
	}
	a.changeClip(w, r, &req, func(ctx context.Context, id int64, based songversion.Version, clipID int64) (timeline.Timeline, error) {
		if req.FadeIn == nil || req.FadeOut == nil {
			return timeline.Timeline{}, domain.Invalid("fadeIn and fadeOut are required")
		}
		return a.timelines.SetClipFades(ctx, id, based, clipID, timeline.Fades{In: *req.FadeIn, Out: *req.FadeOut})
	})
}

func (a *App) duplicateClip(w http.ResponseWriter, r *http.Request) {
	a.changeClip(w, r, nil, a.timelines.DuplicateClip)
}

// newTrack is a Track to add at the bottom for Clips placed or pasted at
// once to go on, as a request gives it.
type newTrack struct {
	Name string `json:"name"`
}

// trackNames is the names of the Tracks to add.
func trackNames(tracks []newTrack) []string {
	names := make([]string, len(tracks))
	for i, t := range tracks {
		names[i] = t.Name
	}
	return names
}

// clipToPaste is a Clip as it was copied, to paste on a Track, as a request
// gives it: as a Clip to place, but with a Clip of Takes' Takes as they
// were, rather than their ids.
type clipToPaste struct {
	clipToPlace
	Takes []timeline.TakeAt `json:"takes"`
}

// copied is the Clip as it was copied and the Track it goes on, if the
// request gave both, as placed reads them.
func (c clipToPaste) copied() (timeline.ClipCopy, error) {
	p, err := c.placed()
	if err != nil {
		return timeline.ClipCopy{}, err
	}
	return timeline.ClipCopy{OnTrack: p.OnTrack, BeatID: p.BeatID, SoundID: p.SoundID, Name: p.Name, Gain: p.Gain, Tempo: p.Tempo, Pitch: p.Pitch,
		FadeIn: p.FadeIn, FadeOut: p.FadeOut,
		Takes: c.Takes, ActiveTakeID: p.ActiveTakeID, Start: p.Start, Offset: p.Offset, Length: p.Length}, nil
}

func (a *App) pasteClips(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NewTracks []newTrack    `json:"newTracks"`
		Clips     []clipToPaste `json:"clips"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		clips := make([]timeline.ClipCopy, len(req.Clips))
		for i, c := range req.Clips {
			copied, err := c.copied()
			if err != nil {
				return timeline.Timeline{}, err
			}
			clips[i] = copied
		}
		return a.timelines.PasteClips(r.Context(), id, based, trackNames(req.NewTracks), clips)
	})
}

func (a *App) deleteClips(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ClipIDs []int64 `json:"clipIds"`
		// TrackIDs are Tracks to delete too, e.g. those a paste added.
		TrackIDs []int64 `json:"trackIds"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		return a.timelines.DeleteClips(r.Context(), id, based, req.ClipIDs, req.TrackIDs)
	})
}

// mergeClips takes the audio of Clips merged, rendered by the browser as a
// 24-bit WAV, with which Clips they are and the Track their Clip goes on as
// "details", as a new Sound, in a Clip that replaces them.
func (a *App) mergeClips(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok {
		return
	}
	var m timeline.ClipMerge
	file, ok := a.readUpload(w, r, a.soundFiles, &m)
	if !ok {
		return
	}
	tl, err := a.timelines.MergeClips(r.Context(), id, based, m, file.Received)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tl)
}

// replaceClips deletes Clips, and Tracks after them, and places others, on
// Tracks added for them first if need be, in one step, e.g. to undo or
// redo a Merge.
func (a *App) replaceClips(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ClipIDs   []int64            `json:"clipIds"`
		TrackIDs  []int64            `json:"trackIds"`
		NewTracks []timeline.TrackAt `json:"newTracks"`
		Clips     []clipToPlace      `json:"clips"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		clips, err := placedClips(req.Clips)
		if err != nil {
			return timeline.Timeline{}, err
		}
		return a.timelines.ReplaceClips(r.Context(), id, based, req.ClipIDs, req.TrackIDs, req.NewTracks, clips)
	})
}

func (a *App) splitClips(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ClipIDs []int64  `json:"clipIds"`
		At      *float64 `json:"at"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		if req.At == nil {
			return timeline.Timeline{}, domain.Invalid("at is required")
		}
		return a.timelines.SplitClips(r.Context(), id, based, req.ClipIDs, *req.At)
	})
}

func (a *App) deleteClip(w http.ResponseWriter, r *http.Request) {
	a.changeClip(w, r, nil, a.timelines.DeleteClip)
}

// changeClip is changeTimeline for a change to the Clip in the request's
// path.
func (a *App) changeClip(w http.ResponseWriter, r *http.Request, req any,
	change func(ctx context.Context, songID int64, based songversion.Version, clipID int64) (timeline.Timeline, error)) {
	clipID, ok := pathID(w, r, "clipID")
	if !ok {
		return
	}
	a.changeTimeline(w, r, req, func(id int64, based songversion.Version) (timeline.Timeline, error) {
		return change(r.Context(), id, based, clipID)
	})
}

// changeTimeline reads the Song id, the version the change is based on and
// the request body, if any, into req, runs the change and writes the resulting
// Timeline.
func (a *App) changeTimeline(w http.ResponseWriter, r *http.Request, req any,
	change func(songID int64, based songversion.Version) (timeline.Timeline, error)) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok || (req != nil && !readJSON(w, r, req)) {
		return
	}
	tl, err := change(id, based)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tl)
}
