package app

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

func (a *App) listSongs(w http.ResponseWriter, r *http.Request) {
	list, err := a.songs.ListSongs(r.Context())
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *App) createSong(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title string `json:"title"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	song, err := a.songs.CreateSong(r.Context(), req.Title)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, song)
}

func (a *App) getSong(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	song, err := a.songs.GetSong(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, song)
}

// readJSON decodes the request body into v, answering 400 if it can't.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "request body must be valid JSON")
		return false
	}
	return true
}

// songID parses the {id} path parameter, answering 404 if it isn't a number.
func songID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return 0, false
	}
	return id, true
}

// writeDomainError maps Lyric Sheet errors onto HTTP responses.
func writeDomainError(w http.ResponseWriter, err error) {
	var invalid *lyricsheet.InvalidError
	switch {
	case errors.As(err, &invalid):
		writeError(w, http.StatusBadRequest, invalid.Msg)
	case errors.Is(err, lyricsheet.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		log.Printf("internal error: %v", err)
		writeError(w, http.StatusInternalServerError, "something went wrong")
	}
}
