package app

import (
	"net/http"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// Every Lyric Sheet change answers with the full, updated Song. Each is
// based on the Song version in the request's If-Match header, if any.

func (a *App) reorderArrangement(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Sections []int64 `json:"sections"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.ReorderArrangement(r.Context(), id, based, req.Sections)
	})
}

func (a *App) addSection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Label    string `json:"label"`
		Position *int   `json:"position"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.AddSection(r.Context(), id, based, req.Label, req.Position)
	})
}

func (a *App) addToScrapbook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Label string `json:"label"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.AddToScrapbook(r.Context(), id, based, req.Label)
	})
}

func (a *App) deleteSection(w http.ResponseWriter, r *http.Request) {
	sectionID, ok := pathID(w, r, "sectionID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.DeleteSection(r.Context(), id, based, sectionID)
	})
}

func (a *App) addToArrangement(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SectionID *int64 `json:"sectionId"`
		Position  *int   `json:"position"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		if req.SectionID == nil {
			return lyricsheet.Song{}, domain.Invalid("sectionId is required")
		}
		return a.songs.AddToArrangement(r.Context(), id, based, *req.SectionID, req.Position)
	})
}

func (a *App) duplicateSection(w http.ResponseWriter, r *http.Request) {
	sectionID, ok := pathID(w, r, "sectionID")
	if !ok {
		return
	}
	var req struct {
		Position *int `json:"position"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.DuplicateSection(r.Context(), id, based, sectionID, req.Position)
	})
}

// removeFromArrangement takes a Section out of the Arrangement, from its
// actions or dropped on the Scrapbook. It goes to the Scrapbook, or is
// deleted if nothing is written in it.
func (a *App) removeFromArrangement(w http.ResponseWriter, r *http.Request) {
	sectionID, ok := pathID(w, r, "sectionID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.RemoveFromArrangement(r.Context(), id, based, sectionID)
	})
}

func (a *App) addToSection(w http.ResponseWriter, r *http.Request) {
	addedID, ok := pathID(w, r, "sectionID")
	if !ok {
		return
	}
	var req struct {
		SectionID *int64 `json:"sectionId"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		if req.SectionID == nil {
			return lyricsheet.Song{}, domain.Invalid("sectionId is required")
		}
		return a.songs.AddToSection(r.Context(), id, based, addedID, *req.SectionID)
	})
}

func (a *App) setLineCue(w http.ResponseWriter, r *http.Request) {
	lineID, ok := pathID(w, r, "lineID")
	if !ok {
		return
	}
	var req struct {
		Cue *float64 `json:"cue"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		if req.Cue == nil {
			return lyricsheet.Song{}, domain.Invalid("cue is required")
		}
		return a.songs.SetLineCue(r.Context(), id, based, lineID, *req.Cue)
	})
}

func (a *App) clearLineCue(w http.ResponseWriter, r *http.Request) {
	lineID, ok := pathID(w, r, "lineID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.ClearLineCue(r.Context(), id, based, lineID)
	})
}

func (a *App) clearSectionCues(w http.ResponseWriter, r *http.Request) {
	sectionID, ok := pathID(w, r, "sectionID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.ClearSectionCues(r.Context(), id, based, sectionID)
	})
}

func (a *App) clearCues(w http.ResponseWriter, r *http.Request) {
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.ClearCues(r.Context(), id, based)
	})
}

// restoreCues sets each Line Cue given to its value, or clears it with a
// null cue.
func (a *App) restoreCues(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Cues *[]struct {
			LineID *int64   `json:"lineId"`
			Cue    *float64 `json:"cue"`
		} `json:"cues"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		if req.Cues == nil {
			return lyricsheet.Song{}, domain.Invalid("cues is required")
		}
		values := make([]lyricsheet.CueValue, len(*req.Cues))
		for i, c := range *req.Cues {
			if c.LineID == nil {
				return lyricsheet.Song{}, domain.Invalid("each Cue needs a lineId")
			}
			values[i] = lyricsheet.CueValue{LineID: *c.LineID, Cue: c.Cue}
		}
		return a.songs.RestoreCues(r.Context(), id, based, values)
	})
}

// shiftCues moves every Cue in [start, end), in seconds, by the seconds
// given, e.g. along with a Clip that was moved.
func (a *App) shiftCues(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Start *float64 `json:"start"`
		End   *float64 `json:"end"`
		By    *float64 `json:"by"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		if req.Start == nil || req.End == nil || req.By == nil {
			return lyricsheet.Song{}, domain.Invalid("start, end and by are required")
		}
		return a.songs.ShiftCues(r.Context(), id, based, *req.Start, *req.End, *req.By)
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
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.SetSectionLabel(r.Context(), id, based, sectionID, req.Label)
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
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.AddAlternate(r.Context(), id, based, sectionID, req.Name)
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
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.RenameAlternate(r.Context(), id, based, alternateID, req.Name)
	})
}

func (a *App) activateAlternate(w http.ResponseWriter, r *http.Request) {
	alternateID, ok := pathID(w, r, "alternateID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.ActivateAlternate(r.Context(), id, based, alternateID)
	})
}

func (a *App) deleteAlternate(w http.ResponseWriter, r *http.Request) {
	alternateID, ok := pathID(w, r, "alternateID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.DeleteAlternate(r.Context(), id, based, alternateID)
	})
}

func (a *App) moveAlternateToScrapbook(w http.ResponseWriter, r *http.Request) {
	alternateID, ok := pathID(w, r, "alternateID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.MoveAlternateToScrapbook(r.Context(), id, based, alternateID)
	})
}

func (a *App) moveAlternateToArrangement(w http.ResponseWriter, r *http.Request) {
	alternateID, ok := pathID(w, r, "alternateID")
	if !ok {
		return
	}
	var req struct {
		Position *int `json:"position"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		if req.Position == nil {
			return lyricsheet.Song{}, domain.Invalid("position is required")
		}
		return a.songs.MoveAlternateToArrangement(r.Context(), id, based, alternateID, *req.Position)
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
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.ReplaceAlternateText(r.Context(), id, based, alternateID, req.Text)
	})
}

// changeSheet reads the Song id, the version the change is based on and the
// request body into req (unless req is nil, for changes that take no body),
// runs the change and writes the resulting Song.
func (a *App) changeSheet(w http.ResponseWriter, r *http.Request, req any,
	change func(songID int64, based lyricsheet.Version) (lyricsheet.Song, error)) {
	id, ok := songID(w, r)
	if !ok {
		return
	}
	based, ok := basedOn(w, r)
	if !ok || (req != nil && !readJSON(w, r, req)) {
		return
	}
	song, err := change(id, based)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, song)
}
