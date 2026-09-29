package app

import (
	"context"
	"net/http"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
	"github.com/xKirtle/bandmate/internal/timeline"
)

// Takes are recorded into the Timeline: recording one answers with the
// full, updated Timeline, counts as editing the Song, and is based on the
// Song version in If-Match, if any.

// recordTake takes a WAV recorded in the browser, with where it was
// recorded as "details", and places it in a new Clip.
func (a *App) recordTake(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok {
		return
	}
	var rec timeline.TakePlacement
	file, ok := a.readUpload(w, r, a.takeFiles, &rec)
	if !ok {
		return
	}
	tl, err := a.timelines.RecordTake(r.Context(), id, based, rec, file.Received)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tl)
}

// getTake answers with one of the Song's Takes, with its peaks.
func (a *App) getTake(w http.ResponseWriter, r *http.Request) {
	id, takeID, ok := takePathIDs(w, r)
	if !ok {
		return
	}
	t, err := a.timelines.GetTake(r.Context(), id, takeID)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// takeAudio streams a Take's file, exactly as recorded.
func (a *App) takeAudio(w http.ResponseWriter, r *http.Request) {
	id, takeID, ok := takePathIDs(w, r)
	if !ok {
		return
	}
	if err := a.timelines.ServeTake(w, r, id, takeID); err != nil {
		writeDomainError(w, err)
	}
}

// takePathIDs parses the {id} and {takeID} path parameters.
func takePathIDs(w http.ResponseWriter, r *http.Request) (songID, takeID int64, ok bool) {
	if songID, ok = pathID(w, r, "id"); !ok {
		return 0, 0, false
	}
	takeID, ok = pathID(w, r, "takeID")
	return songID, takeID, ok
}

// retake takes a WAV recorded in the browser into a Clip of Takes, with how
// it was captured as "details", as the Clip's next Take.
func (a *App) retake(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	clipID, ok := pathID(w, r, "clipID")
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok {
		return
	}
	var c timeline.Captured
	file, ok := a.readUpload(w, r, a.takeFiles, &c)
	if !ok {
		return
	}
	tl, err := a.timelines.Retake(r.Context(), id, based, clipID, c, file.Received)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tl)
}

// setTakes sets a Clip of Takes' Takes, its active Take and its placement,
// e.g. to undo or redo a Retake.
func (a *App) setTakes(w http.ResponseWriter, r *http.Request) {
	var req timeline.ClipTakes
	a.changeClip(w, r, &req, func(ctx context.Context, id int64, based lyricsheet.Version, clipID int64) (timeline.Timeline, error) {
		return a.timelines.SetTakes(ctx, id, based, clipID, req)
	})
}
