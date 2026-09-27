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

	"github.com/xKirtle/bandmate/internal/db"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
)

// Config is everything needed to build the app.
type Config struct {
	// DataDir holds the SQLite database (and, later, audio files).
	DataDir string
	// SPA is the built single-page app, with index.html at its root.
	SPA fs.FS
}

// App is a running Bandmate instance.
type App struct {
	db      *sql.DB
	songs   *lyricsheet.Store
	spa     fs.FS
	handler http.Handler
}

// New opens the database in cfg.DataDir, migrates it, and builds the HTTP
// handler.
func New(cfg Config) (*App, error) {
	conn, err := db.Open(context.Background(), cfg.DataDir)
	if err != nil {
		return nil, err
	}
	a := &App{db: conn, songs: lyricsheet.NewStore(conn), spa: cfg.SPA}
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
	mux.HandleFunc("GET /api/songs/{id}", a.getSong)
	mux.HandleFunc("PATCH /api/songs/{id}", a.updateSong)
	mux.HandleFunc("DELETE /api/songs/{id}", a.deleteSong)
	mux.HandleFunc("PUT /api/songs/{id}/arrangement", a.reorderArrangement)
	mux.HandleFunc("POST /api/songs/{id}/sections", a.addSection)
	mux.HandleFunc("PATCH /api/songs/{id}/sections/{sectionID}", a.setSectionLabel)
	mux.HandleFunc("POST /api/songs/{id}/occurrences", a.addOccurrence)
	mux.HandleFunc("DELETE /api/songs/{id}/occurrences/{occurrenceID}", a.removeOccurrence)
	mux.HandleFunc("POST /api/songs/{id}/occurrences/{occurrenceID}/detach", a.detach)
	mux.HandleFunc("PUT /api/songs/{id}/alternates/{alternateID}/text", a.replaceAlternateText)
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
