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
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
	"github.com/xKirtle/bandmate/internal/backups"
	"github.com/xKirtle/bandmate/internal/beats"
	"github.com/xKirtle/bandmate/internal/build"
	"github.com/xKirtle/bandmate/internal/db"
	"github.com/xKirtle/bandmate/internal/fetches"
	"github.com/xKirtle/bandmate/internal/folders"
	"github.com/xKirtle/bandmate/internal/lyricsheet"
	"github.com/xKirtle/bandmate/internal/releases"
	"github.com/xKirtle/bandmate/internal/songfiles"
	"github.com/xKirtle/bandmate/internal/tags"
	"github.com/xKirtle/bandmate/internal/timeline"
)

// Config is everything needed to build the app.
type Config struct {
	// DataDir holds the SQLite database and, under audio/ and covers/, the
	// uploaded and recorded files.
	DataDir string
	// SPA is the built single-page app, with index.html at its root.
	SPA fs.FS
	// MaxUploadBytes caps the size of an uploaded audio file. Zero means
	// DefaultMaxUploadBytes.
	MaxUploadBytes int64
	// MaxCoverBytes caps the size of a Cover's pictures, together. Zero
	// means DefaultMaxCoverBytes.
	MaxCoverBytes int64
	// Build is the running version, shown on the About page. Zero means
	// build.Current().
	Build build.Info
	// Now tells the time at startup, when Takes detached, and Sounds no
	// Clip has used, for more than DetachedTakesKept are removed. Nil means
	// time.Now.
	Now func() time.Time
	// UpdateCheckOff stops the About page asking GitHub for releases, both
	// Bandmate's and yt-dlp's latest.
	UpdateCheckOff bool
	// GitHubAPI is GitHub's REST API base URL, which the About page's
	// releases come from. Empty means releases.DefaultAPI.
	GitHubAPI string
	// GoModules is the Go modules the About page lists. Nil means
	// build.GoModules().
	GoModules []build.Dependency
	// ProgramsManifest is the file the image's build records the programs
	// bundled beside Bandmate in (yt-dlp, ffmpeg and QuickJS), which the
	// About page lists. Empty, or a file that isn't there, lists none, as an
	// install built without them has.
	ProgramsManifest string
	// AddFromLinkOff stops Beats being added from a link, so Bandmate never
	// fetches one.
	AddFromLinkOff bool
	// YtDlp is the bundled yt-dlp that fetches a link's audio, unless a
	// newer copy was updated into the data folder. Empty means the one on
	// the PATH.
	YtDlp string
	// FetchTimeout stops a fetch from a link that takes longer. Zero means
	// fetches.DefaultTimeout.
	FetchTimeout time.Duration
}

// DetachedTakesKept is how long a Take is kept once detached, well past
// the session its undo history lasts for. A Sound no Clip uses is kept as
// long.
const DetachedTakesKept = 24 * time.Hour

// DefaultMaxUploadBytes is the upload cap unless configured otherwise.
const DefaultMaxUploadBytes = 500 << 20

// DefaultMaxCoverBytes is the Cover cap unless configured otherwise.
const DefaultMaxCoverBytes = 25 << 20

// App is a running Bandmate instance.
type App struct {
	db    *sql.DB
	songs *lyricsheet.Store
	beats *beats.Store
	// folders keep some Songs together on the Songs page.
	folders *folders.Store
	// tags mark Songs with names of the user's own.
	tags *tags.Store
	// backups makes and keeps Backups, in the data directory.
	backups *backups.Store
	// timelines owns Songs' Timelines, which are kept apart from the Song
	// aggregate: most changes to a Song don't need them sent back.
	timelines *timeline.Store
	// beatFiles, masterFiles, takeFiles and soundFiles are where uploads are
	// received, next to the files they will be kept with.
	beatFiles   *audio.Files
	masterFiles *audio.Files
	takeFiles   *audio.Files
	soundFiles  *audio.Files
	coverFiles  lyricsheet.CoverFiles
	maxUpload   int64
	maxCover    int64
	build       build.Info
	// startedAt is when the app started, for the About page's uptime.
	startedAt time.Time
	// releases checks GitHub for the About page's releases.
	releases *releases.Checker
	// dependencies is what ships in Bandmate, for the About page.
	dependencies dependencies
	// fetches fetches links' audio for Beats added from a link, unless
	// addFromLinkOff.
	fetches *fetches.Store
	// ytDlp is the yt-dlp fetches run, which About shows and updates.
	ytDlp *fetches.YtDlp
	// ytDlpLatest checks GitHub for yt-dlp's latest release, which About
	// offers to update to.
	ytDlpLatest    *releases.Latest
	addFromLinkOff bool
	spa            fs.FS
	handler        http.Handler
}

// New opens the database in cfg.DataDir, migrates it, and builds the HTTP
// handler.
func New(cfg Config) (*App, error) {
	conn, err := db.Open(context.Background(), cfg.DataDir)
	if err != nil {
		return nil, err
	}
	songFiles := map[string]*audio.Files{}
	for _, k := range songfiles.Kinds {
		if songFiles[k.Dir], err = audio.Open(filepath.Join(cfg.DataDir, filepath.FromSlash(k.Dir))); err != nil {
			conn.Close()
			return nil, err
		}
	}
	beatFiles := songFiles[songfiles.Beats.Dir]
	masterFiles := songFiles[songfiles.Masters.Dir]
	takeFiles := songFiles[songfiles.Takes.Dir]
	soundFiles := songFiles[songfiles.Sounds.Dir]
	now := time.Now
	if cfg.Now != nil {
		now = cfg.Now
	}
	backupStore, err := backups.Open(conn, cfg.DataDir, now)
	if err != nil {
		conn.Close()
		return nil, err
	}
	a := &App{
		db:          conn,
		songs:       lyricsheet.NewStore(conn, songFiles),
		beats:       beats.NewStore(conn, beatFiles),
		folders:     folders.NewStore(conn),
		tags:        tags.NewStore(conn),
		backups:     backupStore,
		timelines:   timeline.NewStore(conn, takeFiles, soundFiles),
		beatFiles:   beatFiles,
		masterFiles: masterFiles,
		takeFiles:   takeFiles,
		soundFiles:  soundFiles,
		coverFiles:  lyricsheet.CoverFilesIn(songFiles),
		maxUpload:   cfg.MaxUploadBytes,
		maxCover:    cfg.MaxCoverBytes,
		build:       cfg.Build,
		spa:         cfg.SPA,
	}
	if a.maxUpload <= 0 {
		a.maxUpload = DefaultMaxUploadBytes
	}
	if a.maxCover <= 0 {
		a.maxCover = DefaultMaxCoverBytes
	}
	if a.build == (build.Info{}) {
		a.build = build.Current()
	}
	a.startedAt = now()
	a.dependencies = shipped(cfg.GoModules, cfg.SPA, cfg.ProgramsManifest)
	a.addFromLinkOff = cfg.AddFromLinkOff
	a.ytDlp = fetches.NewYtDlp(cfg.YtDlp, filepath.Join(cfg.DataDir, "programs"))
	a.fetches, err = fetches.Open(fetches.Options{
		Dir:      filepath.Join(cfg.DataDir, "audio", "waiting"),
		YtDlp:    a.ytDlp,
		MaxBytes: a.maxUpload,
		Timeout:  cfg.FetchTimeout,
		Now:      now,
	})
	if err != nil {
		conn.Close()
		return nil, err
	}
	github := releases.Options{Off: cfg.UpdateCheckOff, API: cfg.GitHubAPI, Now: now}
	a.releases = releases.New(github)
	a.ytDlpLatest = releases.NewLatest("yt-dlp/yt-dlp", github)
	// Only tidying, so it never stops the app starting.
	if err := a.timelines.SweepDetachedTakes(context.Background(), now().Add(-DetachedTakesKept)); err != nil {
		log.Printf("sweeping detached takes: %v", err)
	}
	if err := a.timelines.SweepUnusedSounds(context.Background(), now().Add(-DetachedTakesKept)); err != nil {
		log.Printf("sweeping unused sounds: %v", err)
	}
	a.handler = a.routes()
	return a, nil
}

// Handler serves the API and the SPA.
func (a *App) Handler() http.Handler { return a.handler }

// Close releases the database.
func (a *App) Close() error {
	a.fetches.Close()
	return a.db.Close()
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/songs", a.listSongs)
	mux.HandleFunc("POST /api/songs", a.createSong)
	mux.HandleFunc("GET /api/songs/{id}", a.getSong)
	mux.HandleFunc("PATCH /api/songs/{id}", a.updateSong)
	mux.HandleFunc("DELETE /api/songs/{id}", a.deleteSong)
	mux.HandleFunc("PUT /api/songs/{id}/folder", a.moveSongToFolder)
	mux.HandleFunc("PUT /api/songs/{id}/tags", a.setSongTags)
	mux.HandleFunc("GET /api/tags", a.listTags)
	mux.HandleFunc("PATCH /api/tags/{id}", a.renameTag)
	mux.HandleFunc("DELETE /api/tags/{id}", a.deleteTag)
	mux.HandleFunc("GET /api/folders", a.listFolders)
	mux.HandleFunc("POST /api/folders", a.createFolder)
	mux.HandleFunc("GET /api/folders/{id}", a.getFolder)
	mux.HandleFunc("PATCH /api/folders/{id}", a.renameFolder)
	mux.HandleFunc("DELETE /api/folders/{id}", a.deleteFolder)
	mux.HandleFunc("PUT /api/songs/{id}/arrangement", a.reorderArrangement)
	mux.HandleFunc("POST /api/songs/{id}/sections", a.addSection)
	mux.HandleFunc("PATCH /api/songs/{id}/sections/{sectionID}", a.setSectionLabel)
	mux.HandleFunc("DELETE /api/songs/{id}/sections/{sectionID}", a.deleteSection)
	mux.HandleFunc("POST /api/songs/{id}/sections/{sectionID}/add-to-section", a.addToSection)
	mux.HandleFunc("POST /api/songs/{id}/sections/{sectionID}/duplicate", a.duplicateSection)
	mux.HandleFunc("POST /api/songs/{id}/scrapbook", a.addToScrapbook)
	mux.HandleFunc("POST /api/songs/{id}/arrangement", a.addToArrangement)
	mux.HandleFunc("DELETE /api/songs/{id}/arrangement/{sectionID}", a.removeFromArrangement)
	mux.HandleFunc("DELETE /api/songs/{id}/sections/{sectionID}/cues", a.clearSectionCues)
	mux.HandleFunc("PUT /api/songs/{id}/lines/{lineID}/cue", a.setLineCue)
	mux.HandleFunc("DELETE /api/songs/{id}/lines/{lineID}/cue", a.clearLineCue)
	mux.HandleFunc("DELETE /api/songs/{id}/cues", a.clearCues)
	mux.HandleFunc("PATCH /api/songs/{id}/cues", a.restoreCues)
	mux.HandleFunc("POST /api/songs/{id}/cues/shift", a.shiftCues)
	mux.HandleFunc("POST /api/songs/{id}/sections/{sectionID}/alternates", a.addAlternate)
	mux.HandleFunc("PATCH /api/songs/{id}/alternates/{alternateID}", a.renameAlternate)
	mux.HandleFunc("DELETE /api/songs/{id}/alternates/{alternateID}", a.deleteAlternate)
	mux.HandleFunc("POST /api/songs/{id}/alternates/{alternateID}/activate", a.activateAlternate)
	mux.HandleFunc("POST /api/songs/{id}/alternates/{alternateID}/scrapbook", a.moveAlternateToScrapbook)
	mux.HandleFunc("POST /api/songs/{id}/alternates/{alternateID}/arrangement", a.moveAlternateToArrangement)
	mux.HandleFunc("PUT /api/songs/{id}/alternates/{alternateID}/text", a.replaceAlternateText)
	mux.HandleFunc("POST /api/songs/{id}/masters", a.addMaster)
	mux.HandleFunc("GET /api/songs/{id}/masters/{masterID}", a.getMaster)
	mux.HandleFunc("PATCH /api/songs/{id}/masters/{masterID}", a.updateMaster)
	mux.HandleFunc("DELETE /api/songs/{id}/masters/{masterID}", a.deleteMaster)
	mux.HandleFunc("POST /api/songs/{id}/masters/{masterID}/main", a.makeMainMaster)
	mux.HandleFunc("GET /api/songs/{id}/masters/{masterID}/audio", a.masterAudio)
	mux.HandleFunc("POST /api/songs/{id}/cover", a.addCover)
	mux.HandleFunc("PUT /api/songs/{id}/cover", a.replaceCover)
	mux.HandleFunc("DELETE /api/songs/{id}/cover", a.removeCover)
	mux.HandleFunc("PUT /api/songs/{id}/cover/crop", a.adjustCoverCrop)
	mux.HandleFunc("GET /api/songs/{id}/cover/{picture}", a.coverPicture)
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
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/move", a.moveClips)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/place", a.placeClips)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/delete", a.deleteClips)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/paste", a.pasteClips)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/merge", a.mergeClips)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/replace", a.replaceClips)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/split", a.splitClips)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/tempo", a.setClipTempos)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/{clipID}/move", a.moveClip)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/{clipID}/trim", a.trimClip)
	mux.HandleFunc("PUT /api/songs/{id}/timeline/clips/{clipID}/name", a.renameClip)
	mux.HandleFunc("PUT /api/songs/{id}/timeline/clips/{clipID}/gain", a.setClipGain)
	mux.HandleFunc("PUT /api/songs/{id}/timeline/clips/{clipID}/fades", a.setClipFades)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/{clipID}/duplicate", a.duplicateClip)
	mux.HandleFunc("DELETE /api/songs/{id}/timeline/clips/{clipID}", a.deleteClip)
	mux.HandleFunc("POST /api/songs/{id}/timeline/takes", a.recordTake)
	mux.HandleFunc("POST /api/songs/{id}/timeline/clips/{clipID}/takes", a.retake)
	mux.HandleFunc("PUT /api/songs/{id}/timeline/clips/{clipID}/takes", a.setTakes)
	mux.HandleFunc("DELETE /api/songs/{id}/timeline/clips/{clipID}/takes/{takeID}", a.deleteTake)
	mux.HandleFunc("PUT /api/songs/{id}/timeline/clips/{clipID}/takes/{takeID}/nudge", a.nudgeTake)
	mux.HandleFunc("PUT /api/songs/{id}/timeline/clips/{clipID}/active-take", a.chooseTake)
	mux.HandleFunc("DELETE /api/songs/{id}/timeline/clips/{clipID}/inactive-takes", a.clearInactiveTakes)
	mux.HandleFunc("GET /api/songs/{id}/takes/{takeID}", a.getTake)
	mux.HandleFunc("GET /api/songs/{id}/takes/{takeID}/audio", a.takeAudio)
	mux.HandleFunc("POST /api/songs/{id}/timeline/sounds", a.importSound)
	mux.HandleFunc("GET /api/songs/{id}/sounds/{soundID}", a.getSound)
	mux.HandleFunc("GET /api/songs/{id}/sounds/{soundID}/audio", a.soundAudio)
	mux.HandleFunc("GET /api/config", a.config)
	mux.HandleFunc("GET /api/about", a.about)
	mux.HandleFunc("GET /api/about/releases", a.aboutReleases)
	mux.HandleFunc("GET /api/beats", a.listBeats)
	mux.HandleFunc("POST /api/beats", a.addBeat)
	mux.HandleFunc("GET /api/beats/{id}", a.getBeat)
	mux.HandleFunc("PATCH /api/beats/{id}", a.updateBeat)
	mux.HandleFunc("DELETE /api/beats/{id}", a.deleteBeat)
	mux.HandleFunc("PUT /api/beats/{id}/file", a.replaceBeatFile)
	mux.HandleFunc("GET /api/beats/{id}/audio", a.beatAudio)
	mux.HandleFunc("POST /api/fetches", a.fetchLink)
	mux.HandleFunc("GET /api/fetches/{id}/audio", a.fetchedAudio)
	mux.HandleFunc("DELETE /api/fetches/{id}", a.discardFetched)
	mux.HandleFunc("POST /api/fetches/{id}/beat", a.addFetchedBeat)
	mux.HandleFunc("GET /api/yt-dlp", a.ytDlpInUse)
	mux.HandleFunc("GET /api/yt-dlp/latest", a.ytDlpLatestCheck)
	mux.HandleFunc("POST /api/yt-dlp/update", a.updateYtDlp)
	mux.HandleFunc("GET /api/backups", a.listBackups)
	mux.HandleFunc("POST /api/backups", a.makeBackup)
	mux.HandleFunc("POST /api/backups/upload", a.uploadBackup)
	mux.HandleFunc("PATCH /api/backups/{id}", a.renameBackup)
	mux.HandleFunc("DELETE /api/backups/{id}", a.deleteBackup)
	mux.HandleFunc("GET /api/backups/{id}/file", a.backupFile)
	mux.HandleFunc("GET /api/backups/{id}/songs", a.backupSongs)
	mux.HandleFunc("GET /api/backups/{id}/beats", a.backupBeats)
	mux.HandleFunc("POST /api/backups/{id}/present", a.presentInBandmate)
	mux.HandleFunc("POST /api/backups/{id}/restore", a.restoreBackup)
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

// config tells the SPA the limits it should check before sending anything,
// which version is running, with a link to its source, and whether Beats can
// be added from a link.
func (a *App) config(w http.ResponseWriter, r *http.Request) {
	// The rest of the build is the About page's, from /api/about.
	writeJSON(w, http.StatusOK, struct {
		MaxUploadBytes int64  `json:"maxUploadBytes"`
		MaxCoverBytes  int64  `json:"maxCoverBytes"`
		Version        string `json:"version"`
		Revision       string `json:"revision"`
		SourceURL      string `json:"sourceUrl"`
		BugReportURL   string `json:"bugReportUrl"`
		AddFromLink    bool   `json:"addFromLink"`
	}{a.maxUpload, a.maxCover, a.build.Version, a.build.Revision, a.build.SourceURL, a.build.BugReportURL, !a.addFromLinkOff})
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
