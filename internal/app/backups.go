package app

import (
	"net/http"

	"github.com/xKirtle/bandmate/internal/backups"
)

func (a *App) listBackups(w http.ResponseWriter, r *http.Request) {
	list, err := a.backups.List(r.Context())
	if err != nil {
		writeDomainError(w, err)
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
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, b)
}

// uploadBackup keeps a Backup's file sent as the request's body, downloaded
// from this install or another, to restore from like one made here. It's
// refused whole if it isn't a Backup, is damaged, or was made by a newer
// Bandmate.
func (a *App) uploadBackup(w http.ResponseWriter, r *http.Request) {
	b, err := a.backups.Upload(r.Context(), r.Body)
	if err != nil {
		writeDomainError(w, err)
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
		writeDomainError(w, err)
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
		writeDomainError(w, err)
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
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// backupSongs lists the Songs a Backup holds, to pick some to restore.
func (a *App) backupSongs(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	list, err := a.backups.Songs(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// backupBeats lists the Beats a Backup holds, to pick some to restore.
func (a *App) backupBeats(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	list, err := a.backups.Beats(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// restoreBackup restores the Songs and Beats picked from a Backup,
// answering once they're back, which takes as long as
// unpacking their files.
func (a *App) restoreBackup(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var req struct {
		backups.Picks
		Replace backups.Replace `json:"replace"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	restored, err := a.backups.Restore(r.Context(), id, req.Picks, req.Replace)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, restored)
}

// presentInBandmate lists which of the Songs picked from a Backup, of the
// Beats their Clips use, and of the Beats picked, are already in Bandmate,
// to choose for each whether a Restore replaces it or keeps both.
func (a *App) presentInBandmate(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var picks backups.Picks
	if !readJSON(w, r, &picks) {
		return
	}
	present, err := a.backups.Present(r.Context(), id, picks)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, present)
}
