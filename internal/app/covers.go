package app

import (
	"context"
	"fmt"
	"net/http"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// A Cover is part of the Song, like a Master: adding, replacing, adjusting
// the crop of or removing one answers with the full, updated Song, and is
// based on the Song version in If-Match, if any.

func (a *App) addCover(w http.ResponseWriter, r *http.Request) {
	a.putCover(w, r, a.songs.AddCover)
}

func (a *App) replaceCover(w http.ResponseWriter, r *http.Request) {
	a.putCover(w, r, a.songs.ReplaceCover)
}

func (a *App) removeCover(w http.ResponseWriter, r *http.Request) {
	a.changeSheet(w, r, nil, func(id int64, based songversion.Version) (lyricsheet.Song, error) {
		return a.songs.RemoveCover(r.Context(), id, based)
	})
}

// coverPut gives a Song a Cover: Store.AddCover or Store.ReplaceCover.
type coverPut func(ctx context.Context, songID int64, based songversion.Version, details lyricsheet.CoverDetails,
	pictures map[lyricsheet.CoverPicture]lyricsheet.UploadedPicture) (lyricsheet.Song, error)

// putCover reads a Cover's pictures and details and gives them to put.
func (a *App) putCover(w http.ResponseWriter, r *http.Request, put coverPut) {
	var details lyricsheet.CoverDetails
	a.readCover(w, r, lyricsheet.CoverPictures, &details, func(id int64, based songversion.Version, pictures map[lyricsheet.CoverPicture]lyricsheet.UploadedPicture) (lyricsheet.Song, error) {
		return put(r.Context(), id, based, details, pictures)
	})
}

// adjustCoverCrop reads a Cover's new crop square, which Cover it was made
// from, and the list and header pictures made from it.
func (a *App) adjustCoverCrop(w http.ResponseWriter, r *http.Request) {
	var details struct {
		Cover int64                `json:"cover"`
		Crop  lyricsheet.CoverCrop `json:"crop"`
	}
	a.readCover(w, r, lyricsheet.SquarePictures, &details, func(id int64, based songversion.Version, pictures map[lyricsheet.CoverPicture]lyricsheet.UploadedPicture) (lyricsheet.Song, error) {
		return a.songs.AdjustCoverCrop(r.Context(), id, based, details.Cover, details.Crop, pictures)
	})
}

// readCover reads the given pictures of a Cover and its details, decoded
// into details, and answers with the Song change makes with them.
func (a *App) readCover(w http.ResponseWriter, r *http.Request, pictures []lyricsheet.CoverPicture, details any,
	change func(id int64, based songversion.Version, pictures map[lyricsheet.CoverPicture]lyricsheet.UploadedPicture) (lyricsheet.Song, error)) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok {
		return
	}
	var parts []filePart
	for _, p := range pictures {
		parts = append(parts, filePart{string(p), a.coverFiles[p]})
	}
	tooLarge := fmt.Sprintf("the pictures are larger than the Cover limit of %s", audio.FormatSize(a.maxCover))
	files, ok := readFiles(w, r, a.maxCover, tooLarge, parts, details)
	if !ok {
		return
	}
	uploaded := map[lyricsheet.CoverPicture]lyricsheet.UploadedPicture{}
	for _, p := range pictures {
		f := files[string(p)]
		uploaded[p] = lyricsheet.UploadedPicture{File: f.Received, ContentType: f.contentType}
	}
	song, err := change(id, based, uploaded)
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
