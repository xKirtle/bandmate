package app

import (
	"context"
	"fmt"
	"net/http"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// A Cover is part of the Song, like a Master: adding, replacing, re-cropping
// or removing one answers with the full, updated Song, and is based on the Song version
// in If-Match, if any.

func (a *App) addCover(w http.ResponseWriter, r *http.Request) {
	a.putCover(w, r, a.songs.AddCover)
}

func (a *App) replaceCover(w http.ResponseWriter, r *http.Request) {
	a.putCover(w, r, a.songs.ReplaceCover)
}

func (a *App) removeCover(w http.ResponseWriter, r *http.Request) {
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.RemoveCover(r.Context(), id, based)
	})
}

// coverPut gives a Song a Cover: Store.AddCover or Store.ReplaceCover.
type coverPut func(ctx context.Context, songID int64, based lyricsheet.Version, details lyricsheet.CoverDetails,
	pictures map[lyricsheet.CoverPicture]lyricsheet.UploadedPicture) (lyricsheet.Song, error)

// putCover reads a Cover's pictures and details and gives them to put.
func (a *App) putCover(w http.ResponseWriter, r *http.Request, put coverPut) {
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
	song, err := put(r.Context(), id, based, details, uploadedPictures(files, lyricsheet.CoverPictures))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, song)
}

// adjustCoverCrop reads a Cover's new crop square and the list and header
// pictures made from it.
func (a *App) adjustCoverCrop(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok {
		return
	}
	var parts []filePart
	for _, p := range lyricsheet.CropPictures {
		parts = append(parts, filePart{string(p), a.coverFiles[p]})
	}
	tooLarge := fmt.Sprintf("the pictures are larger than the Cover limit of %s", formatSize(a.maxCover))
	var details struct {
		Crop lyricsheet.CoverCrop `json:"crop"`
	}
	files, ok := readFiles(w, r, a.maxCover, tooLarge, parts, &details)
	if !ok {
		return
	}
	song, err := a.songs.AdjustCoverCrop(r.Context(), id, based, details.Crop, uploadedPictures(files, lyricsheet.CropPictures))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, song)
}

// uploadedPictures are the given pictures of a Cover, as read by readFiles.
func uploadedPictures(files map[string]uploadedFile, pictures []lyricsheet.CoverPicture) map[lyricsheet.CoverPicture]lyricsheet.UploadedPicture {
	uploaded := map[lyricsheet.CoverPicture]lyricsheet.UploadedPicture{}
	for _, p := range pictures {
		f := files[string(p)]
		uploaded[p] = lyricsheet.UploadedPicture{File: f.Received, ContentType: f.contentType}
	}
	return uploaded
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
