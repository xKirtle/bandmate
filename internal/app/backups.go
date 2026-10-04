package app

import (
	"errors"
	"log"
	"net/http"

	"github.com/xKirtle/bandmate/internal/backups"
)

func (a *App) listBackups(w http.ResponseWriter, r *http.Request) {
	list, err := a.backups.List(r.Context())
	if err != nil {
		writeBackupError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// makeBackup answers once the Backup is made, which takes as long as
// copying its Songs' files.
func (a *App) makeBackup(w http.ResponseWriter, r *http.Request) {
	var contents backups.Contents
	if !readJSON(w, r, &contents) {
		return
	}
	b, err := a.backups.Make(r.Context(), contents)
	if err != nil {
		writeBackupError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, b)
}

func (a *App) backupFile(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := a.backups.Serve(w, r, id); err != nil {
		writeBackupError(w, err)
	}
}

// renameBackup gives a Backup a name of its own, or with a blank one clears
// it back to the automatic one.
func (a *App) renameBackup(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	b, err := a.backups.Rename(r.Context(), id, req.Name)
	if err != nil {
		writeBackupError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (a *App) deleteBackup(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := a.backups.Delete(r.Context(), id); err != nil {
		writeBackupError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeBackupError(w http.ResponseWriter, err error) {
	var invalid *backups.InvalidError
	switch {
	case errors.As(err, &invalid):
		writeError(w, http.StatusBadRequest, invalid.Msg)
	case errors.Is(err, backups.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		log.Printf("internal error: %v", err)
		writeError(w, http.StatusInternalServerError, "something went wrong")
	}
}
