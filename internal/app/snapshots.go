package app

import (
	"net/http"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
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

// restoreSnapshot makes a Song's Lyric Sheet and Scrapbook a Snapshot's,
// taking a Snapshot of them first, and answers with the Song.
func (a *App) restoreSnapshot(w http.ResponseWriter, r *http.Request) {
	snapshotID, ok := pathID(w, r, "snapshotID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based songversion.Version) (lyricsheet.Song, error) {
		return a.songs.RestoreSnapshot(r.Context(), id, based, snapshotID)
	})
}
