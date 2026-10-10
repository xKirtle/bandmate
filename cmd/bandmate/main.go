// Command bandmate runs the Bandmate server.
//
// Configuration comes from environment variables:
//
//	BANDMATE_ADDR      listen address (default ":8080")
//	BANDMATE_DATA_DIR  directory holding the database and audio files (default "./data")
//	BANDMATE_MAX_UPLOAD_MB  largest audio file accepted, in megabytes (default 500)
//	BANDMATE_UPDATE_CHECK   "off" stops the About page asking GitHub for releases, Bandmate's and yt-dlp's (default "on")
//	BANDMATE_ADD_FROM_LINK  "off" stops Beats being added from a link, which fetches them (default "on")
//
// "bandmate healthcheck" asks a running server whether it is healthy and exits
// non-zero if not, for container healthchecks in images without curl.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
	"github.com/xKirtle/bandmate/internal/build"
	"github.com/xKirtle/bandmate/web"
)

func main() {
	addr := env("BANDMATE_ADDR", ":8080")

	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := healthcheck(addr); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	maxUpload, err := maxUploadBytes()
	if err != nil {
		log.Fatal(err)
	}
	updateCheckOff, err := readOff("BANDMATE_UPDATE_CHECK")
	if err != nil {
		log.Fatal(err)
	}
	addFromLinkOff, err := readOff("BANDMATE_ADD_FROM_LINK")
	if err != nil {
		log.Fatal(err)
	}
	if err := run(addr, env("BANDMATE_DATA_DIR", "./data"), maxUpload, updateCheckOff, addFromLinkOff); err != nil {
		log.Fatal(err)
	}
}

// bundledProgramsManifest is where the image's build records the programs it
// bundles beside Bandmate: yt-dlp, ffmpeg and QuickJS (see the Dockerfile).
// Outside the image it isn't there, so none are listed.
const bundledProgramsManifest = "/usr/local/share/bandmate/programs.json"

func run(addr, dataDir string, maxUploadBytes int64, updateCheckOff, addFromLinkOff bool) error {
	running := build.Current()
	a, err := app.New(app.Config{
		DataDir: dataDir, SPA: web.Dist(), MaxUploadBytes: maxUploadBytes, Build: running,
		UpdateCheckOff: updateCheckOff, ProgramsManifest: bundledProgramsManifest,
		AddFromLinkOff: addFromLinkOff,
	})
	// A refused start serves its reason rather than exiting, so it shows in
	// the browser and Docker doesn't restart Bandmate in a loop.
	var refused *app.Refused
	var handler http.Handler
	switch {
	case errors.As(err, &refused):
		log.Printf("bandmate %s can't start: %s See %s", describe(running), refused.Reason, app.UpgradeGuide)
		handler = app.RefusalHandler(refused)
	case err != nil:
		return err
	default:
		defer a.Close()
		handler = a.Handler()
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errc := make(chan error, 1)
	go func() {
		log.Printf("bandmate %s listening on %s, data in %s", describe(running), addr, dataDir)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}

	log.Print("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// describe names the running version for the log, with its commit when the
// version doesn't already show it: "v0.4.0 (1a2b3c4)", "1a2b3c4-dirty" or
// "dev".
func describe(b build.Info) string {
	commit := b.ShortRevision()
	if commit == "" || strings.HasPrefix(b.Version, commit) {
		return b.Version
	}
	return fmt.Sprintf("%s (%s)", b.Version, commit)
}

func healthcheck(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("parsing BANDMATE_ADDR %q: %w", addr, err)
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	client := http.Client{Timeout: 5 * time.Second}
	res, err := client.Get("http://" + net.JoinHostPort(host, port) + "/api/health")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("unhealthy: %s", res.Status)
	}
	return nil
}

// maxUploadBytes reads BANDMATE_MAX_UPLOAD_MB. Zero, when it isn't set,
// leaves the app's default.
func maxUploadBytes() (int64, error) {
	text := os.Getenv("BANDMATE_MAX_UPLOAD_MB")
	if text == "" {
		return 0, nil
	}
	mb, err := strconv.ParseInt(text, 10, 64)
	if err != nil || mb < 1 {
		return 0, errors.New("BANDMATE_MAX_UPLOAD_MB must be a whole number of megabytes, 1 or more")
	}
	return mb << 20, nil
}

// readOff reads a switch, such as BANDMATE_UPDATE_CHECK, telling whether
// it's off: it's on unless it's "off".
func readOff(name string) (off bool, err error) {
	switch strings.ToLower(os.Getenv(name)) {
	case "", "on":
		return false, nil
	case "off":
		return true, nil
	}
	return false, fmt.Errorf(`%s must be "on" or "off"`, name)
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
