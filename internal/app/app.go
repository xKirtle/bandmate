// Package app wires Bandmate together: the database, the JSON API under /api
// and the embedded single-page app.
package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"path/filepath"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/beats"
	"github.com/xKirtle/bandmate/internal/db"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
	"github.com/xKirtle/bandmate/internal/timeline"
)

// Config is everything needed to build the app.
type Config struct {
	// DataDir holds the SQLite database and, under audio/, the audio files.
	DataDir string
	// SPA is the built single-page app, with index.html at its root.
	SPA fs.FS
	// MaxUploadBytes caps the size of an uploaded audio file. Zero means
	// DefaultMaxUploadBytes.
	MaxUploadBytes int64
}

// DefaultMaxUploadBytes is the upload cap unless configured otherwise.
const DefaultMaxUploadBytes = 500 << 20

// App is a running Bandmate instance.
type App struct {
	db    *sql.DB
	songs *lyricsheet.Store
	beats *beats.Store
	// timelines owns Songs' Timelines, which are kept apart from the Song
	// aggregate: most changes to a Song don't need them sent back.
	timelines *timeline.Store
	// beatFiles and masterFiles are where uploads are received, next to
	// the files they will be kept with.
	beatFiles   *audio.Files
	masterFiles *audio.Files
	maxUpload   int64
	spa         fs.FS
	handler     http.Handler
}

// New opens the database in cfg.DataDir, migrates it, and builds the HTTP
// handler.
func New(cfg Config) (*App, error) {
	conn, err := db.Open(context.Background(), cfg.DataDir)
	if err != nil {
		return nil, err
	}
	beatFiles, err := audio.Open(filepath.Join(cfg.DataDir, "audio", "beats"))
	if err != nil {
		conn.Close()
		return nil, err
	}
	masterFiles, err := audio.Open(filepath.Join(cfg.DataDir, "audio", "masters"))
	if err != nil {
		conn.Close()
		return nil, err
	}
	a := &App{
		db:          conn,
		songs:       lyricsheet.NewStore(conn, masterFiles),
		beats:       beats.NewStore(conn, beatFiles),
		timelines:   timeline.NewStore(conn),
		beatFiles:   beatFiles,
		masterFiles: masterFiles,
		maxUpload:   cfg.MaxUploadBytes,
		spa:         cfg.SPA,
	}
	if a.maxUpload <= 0 {
		a.maxUpload = DefaultMaxUploadBytes
	}
	a.handler = a.routes()
	return a, nil
}

// Handler serves the API and the SPA.
func (a *App) Handler() http.Handler { return a.handler }

// Close releases the database.
func (a *App) Close() error { return a.db.Close() }

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/songs", a.listSongs)
	mux.HandleFunc("POST /api/songs", a.createSong)
	mux.HandleFunc("POST /api/songs/import", a.importSong)
	mux.HandleFunc("GET /api/songs/{id}", a.getSong)
	mux.HandleFunc("PATCH /api/songs/{id}", a.updateSong)
	mux.HandleFunc("DELETE /api/songs/{id}", a.deleteSong)
	mux.HandleFunc("PUT /api/songs/{id}/arrangement", a.reorderArrangement)
	mux.HandleFunc("POST /api/songs/{id}/sections", a.addSection)
	mux.HandleFunc("PATCH /api/songs/{id}/sections/{sectionID}", a.setSectionLabel)
	mux.HandleFunc("DELETE /api/songs/{id}/sections/{sectionID}", a.deleteSection)
	mux.HandleFunc("POST /api/songs/{id}/sections/{sectionID}/add-to-section", a.addToSection)
	mux.HandleFunc("POST /api/songs/{id}/scrapbook", a.addToScrapbook)
	mux.HandleFunc("POST /api/songs/{id}/occurrences", a.addOccurrence)
	mux.HandleFunc("DELETE /api/songs/{id}/occurrences/{occurrenceID}", a.removeOccurrence)
	mux.HandleFunc("POST /api/songs/{id}/occurrences/{occurrenceID}/scrapbook", a.moveOccurrenceToScrapbook)
	mux.HandleFunc("POST /api/songs/{id}/occurrences/{occurrenceID}/detach", a.detach)
	mux.HandleFunc("PUT /api/songs/{id}/occurrences/{occurrenceID}/lines/{lineID}/cue", a.setLineCue)
	mux.HandleFunc("DELETE /api/songs/{id}/occurrences/{occurrenceID}/lines/{lineID}/cue", a.clearLineCue)
	mux.HandleFunc("DELETE /api/songs/{id}/occurrences/{occurrenceID}/cues", a.clearOccurrenceCues)
	mux.HandleFunc("DELETE /api/songs/{id}/cues", a.clearCues)
	mux.HandleFunc("PATCH /api/songs/{id}/cues", a.restoreCues)
	mux.HandleFunc("POST /api/songs/{id}/cues/shift", a.shiftCues)
	mux.HandleFunc("POST /api/songs/{id}/sections/{sectionID}/alternates", a.addAlternate)
	mux.HandleFunc("PATCH /api/songs/{id}/alternates/{alternateID}", a.renameAlternate)
	mux.HandleFunc("DELETE /api/songs/{id}/alternates/{alternateID}", a.deleteAlternate)
	mux.HandleFunc("POST /api/songs/{id}/alternates/{alternateID}/activate", a.activateAlternate)
	mux.HandleFunc("POST /api/songs/{id}/alternates/{alternateID}/scrapbook", a.moveAlternateToScrapbook)
	mux.HandleFunc("PUT /api/songs/{id}/alternates/{alternateID}/text", a.replaceAlternateText)
	mux.HandleFunc("POST /api/songs/{id}/masters", a.addMaster)
	mux.HandleFunc("GET /api/songs/{id}/masters/{masterID}", a.getMaster)
	mux.HandleFunc("PATCH /api/songs/{id}/masters/{masterID}", a.updateMaster)
	mux.HandleFunc("DELETE /api/songs/{id}/masters/{masterID}", a.deleteMaster)
	mux.HandleFunc("POST /api/songs/{id}/masters/{masterID}/main", a.makeMainMaster)
	mux.HandleFunc("GET /api/songs/{id}/masters/{masterID}/audio", a.masterAudio)
	mux.HandleFunc("GET /api/songs/{id}/timeline", a.getTimeline)
	mux.HandleFunc("POST /api/songs/{id}/timeline/beats", a.addBeatToTimeline)
	mux.HandleFunc("POST /api/songs/{id}/timeline/tracks", a.addTrack)
	mux.HandleFunc("PUT /api/songs/{id}/timeline/tracks", a.reorderTracks)
	mux.HandleFunc("PATCH /api/songs/{id}/timeline/tracks/{trackID}", a.updateTrack)
	mux.HandleFunc("DELETE /api/songs/{id}/timeline/tracks/{trackID}", a.deleteTrack)
	mux.HandleFunc("PUT /api/songs/{id}/timeline/loop", a.setLoop)
	mux.HandleFunc("PATCH /api/songs/{id}/timeline/loop", a.switchLoop)
	mux.HandleFunc("DELETE /api/songs/{id}/timeline/loop", a.clearLoop)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips", a.placeClip)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/{clipID}/move", a.moveClip)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/{clipID}/trim", a.trimClip)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/{clipID}/duplicate", a.duplicateClip)
	mux.HandleFunc("DELETE /api/songs/{id}/timeline/clips/{clipID}", a.deleteClip)
	mux.HandleFunc("GET /api/config", a.config)
	mux.HandleFunc("GET /api/beats", a.listBeats)
	mux.HandleFunc("POST /api/beats", a.addBeat)
	mux.HandleFunc("GET /api/beats/{id}", a.getBeat)
	mux.HandleFunc("PATCH /api/beats/{id}", a.updateBeat)
	mux.HandleFunc("DELETE /api/beats/{id}", a.deleteBeat)
	mux.HandleFunc("PUT /api/beats/{id}/file", a.replaceBeatFile)
	mux.HandleFunc("GET /api/beats/{id}/audio", a.beatAudio)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	mux.Handle("/", spaHandler(a.spa))
	return mux
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	if err := a.db.PingContext(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database unreachable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// config tells the SPA the limits it should check before sending anything.
func (a *App) config(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]int64{"maxUploadBytes": a.maxUpload})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writing response: %v", err)
	}
}

// writeError sends a readable error message as {"error": "..."}.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
