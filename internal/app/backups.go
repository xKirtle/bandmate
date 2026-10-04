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
