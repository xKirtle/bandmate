package app

import (
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
		BeatID *int64 `json:"beatId"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		if req.BeatID == nil {
			return timeline.Timeline{}, &lyricsheet.InvalidError{Msg: "beatId is required"}
		}
		return a.timelines.AddBeat(r.Context(), id, based, *req.BeatID)
	})
}

func (a *App) renameTrack(w http.ResponseWriter, r *http.Request) {
	trackID, ok := pathID(w, r, "trackID")
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	a.changeTimeline(w, r, &req, func(id int64, based lyricsheet.Version) (timeline.Timeline, error) {
		return a.timelines.RenameTrack(r.Context(), id, based, trackID, req.Name)
	})
}

// changeTimeline reads the Song id, the version the change is based on and
// the request body into req, runs the change and writes the resulting
// Timeline.
func (a *App) changeTimeline(w http.ResponseWriter, r *http.Request, req any,
	change func(songID int64, based lyricsheet.Version) (timeline.Timeline, error)) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok || !readJSON(w, r, req) {
		return
	}
	tl, err := change(id, based)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tl)
}
