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

func (a *App) placeClip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TrackID        *int64   `json:"trackId"`
		BeatID         *int64   `json:"beatId"`
		TakeIDs        []int64  `json:"takeIds"`
		ActiveTakeID   *int64   `json:"activeTakeId"`
		LastTakeNumber int      `json:"lastTakeNumber"`
		Start          *float64 `json:"start"`
		Offset         *float64 `json:"offset"`
		Length         *float64 `json:"length"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		if req.TrackID == nil || req.Start == nil || req.Offset == nil || req.Length == nil {
			return timeline.Timeline{}, &lyricsheet.InvalidError{Msg: "trackId, start, offset and length are required"}
		}
		return a.timelines.PlaceClip(r.Context(), id, based, *req.TrackID, timeline.NewClip{
			BeatID: req.BeatID, TakeIDs: req.TakeIDs, ActiveTakeID: req.ActiveTakeID, LastTakeNumber: req.LastTakeNumber,
			Start: *req.Start, Offset: *req.Offset, Length: *req.Length,
		})
	})
}

func (a *App) duplicateClip(w http.ResponseWriter, r *http.Request) {
	a.changeClip(w, r, nil, a.timelines.DuplicateClip)
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
