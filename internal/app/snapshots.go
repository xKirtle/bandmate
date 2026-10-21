package app

import (
	"net/http"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/song"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// listSnapshots lists a Song's Snapshots, newest first: when each was
// taken and why, without the sheet it holds.
func (a *App) listSnapshots(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	list, err := a.songs.ListSnapshots(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// getSnapshot gives one of a Song's Snapshots with the Lyric Sheet and
// Scrapbook it holds.
func (a *App) getSnapshot(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	snapshotID, ok := pathID(w, r, "snapshotID")
	if !ok {
		return
	}
	snap, err := a.songs.GetSnapshot(r.Context(), id, snapshotID)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// keepSnapshot keeps one of a Song's Snapshots, so it's never thinned, or
// un-keeps it, and answers with it as listed.
func (a *App) keepSnapshot(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	snapshotID, ok := pathID(w, r, "snapshotID")
	if !ok {
		return
	}
	var req struct {
		Kept *bool `json:"kept"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.Kept == nil {
		writeDomainError(w, domain.Invalid("kept is required"))
		return
	}
	snap, err := a.songs.KeepSnapshot(r.Context(), id, snapshotID, *req.Kept)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// restoreSnapshot makes a Song's Lyric Sheet and Scrapbook a Snapshot's,
// taking a Snapshot of them first, and answers with the Song.
func (a *App) restoreSnapshot(w http.ResponseWriter, r *http.Request) {
	snapshotID, ok := pathID(w, r, "snapshotID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based songversion.Version) (song.Song, error) {
		return a.songs.RestoreSnapshot(r.Context(), id, based, snapshotID)
	})
}

// putSheetBack makes a Song's Lyric Sheet and Scrapbook the copy given, as
// Undo and Redo put them back, taking no Snapshot of its own, and answers
// with the Song.
func (a *App) putSheetBack(w http.ResponseWriter, r *http.Request) {
	var sheet song.LyricSheet
	a.changeSheet(w, r, &sheet, func(id int64, based songversion.Version) (song.Song, error) {
		return a.songs.PutSheetBack(r.Context(), id, based, sheet)
	})
}
