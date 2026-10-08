package app

import (
	"net/http"
)

// listTags lists every Tag, with how many Songs carry each, for suggesting
// them as a Song is tagged.
func (a *App) listTags(w http.ResponseWriter, r *http.Request) {
	list, err := a.tags.List(r.Context())
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// setSongTags gives a Song exactly the Tags named, made where there's none,
// and answers with their names.
func (a *App) setSongTags(w http.ResponseWriter, r *http.Request) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	var req struct {
		Tags *[]string `json:"tags"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.Tags == nil {
		writeError(w, http.StatusBadRequest, "tags must be a list of names")
		return
	}
	names, err := a.tags.SetSongTags(r.Context(), id, *req.Tags)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, names)
}

// renameTag gives a Tag a new name. Onto a name another Tag has, ignoring
// case, it's refused, unless merge is set, the user having been asked: then
// it merges into that Tag. It answers with the Tag renamed or merged into.
func (a *App) renameTag(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var req struct {
		Name  string `json:"name"`
		Merge bool   `json:"merge"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	t, err := a.tags.Rename(r.Context(), id, req.Name, req.Merge)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// deleteTag takes a Tag off every Song carrying it, deleting none of them.
func (a *App) deleteTag(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := a.tags.Delete(r.Context(), id); err != nil {
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
