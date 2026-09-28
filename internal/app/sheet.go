package app

import (
	"net/http"

	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// Every Lyric Sheet change answers with the full, updated Song. Each is
// based on the Song version in the request's If-Match header, if any.

func (a *App) reorderArrangement(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Occurrences []int64 `json:"occurrences"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.ReorderArrangement(r.Context(), id, based, req.Occurrences)
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

func (a *App) addOccurrence(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SectionID *int64 `json:"sectionId"`
		Position  *int   `json:"position"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		if req.SectionID == nil {
			return lyricsheet.Song{}, &lyricsheet.InvalidError{Msg: "sectionId is required"}
		}
		return a.songs.AddOccurrence(r.Context(), id, based, *req.SectionID, req.Position)
	})
}

func (a *App) removeOccurrence(w http.ResponseWriter, r *http.Request) {
	occurrenceID, ok := pathID(w, r, "occurrenceID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.RemoveOccurrence(r.Context(), id, based, occurrenceID)
	})
}

func (a *App) detach(w http.ResponseWriter, r *http.Request) {
	occurrenceID, ok := pathID(w, r, "occurrenceID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.Detach(r.Context(), id, based, occurrenceID)
	})
}

func (a *App) setLineCue(w http.ResponseWriter, r *http.Request) {
	occurrenceID, ok := pathID(w, r, "occurrenceID")
	if !ok {
		return
	}
	lineID, ok := pathID(w, r, "lineID")
	if !ok {
		return
	}
	var req struct {
		Cue *float64 `json:"cue"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		if req.Cue == nil {
			return lyricsheet.Song{}, &lyricsheet.InvalidError{Msg: "cue is required"}
		}
		return a.songs.SetLineCue(r.Context(), id, based, occurrenceID, lineID, *req.Cue)
	})
}

func (a *App) clearLineCue(w http.ResponseWriter, r *http.Request) {
	occurrenceID, ok := pathID(w, r, "occurrenceID")
	if !ok {
		return
	}
	lineID, ok := pathID(w, r, "lineID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.ClearLineCue(r.Context(), id, based, occurrenceID, lineID)
	})
}

func (a *App) clearOccurrenceCues(w http.ResponseWriter, r *http.Request) {
	occurrenceID, ok := pathID(w, r, "occurrenceID")
	if !ok {
		return
	}
	a.changeSheet(w, r, nil, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		return a.songs.ClearOccurrenceCues(r.Context(), id, based, occurrenceID)
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
			OccurrenceID int64    `json:"occurrenceId"`
			LineID       *int64   `json:"lineId"`
			Cue          *float64 `json:"cue"`
		} `json:"cues"`
	}
	a.changeSheet(w, r, &req, func(id int64, based lyricsheet.Version) (lyricsheet.Song, error) {
		if req.Cues == nil {
			return lyricsheet.Song{}, &lyricsheet.InvalidError{Msg: "cues is required"}
		}
		values := make([]lyricsheet.CueValue, len(*req.Cues))
		for i, c := range *req.Cues {
			if c.LineID == nil {
				return lyricsheet.Song{}, &lyricsheet.InvalidError{Msg: "each Cue needs a lineId"}
			}
			values[i] = lyricsheet.CueValue{OccurrenceID: c.OccurrenceID, LineID: *c.LineID, Cue: c.Cue}
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
			return lyricsheet.Song{}, &lyricsheet.InvalidError{Msg: "start, end and by are required"}
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
