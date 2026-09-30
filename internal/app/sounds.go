package app

import (
	"net/http"

	"github.com/xKirtle/bandmate/internal/timeline"
)

// Sounds are imported into the Timeline: importing one answers with the
// full, updated Timeline, counts as editing the Song, and is based on the
// Song version in If-Match, if any.

// importSound takes an audio file, with where it goes and what it's called
// as "details", as one of the Song's Sounds, placed in a new Clip.
func (a *App) importSound(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok {
		return
	}
	var details struct {
		timeline.SoundImport
		uploadDetails
	}
	file, ok := a.readUpload(w, r, a.soundFiles, &details)
	if !ok {
		return
	}
	tl, err := a.timelines.ImportSound(r.Context(), id, based, details.SoundImport,
		details.audio(file.name, file.contentType), file.Received)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tl)
}

// getSound answers with one of the Song's Sounds, with its peaks.
func (a *App) getSound(w http.ResponseWriter, r *http.Request) {
	id, soundID, ok := soundPathIDs(w, r)
	if !ok {
		return
	}
	snd, err := a.timelines.GetSound(r.Context(), id, soundID)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snd)
}

// soundAudio streams a Sound's file, exactly as uploaded, or with
// ?download offers it to save under its original name.
func (a *App) soundAudio(w http.ResponseWriter, r *http.Request) {
	id, soundID, ok := soundPathIDs(w, r)
	if !ok {
		return
	}
	if err := a.timelines.ServeSound(w, r, id, soundID, r.URL.Query().Has("download")); err != nil {
		writeDomainError(w, err)
	}
}

// soundPathIDs parses the {id} and {soundID} path parameters.
func soundPathIDs(w http.ResponseWriter, r *http.Request) (songID, soundID int64, ok bool) {
	if songID, ok = pathID(w, r, "id"); !ok {
		return 0, 0, false
	}
	soundID, ok = pathID(w, r, "soundID")
	return songID, soundID, ok
}
