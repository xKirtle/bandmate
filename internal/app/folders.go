package app

import (
	"errors"
	"net/http"

	"github.com/xKirtle/bandmate/internal/folders"
)

func (a *App) listFolders(w http.ResponseWriter, r *http.Request) {
	list, err := a.folders.List(r.Context())
	if err != nil {
		writeFolderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *App) createFolder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	f, err := a.folders.Create(r.Context(), req.Name)
	if err != nil {
		writeFolderError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (a *App) getFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	f, err := a.folders.Get(r.Context(), id)
	if err != nil {
		writeFolderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// moveSongToFolder puts a Song into a Folder, or, with a null folderId,
// into none.
func (a *App) moveSongToFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	var req struct {
		FolderID *int64 `json:"folderId"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if err := a.folders.MoveSong(r.Context(), id, req.FolderID); err != nil {
		writeFolderError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// writeFolderError maps Folder errors onto HTTP responses.
func writeFolderError(w http.ResponseWriter, err error) {
	var invalid *folders.InvalidError
	var conflict *folders.ConflictError
	switch {
	case errors.As(err, &invalid):
		writeError(w, http.StatusBadRequest, invalid.Msg)
	case errors.As(err, &conflict):
		writeError(w, http.StatusConflict, conflict.Msg)
	case errors.Is(err, folders.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		writeDomainError(w, err)
	}
}
