package app

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

func (a *App) listSongs(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	filter := lyricsheet.SongFilter{
		Status: lyricsheet.Status(query.Get("status")),
		Title:  query.Get("q"),
	}
	list, err := a.songs.ListSongs(r.Context(), filter)
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

func (a *App) updateSong(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	var changes lyricsheet.SongChanges
	if !readJSON(w, r, &changes) {
		return
	}
	song, err := a.songs.UpdateSong(r.Context(), id, changes)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, song)
}

func (a *App) deleteSong(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	if err := a.songs.DeleteSong(r.Context(), id); err != nil {
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// readJSON decodes the request body into v, answering 400 if it can't or if
// it names a field v doesn't have, so a typo isn't silently ignored.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		msg := "request body must be valid JSON"
		if field, ok := strings.CutPrefix(err.Error(), "json: unknown field "); ok {
			msg = "unknown field " + field
		}
		writeError(w, http.StatusBadRequest, msg)
		return false
	}
	return true
}

// songID parses the {id} path parameter, answering 404 if it isn't a number.
func songID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	return pathID(w, r, "id")
}

// pathID parses a numeric path parameter, answering 404 if it isn't a number.
func pathID(w http.ResponseWriter, r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return 0, false
	}
	return id, true
}

// writeDomainError maps Lyric Sheet errors onto HTTP responses.
func writeDomainError(w http.ResponseWriter, err error) {
	var invalid *lyricsheet.InvalidError
	var conflict *lyricsheet.ConflictError
	switch {
	case errors.As(err, &invalid):
		writeError(w, http.StatusBadRequest, invalid.Msg)
	case errors.As(err, &conflict):
		writeError(w, http.StatusConflict, conflict.Msg)
	case errors.Is(err, lyricsheet.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		log.Printf("internal error: %v", err)
		writeError(w, http.StatusInternalServerError, "something went wrong")
	}
}
