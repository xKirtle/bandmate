package app

import (
	"net/http"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// Every Lyric Sheet change answers with the full, updated Song.

func (a *App) reorderArrangement(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Occurrences []int64 `json:"occurrences"`
	}
	a.changeSheet(w, r, &req, func(id int64) (lyricsheet.Song, error) {
		return a.songs.ReorderArrangement(r.Context(), id, req.Occurrences)
	})
}

func (a *App) addSection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Label    string `json:"label"`
		Position *int   `json:"position"`
	}
	a.changeSheet(w, r, &req, func(id int64) (lyricsheet.Song, error) {
		return a.songs.AddSection(r.Context(), id, req.Label, req.Position)
	})
}

func (a *App) addToScrapbook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Label string `json:"label"`
	}
	a.changeSheet(w, r, &req, func(id int64) (lyricsheet.Song, error) {
		return a.songs.AddToScrapbook(r.Context(), id, req.Label)
	})
}

func (a *App) deleteSection(w http.ResponseWriter, r *http.Request) {
	sectionID, ok := pathID(w, r, "sectionID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64) (lyricsheet.Song, error) {
		return a.songs.DeleteSection(r.Context(), id, sectionID)
	})
}

func (a *App) addOccurrence(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SectionID *int64 `json:"sectionId"`
		Position  *int   `json:"position"`
	}
	a.changeSheet(w, r, &req, func(id int64) (lyricsheet.Song, error) {
		if req.SectionID == nil {
			return lyricsheet.Song{}, &lyricsheet.InvalidError{Msg: "sectionId is required"}
		}
		return a.songs.AddOccurrence(r.Context(), id, *req.SectionID, req.Position)
	})
}

func (a *App) removeOccurrence(w http.ResponseWriter, r *http.Request) {
	occurrenceID, ok := pathID(w, r, "occurrenceID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64) (lyricsheet.Song, error) {
		return a.songs.RemoveOccurrence(r.Context(), id, occurrenceID)
	})
}

func (a *App) detach(w http.ResponseWriter, r *http.Request) {
	occurrenceID, ok := pathID(w, r, "occurrenceID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64) (lyricsheet.Song, error) {
		return a.songs.Detach(r.Context(), id, occurrenceID)
	})
}

func (a *App) setSectionLabel(w http.ResponseWriter, r *http.Request) {
	sectionID, ok := pathID(w, r, "sectionID")
	if !ok {
		return
	}
	var req struct {
		Label string `json:"label"`
	}
	a.changeSheet(w, r, &req, func(id int64) (lyricsheet.Song, error) {
		return a.songs.SetSectionLabel(r.Context(), id, sectionID, req.Label)
	})
}

func (a *App) addAlternate(w http.ResponseWriter, r *http.Request) {
	sectionID, ok := pathID(w, r, "sectionID")
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	a.changeSheet(w, r, &req, func(id int64) (lyricsheet.Song, error) {
		return a.songs.AddAlternate(r.Context(), id, sectionID, req.Name)
	})
}

func (a *App) renameAlternate(w http.ResponseWriter, r *http.Request) {
	alternateID, ok := pathID(w, r, "alternateID")
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	a.changeSheet(w, r, &req, func(id int64) (lyricsheet.Song, error) {
		return a.songs.RenameAlternate(r.Context(), id, alternateID, req.Name)
	})
}

func (a *App) activateAlternate(w http.ResponseWriter, r *http.Request) {
	alternateID, ok := pathID(w, r, "alternateID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64) (lyricsheet.Song, error) {
		return a.songs.ActivateAlternate(r.Context(), id, alternateID)
	})
}

func (a *App) deleteAlternate(w http.ResponseWriter, r *http.Request) {
	alternateID, ok := pathID(w, r, "alternateID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64) (lyricsheet.Song, error) {
		return a.songs.DeleteAlternate(r.Context(), id, alternateID)
	})
}

func (a *App) replaceAlternateText(w http.ResponseWriter, r *http.Request) {
	alternateID, ok := pathID(w, r, "alternateID")
	if !ok {
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	a.changeSheet(w, r, &req, func(id int64) (lyricsheet.Song, error) {
		return a.songs.ReplaceAlternateText(r.Context(), id, alternateID, req.Text)
	})
}

// changeSheet reads the Song id and the request body into req (unless req is
// nil, for changes that take no body), runs the change and writes the
// resulting Song.
func (a *App) changeSheet(w http.ResponseWriter, r *http.Request, req any,
	change func(songID int64) (lyricsheet.Song, error)) {
	id, ok := songID(w, r)
	if !ok || (req != nil && !readJSON(w, r, req)) {
		return
	}
	song, err := change(id)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, song)
}
