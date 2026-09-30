package app_test

import (
	"net/http"
	"testing"

	"github.com/xKirtle/bandmate/internal/app"
	"github.com/xKirtle/bandmate/internal/build"
)

func TestConfigTellsTheRunningVersionAndItsSourceAlongsideTheLimits(t *testing.T) {
	release := build.Info{
		Version:   "v0.4.0",
		Revision:  "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
		SourceURL: "https://github.com/xKirtle/bandmate/tree/v0.4.0",
	}
	ts := newTestServerWith(t, func(c *app.Config) {
		c.Build = release
		c.MaxUploadBytes = 1 << 20
		c.MaxCoverBytes = 2 << 20
	})

	var config struct {
		MaxUploadBytes int64  `json:"maxUploadBytes"`
		MaxCoverBytes  int64  `json:"maxCoverBytes"`
		Version        string `json:"version"`
		Revision       string `json:"revision"`
		SourceURL      string `json:"sourceUrl"`
	}
	res := ts.Do(http.MethodGet, "/api/config", nil)
	expectStatus(t, res, http.StatusOK)
	res.JSON(t, &config)

	if config.Version != release.Version || config.Revision != release.Revision || config.SourceURL != release.SourceURL {
		t.Errorf("config build = %q, %q, %q; want %+v", config.Version, config.Revision, config.SourceURL, release)
	}
	if config.MaxUploadBytes != 1<<20 || config.MaxCoverBytes != 2<<20 {
		t.Errorf("config limits = %d, %d; want %d, %d", config.MaxUploadBytes, config.MaxCoverBytes, 1<<20, 2<<20)
	}
}

func TestConfigDefaultsToTheRunningBinarysBuild(t *testing.T) {
	var config struct {
		Version   string `json:"version"`
		SourceURL string `json:"sourceUrl"`
	}
	newTestServer(t).Do(http.MethodGet, "/api/config", nil).JSON(t, &config)

	want := build.Current()
	if config.Version != want.Version || config.SourceURL != want.SourceURL {
		t.Errorf("config build = %q, %q; want %q, %q", config.Version, config.SourceURL, want.Version, want.SourceURL)
	}
}
