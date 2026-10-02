package app

import (
	"context"
	"net/http"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
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
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		if req.TrackID == nil || req.BeatID == nil {
			return timeline.Timeline{}, &lyricsheet.InvalidError{Msg: "trackId and beatId are required"}
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
	a.changeTimeline(w, r, &changes, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		return a.timelines.UpdateTrack(r.Context(), id, based, trackID, changes)
	})
}

func (a *App) addTrack(w http.ResponseWriter, r *http.Request) {
	var req timeline.NewTrack
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		return a.timelines.AddTrack(r.Context(), id, based, req)
	})
}

func (a *App) deleteTrack(w http.ResponseWriter, r *http.Request) {
	trackID, ok := pathID(w, r, "trackID")
	if !ok {
		return
	}
	a.changeTimeline(w, r, nil, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		return a.timelines.DeleteTrack(r.Context(), id, based, trackID)
	})
}

func (a *App) reorderTracks(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Tracks []int64 `json:"tracks"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		return a.timelines.ReorderTracks(r.Context(), id, based, req.Tracks)
	})
}

func (a *App) setLoop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Start *float64 `json:"start"`
		End   *float64 `json:"end"`
		On    bool     `json:"on"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		if req.Start == nil || req.End == nil {
			return timeline.Timeline{}, &lyricsheet.InvalidError{Msg: "start and end are required"}
		}
		return a.timelines.SetLoop(r.Context(), id, based, *req.Start, *req.End, req.On)
	})
}

func (a *App) switchLoop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		On *bool `json:"on"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		if req.On == nil {
			return timeline.Timeline{}, &lyricsheet.InvalidError{Msg: "on is required"}
		}
		return a.timelines.SwitchLoop(r.Context(), id, based, *req.On)
	})
}

func (a *App) clearLoop(w http.ResponseWriter, r *http.Request) {
	a.changeTimeline(w, r, nil, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		return a.timelines.ClearLoop(r.Context(), id, based)
	})
}

func (a *App) moveClip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TrackID *int64   `json:"trackId"`
		Start   *float64 `json:"start"`
	}
	a.changeClip(w, r, &req, func(ctx context.Context, id int64, based lyricsheet.Version, clipID int64) (timeline.Timeline, error) {
		if req.TrackID == nil || req.Start == nil {
			return timeline.Timeline{}, &lyricsheet.InvalidError{Msg: "trackId and start are required"}
		}
		return a.timelines.MoveClip(ctx, id, based, clipID, *req.TrackID, *req.Start)
	})
}

func (a *App) moveClips(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Clips []timeline.ClipMove `json:"clips"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		return a.timelines.MoveClips(r.Context(), id, based, req.Clips)
	})
}

func (a *App) trimClip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Offset *float64 `json:"offset"`
		Length *float64 `json:"length"`
	}
	a.changeClip(w, r, &req, func(ctx context.Context, id int64, based lyricsheet.Version, clipID int64) (timeline.Timeline, error) {
		if req.Offset == nil || req.Length == nil {
			return timeline.Timeline{}, &lyricsheet.InvalidError{Msg: "offset and length are required"}
		}
		return a.timelines.TrimClip(ctx, id, based, clipID, *req.Offset, *req.Length)
	})
}

// clipToPlace is a Clip to place on a Track, as a request gives it.
type clipToPlace struct {
	TrackID      *int64   `json:"trackId"`
	BeatID       *int64   `json:"beatId"`
	SoundID      *int64   `json:"soundId"`
	Name         *string  `json:"name"`
	TakeIDs      []int64  `json:"takeIds"`
	ActiveTakeID *int64   `json:"activeTakeId"`
	Start        *float64 `json:"start"`
	Offset       *float64 `json:"offset"`
	Length       *float64 `json:"length"`
}

// placed is the Clip and the Track it goes on, if the request gave both.
func (c clipToPlace) placed() (timeline.PlacedClip, error) {
	if c.TrackID == nil || c.Start == nil || c.Offset == nil || c.Length == nil {
		return timeline.PlacedClip{}, &lyricsheet.InvalidError{Msg: "trackId, start, offset and length are required"}
	}
	return timeline.PlacedClip{TrackID: *c.TrackID, NewClip: timeline.NewClip{
		BeatID: c.BeatID, SoundID: c.SoundID, Name: c.Name, TakeIDs: c.TakeIDs, ActiveTakeID: c.ActiveTakeID,
		Start: *c.Start, Offset: *c.Offset, Length: *c.Length,
	}}, nil
}

func (a *App) placeClip(w http.ResponseWriter, r *http.Request) {
	var req clipToPlace
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		p, err := req.placed()
		if err != nil {
			return timeline.Timeline{}, err
		}
		return a.timelines.PlaceClip(r.Context(), id, based, p.TrackID, p.NewClip)
	})
}

func (a *App) placeClips(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Clips []clipToPlace `json:"clips"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		clips := make([]timeline.PlacedClip, len(req.Clips))
		for i, c := range req.Clips {
			p, err := c.placed()
			if err != nil {
				return timeline.Timeline{}, err
			}
			clips[i] = p
		}
		return a.timelines.PlaceClips(r.Context(), id, based, clips)
	})
}

func (a *App) renameClip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name *string `json:"name"`
	}
	a.changeClip(w, r, &req, func(ctx context.Context, id int64, based lyricsheet.Version, clipID int64) (timeline.Timeline, error) {
		if req.Name == nil {
			return timeline.Timeline{}, &lyricsheet.InvalidError{Msg: "name is required"}
		}
		return a.timelines.RenameClip(ctx, id, based, clipID, *req.Name)
	})
}

func (a *App) duplicateClip(w http.ResponseWriter, r *http.Request) {
	a.changeClip(w, r, nil, a.timelines.DuplicateClip)
}

// clipToPaste is a Clip as it was copied, to paste on a Track, as a request
// gives it.
type clipToPaste struct {
	TrackID      *int64            `json:"trackId"`
	BeatID       *int64            `json:"beatId"`
	SoundID      *int64            `json:"soundId"`
	Name         *string           `json:"name"`
	Takes        []timeline.TakeAt `json:"takes"`
	ActiveTakeID *int64            `json:"activeTakeId"`
	Start        *float64          `json:"start"`
	Offset       *float64          `json:"offset"`
	Length       *float64          `json:"length"`
}

func (a *App) pasteClips(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Clips []clipToPaste `json:"clips"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		clips := make([]timeline.ClipCopy, len(req.Clips))
		for i, c := range req.Clips {
			if c.TrackID == nil || c.Start == nil || c.Offset == nil || c.Length == nil {
				return timeline.Timeline{}, &lyricsheet.InvalidError{Msg: "trackId, start, offset and length are required"}
			}
			clips[i] = timeline.ClipCopy{TrackID: *c.TrackID, BeatID: c.BeatID, SoundID: c.SoundID, Name: c.Name,
				Takes: c.Takes, ActiveTakeID: c.ActiveTakeID, Start: *c.Start, Offset: *c.Offset, Length: *c.Length}
		}
		return a.timelines.PasteClips(r.Context(), id, based, clips)
	})
}

func (a *App) deleteClips(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ClipIDs []int64 `json:"clipIds"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		return a.timelines.DeleteClips(r.Context(), id, based, req.ClipIDs)
	})
}

func (a *App) deleteClip(w http.ResponseWriter, r *http.Request) {
	a.changeClip(w, r, nil, a.timelines.DeleteClip)
}

// changeClip is changeTimeline for a change to the Clip in the request's
// path.
func (a *App) changeClip(w http.ResponseWriter, r *http.Request, req any,
	change func(ctx context.Context, songID int64, based lyricsheet.Version, clipID int64) (timeline.Timeline, error)) {
	clipID, ok := pathID(w, r, "clipID")
	if !ok {
		return
	}
	a.changeTimeline(w, r, req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		return change(r.Context(), id, based, clipID)
	})
}

// changeTimeline reads the Song id, the version the change is based on and
// the request body, if any, into req, runs the change and writes the resulting
// Timeline.
func (a *App) changeTimeline(w http.ResponseWriter, r *http.Request, req any,
	change func(songID int64, based lyricsheet.Version) (timeline.Timeline, error)) {
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
