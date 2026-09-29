package app

import (
	"fmt"
	"net/http"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// A Cover is part of the Song, like a Master: adding one answers with the
// full, updated Song, and is based on the Song version in If-Match, if any.

func (a *App) addCover(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok {
		return
	}
	var parts []filePart
	for _, p := range lyricsheet.CoverPictures {
		parts = append(parts, filePart{string(p), a.coverFiles[p]})
	}
	tooLarge := fmt.Sprintf("the pictures are larger than the Cover limit of %s", formatSize(a.maxCover))
	var details lyricsheet.CoverDetails
	files, ok := readFiles(w, r, a.maxCover, tooLarge, parts, &details)
	if !ok {
		return
	}
	pictures := map[lyricsheet.CoverPicture]lyricsheet.UploadedPicture{}
	for _, p := range lyricsheet.CoverPictures {
		f := files[string(p)]
		pictures[p] = lyricsheet.UploadedPicture{File: f.Received, ContentType: f.contentType}
	}
	song, err := a.songs.AddCover(r.Context(), id, based, details, pictures)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, song)
}

// coverPicture serves one of a Song's Cover's pictures.
func (a *App) coverPicture(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	picture := lyricsheet.CoverPicture(r.PathValue("picture"))
	if err := a.songs.ServeCover(w, r, id, picture); err != nil {
		writeDomainError(w, err)
	}
}
