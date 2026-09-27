// Command bandmate runs the Bandmate server.
//
// Configuration comes from environment variables:
//
//	BANDMATE_ADDR      listen address (default ":8080")
//	BANDMATE_DATA_DIR  directory holding the database (default "./data")
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
	"syscall"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
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

	if err := run(addr, env("BANDMATE_DATA_DIR", "./data")); err != nil {
		log.Fatal(err)
	}
}

func run(addr, dataDir string) error {
	a, err := app.New(app.Config{DataDir: dataDir, SPA: web.Dist()})
	if err != nil {
		return err
	}
	defer a.Close()

	srv := &http.Server{
		Addr:              addr,
		Handler:           a.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errc := make(chan error, 1)
	go func() {
		log.Printf("bandmate listening on %s, data in %s", addr, dataDir)
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

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
