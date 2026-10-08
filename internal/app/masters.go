package app

import (
	"net/http"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// Masters are part of the Song: every change to one answers with the full,
// updated Song, and is based on the Song version in If-Match, if any.

func (a *App) addMaster(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok {
		return
	}
	var details struct {
		lyricsheet.MasterDetails
		uploadDetails
	}
	file, ok := a.readUpload(w, r, a.masterFiles, &details)
	if !ok {
		return
	}
	song, err := a.songs.AddMaster(r.Context(), id, based, details.MasterDetails,
		details.audio(file.name, file.contentType), file.Received)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, song)
}

func (a *App) getMaster(w http.ResponseWriter, r *http.Request) {
	id, masterID, ok := masterPathIDs(w, r)
	if !ok {
		return
	}
	m, err := a.songs.GetMaster(r.Context(), id, masterID)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (a *App) updateMaster(w http.ResponseWriter, r *http.Request) {
	masterID, ok := pathID(w, r, "masterID")
	if !ok {
		return
	}
	var changes lyricsheet.MasterChanges
	a.changeSheet(w, r, &changes, func(id int64, based songversion.Version) (lyricsheet.Song, error) {
		return a.songs.UpdateMaster(r.Context(), id, based, masterID, changes)
	})
}

func (a *App) makeMainMaster(w http.ResponseWriter, r *http.Request) {
	masterID, ok := pathID(w, r, "masterID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based songversion.Version) (lyricsheet.Song, error) {
		return a.songs.MakeMainMaster(r.Context(), id, based, masterID)
	})
}

func (a *App) deleteMaster(w http.ResponseWriter, r *http.Request) {
	masterID, ok := pathID(w, r, "masterID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based songversion.Version) (lyricsheet.Song, error) {
		return a.songs.DeleteMaster(r.Context(), id, based, masterID)
	})
}

// masterAudio streams a Master's file, or with ?download offers it to save.
func (a *App) masterAudio(w http.ResponseWriter, r *http.Request) {
	id, masterID, ok := masterPathIDs(w, r)
	if !ok {
		return
	}
	if err := a.songs.ServeMaster(w, r, id, masterID, r.URL.Query().Has("download")); err != nil {
		writeDomainError(w, err)
	}
}

// masterPathIDs parses the {id} and {masterID} path parameters.
func masterPathIDs(w http.ResponseWriter, r *http.Request) (songID, masterID int64, ok bool) {
	if songID, ok = pathID(w, r, "id"); !ok {
		return 0, 0, false
	}
	masterID, ok = pathID(w, r, "masterID")
	return songID, masterID, ok
}
