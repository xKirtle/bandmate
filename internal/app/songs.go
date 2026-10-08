package app

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
	"github.com/xKirtle/bandmate/internal/songversion"
)

func (a *App) listSongs(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	// Several Statuses keep the Songs with any of them.
	// Several Tags keep the Songs carrying all of them.
	filter := lyricsheet.SongFilter{Title: query.Get("q"), Tags: query["tag"]}
	for _, status := range query["status"] {
		filter.Statuses = append(filter.Statuses, lyricsheet.Status(status))
	}
	switch hasMaster := query.Get("hasMaster"); hasMaster {
	case "":
	case "true", "false":
		has := hasMaster == "true"
		filter.HasMaster = &has
	default:
		writeError(w, http.StatusBadRequest, "hasMaster must be true or false")
		return
	}
	// A Folder by its id, or "none" for the Songs in no Folder.
	switch folder := query.Get("folder"); folder {
	case "":
	case "none":
		none := lyricsheet.NoFolder
		filter.Folder = &none
	default:
		id, err := strconv.ParseInt(folder, 10, 64)
		if err != nil || id < 1 {
			writeError(w, http.StatusBadRequest, `folder must be a Folder's id or "none"`)
			return
		}
		if _, err := a.folders.Get(r.Context(), id); err != nil {
			writeDomainError(w, err)
			return
		}
		filter.Folder = &id
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
		// FolderID is the Folder it's made in, e.g. the one open; nil for none.
		FolderID *int64 `json:"folderId"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	song, err := a.songs.CreateSong(r.Context(), req.Title, req.FolderID)
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
	based, ok := basedOn(w, r)
	if !ok {
		return
	}
	var changes lyricsheet.SongChanges
	if !readJSON(w, r, &changes) {
		return
	}
	song, err := a.songs.UpdateSong(r.Context(), id, based, changes)
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
	based, ok := basedOn(w, r)
	if !ok {
		return
	}
	if err := a.songs.DeleteSong(r.Context(), id, based); err != nil {
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

// basedOn reads the Song version a write was based on from the If-Match
// header, as an entity tag like "3". Without the header, the write applies
// to whatever version the Song is at.
func basedOn(w http.ResponseWriter, r *http.Request) (songversion.Version, bool) {
	header := r.Header.Get("If-Match")
	if header == "" || header == "*" {
		return songversion.Any, true
	}
	digits, opened := strings.CutPrefix(header, `"`)
	digits, closed := strings.CutSuffix(digits, `"`)
	version, err := strconv.ParseInt(digits, 10, 64)
	if !opened || !closed || err != nil || version < 1 {
		writeError(w, http.StatusBadRequest, `If-Match must be a Song version, like "3"`)
		return 0, false
	}
	return songversion.Version(version), true
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
