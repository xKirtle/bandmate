package app

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/xKirtle/bandmate/internal/build"
	"github.com/xKirtle/bandmate/internal/db"
)

// about tells the About page everything known without going online: the
// build, what it runs on, the database, and when the app started. Details is
// the block a bug report asks for, which the SPA adds the browser to.
func (a *App) about(w http.ResponseWriter, r *http.Request) {
	d, err := db.Describe(r.Context(), a.db)
	if err != nil {
		log.Printf("describing the database: %v", err)
		writeError(w, http.StatusInternalServerError, "couldn't read the database's details")
		return
	}
	platform := build.CurrentPlatform()
	writeJSON(w, http.StatusOK, struct {
		build.Info
		build.Platform
		SQLiteVersion string    `json:"sqliteVersion"`
		Schema        db.Schema `json:"schema"`
		StartedAt     time.Time `json:"startedAt"`
		Details       string    `json:"details"`
	}{
		Info:          a.build,
		Platform:      platform,
		SQLiteVersion: d.SQLiteVersion,
		Schema:        d.Schema,
		StartedAt:     a.startedAt,
		Details:       details(a.build, platform, d),
	})
}

// details is the block a bug report asks for, e.g.
//
//	Bandmate v0.4.0 (1a2b3c4, 2026-09-29)
//	Go 1.25.1 linux/amd64 · SQLite 3.50.4 · schema 0027_track_volume_range
//
// The commit is left out when the version already is it.
func details(b build.Info, p build.Platform, d db.Description) string {
	var known []string
	if commit := b.ShortRevision(); commit != "" && !strings.HasPrefix(b.Version, commit) {
		known = append(known, commit)
	}
	if !b.CommitTime.IsZero() {
		known = append(known, b.CommitTime.UTC().Format(time.DateOnly))
	}
	first := "Bandmate " + b.Version
	if len(known) > 0 {
		first += " (" + strings.Join(known, ", ") + ")"
	}
	return fmt.Sprintf("%s\nGo %s %s/%s · SQLite %s · schema %s",
		first, p.GoVersion, p.OS, p.Arch, d.SQLiteVersion, d.Schema.Migration)
}
