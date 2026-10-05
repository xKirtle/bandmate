package app

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/xKirtle/bandmate/internal/folders"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

func (a *App) listFolders(w http.ResponseWriter, r *http.Request) {
	list, err := a.folders.List(r.Context())
	if err != nil {
		writeFolderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *App) createFolder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	f, err := a.folders.Create(r.Context(), req.Name)
	if err != nil {
		writeFolderError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (a *App) getFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	f, err := a.folders.Get(r.Context(), id)
	if err != nil {
		writeFolderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (a *App) renameFolder(w http.ResponseWriter, r *http.Request) {
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
	f, err := a.folders.Rename(r.Context(), id, req.Name)
	if err != nil {
		writeFolderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// deleteFolder removes a Folder. With ?songs=delete, its Songs are deleted
// too, each as deleting a Song does; otherwise, or with ?songs=keep, they're
// kept, in no Folder. With &count=N, the Songs are deleted only if the
// Folder still holds N, the number the user was asked about, so none filed
// into it since go unseen. Songs are deleted one by one before the Folder,
// so if one fails, the Folder is left holding the rest, to try again.
func (a *App) deleteFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	query := r.URL.Query()
	var deleteSongs bool
	switch query.Get("songs") {
	case "", "keep":
	case "delete":
		deleteSongs = true
	default:
		writeError(w, http.StatusBadRequest, `songs must be "keep" or "delete"`)
		return
	}
	count := -1
	if text := query.Get("count"); text != "" {
		n, err := strconv.Atoi(text)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, "count must be a whole number")
			return
		}
		count = n
	}
	if deleteSongs {
		f, err := a.folders.Get(r.Context(), id)
		if err != nil {
			writeFolderError(w, err)
			return
		}
		if count >= 0 && f.Songs != count {
			writeError(w, http.StatusConflict, fmt.Sprintf("“%s” now holds %s, not %d", f.Name, songCount(f.Songs), count))
			return
		}
		songIDs, err := a.folders.SongIDs(r.Context(), id)
		if err != nil {
			writeFolderError(w, err)
			return
		}
		for _, songID := range songIDs {
			// One already gone, say deleted meanwhile, is as good as deleted.
			err := a.songs.DeleteSong(r.Context(), songID, lyricsheet.AnyVersion)
			if err != nil && !errors.Is(err, lyricsheet.ErrNotFound) {
				writeDomainError(w, err)
				return
			}
		}
	}
	if err := a.folders.Delete(r.Context(), id); err != nil {
		writeFolderError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// songCount says how many Songs there are: "1 Song", "3 Songs".
func songCount(n int) string {
	if n == 1 {
		return "1 Song"
	}
	return fmt.Sprintf("%d Songs", n)
}

// moveSongToFolder puts a Song into a Folder, or, with a null folderId,
// into none.
func (a *App) moveSongToFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	var req struct {
		FolderID *int64 `json:"folderId"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if err := a.folders.MoveSong(r.Context(), id, req.FolderID); err != nil {
		writeFolderError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// writeFolderError maps Folder errors onto HTTP responses.
func writeFolderError(w http.ResponseWriter, err error) {
	var invalid *folders.InvalidError
	var conflict *folders.ConflictError
	switch {
	case errors.As(err, &invalid):
		writeError(w, http.StatusBadRequest, invalid.Msg)
	case errors.As(err, &conflict):
		writeError(w, http.StatusConflict, conflict.Msg)
	case errors.Is(err, folders.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		writeDomainError(w, err)
	}
}
