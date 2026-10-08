package app

import (
	"net/http"

	"github.com/xKirtle/bandmate/internal/beats"
)

func (a *App) listBeats(w http.ResponseWriter, r *http.Request) {
	list, err := a.beats.List(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *App) addBeat(w http.ResponseWriter, r *http.Request) {
	var details struct {
		beats.Details
		uploadDetails
	}
	file, ok := a.readUpload(w, r, a.beatFiles, &details)
	if !ok {
		return
	}
	b, err := a.beats.Add(r.Context(), details.Details, details.audio(file.name, file.contentType), file.Received)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, b)
}

func (a *App) getBeat(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	b, err := a.beats.Get(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (a *App) updateBeat(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var changes beats.Changes
	if !readJSON(w, r, &changes) {
		return
	}
	b, err := a.beats.Update(r.Context(), id, changes)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (a *App) replaceBeatFile(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var details uploadDetails
	file, ok := a.readUpload(w, r, a.beatFiles, &details)
	if !ok {
		return
	}
	b, err := a.beats.ReplaceFile(r.Context(), id, details.audio(file.name, file.contentType), file.Received)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (a *App) deleteBeat(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := a.beats.Delete(r.Context(), id); err != nil {
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) beatAudio(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := a.beats.ServeFile(w, r, id); err != nil {
		writeDomainError(w, err)
	}
}
