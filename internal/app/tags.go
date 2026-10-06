package app

import (
	"errors"
	"net/http"

	"github.com/xKirtle/bandmate/internal/tags"
)

// listTags lists every Tag, with how many Songs carry each, for suggesting
// them as a Song is tagged.
func (a *App) listTags(w http.ResponseWriter, r *http.Request) {
	list, err := a.tags.List(r.Context())
	if err != nil {
		writeTagError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// setSongTags gives a Song exactly the Tags named, made where there's none,
// and answers with their names.
func (a *App) setSongTags(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	var req struct {
		Tags *[]string `json:"tags"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.Tags == nil {
		writeError(w, http.StatusBadRequest, "tags must be a list of names")
		return
	}
	names, err := a.tags.SetSongTags(r.Context(), id, *req.Tags)
	if err != nil {
		writeTagError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, names)
}

// writeTagError maps Tag errors onto HTTP responses.
func writeTagError(w http.ResponseWriter, err error) {
	var invalid *tags.InvalidError
	switch {
	case errors.As(err, &invalid):
		writeError(w, http.StatusBadRequest, invalid.Msg)
	case errors.Is(err, tags.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		writeDomainError(w, err)
	}
}
