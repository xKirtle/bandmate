package app

import (
	"net/http"

	"github.com/xKirtle/bandmate/internal/demo"
)

// putDemoBack puts the Demo back as built into Bandmate, replacing the one
// there, as a Tour does when it starts, and answers with the Demo Song.
// Every other call on a Song works on it as on any Song.
func (a *App) putDemoBack(w http.ResponseWriter, r *http.Request) {
	id, err := a.backups.PutDemoBack(r.Context(), demo.Backup)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	s, err := a.songs.GetSong(r.Context(), id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}
