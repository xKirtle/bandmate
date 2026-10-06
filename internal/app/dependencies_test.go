package app_test

import (
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/xKirtle/bandmate/internal/app"
	"github.com/xKirtle/bandmate/internal/build"
)

// dependency is one of GET /api/about's dependencies.
type dependency struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	License string `json:"license"`
	URL     string `json:"url"`
}

// dependencies is GET /api/about's dependencies: what ships in Bandmate.
type dependencies struct {
	Go       []dependency `json:"go"`
	Web      []dependency `json:"web"`
	Programs []dependency `json:"programs"`
}

func getDependencies(t *testing.T, configure func(*app.Config)) dependencies {
	t.Helper()
	res := newTestServerWith(t, configure).Do(http.MethodGet, "/api/about", nil)
	expectStatus(t, res, http.StatusOK)
	var got struct {
		Dependencies *dependencies `json:"dependencies"`
	}
	res.JSON(t, &got)
	if got.Dependencies == nil {
		t.Fatalf("about = %s, want dependencies", res.Body)
	}
	return *got.Dependencies
}

func TestAboutListsTheGoModulesThatShipWithTheirLicenses(t *testing.T) {
	got := getDependencies(t, func(*app.Config) {})

	var sqlite *dependency
	for i, d := range got.Go {
		if d.Name == "github.com/xKirtle/bandmate" {
			t.Errorf("Go modules include Bandmate itself: %+v", d)
		}
		if d.Name == "modernc.org/sqlite" {
			sqlite = &got.Go[i]
		}
	}
	if sqlite == nil {
		t.Fatalf("Go modules = %+v, want modernc.org/sqlite", got.Go)
	}
	if sqlite.Version == "" || sqlite.License != "BSD-3-Clause" {
		t.Errorf("modernc.org/sqlite = %+v, want a version and BSD-3-Clause", *sqlite)
	}
}

func TestAGoModuleWhoseLicenseIsntKnownLinksToWhereItCanBeLookedUp(t *testing.T) {
	got := getDependencies(t, func(c *app.Config) {
		c.GoModules = []build.Dependency{
			{Name: "example.com/known", Version: "v1.0.0", License: "MIT"},
			{Name: "example.com/mystery", Version: "v1.2.3", License: "Unknown"},
		}
	})

	want := []dependency{
		{Name: "example.com/known", Version: "v1.0.0", License: "MIT"},
		{Name: "example.com/mystery", Version: "v1.2.3", License: "Unknown", URL: "https://pkg.go.dev/example.com/mystery@v1.2.3"},
	}
	if !slices.Equal(got.Go, want) {
		t.Errorf("Go modules = %+v, want %+v", got.Go, want)
	}
}

func TestAboutListsTheWebPackagesTheBuiltAppRecorded(t *testing.T) {
	got := getDependencies(t, func(c *app.Config) {
		c.SPA = fstest.MapFS{
			"index.html": {Data: []byte("<!doctype html>")},
			"dependencies.json": {Data: []byte(`[
				{"name": "music-metadata", "version": "11.16.1", "license": "MIT"},
				{"name": "svelte", "version": "5.57.1", "license": "MIT"}
			]`)},
		}
	})

	want := []dependency{
		{Name: "music-metadata", Version: "11.16.1", License: "MIT"},
		{Name: "svelte", Version: "5.57.1", License: "MIT"},
	}
	if !slices.Equal(got.Web, want) {
		t.Errorf("web packages = %+v, want %+v", got.Web, want)
	}
}

func TestAboutListsTheProgramsBundledInTheImage(t *testing.T) {
	// The image's build records them in a manifest beside them.
	manifest := filepath.Join(t.TempDir(), "programs.json")
	if err := os.WriteFile(manifest, []byte(`[
		{"name": "yt-dlp", "version": "2026.08.19", "license": "Unlicense"},
		{"name": "ffmpeg", "version": "8.1.3", "license": "LGPL-2.1-or-later"},
		{"name": "QuickJS", "version": "2026-06-04", "license": "MIT"}
	]`), 0o644); err != nil {
		t.Fatal(err)
	}
	got := getDependencies(t, func(c *app.Config) { c.ProgramsManifest = manifest })

	want := []dependency{
		{Name: "yt-dlp", Version: "2026.08.19", License: "Unlicense"},
		{Name: "ffmpeg", Version: "8.1.3", License: "LGPL-2.1-or-later"},
		{Name: "QuickJS", Version: "2026-06-04", License: "MIT"},
	}
	if !slices.Equal(got.Programs, want) {
		t.Errorf("programs = %+v, want %+v", got.Programs, want)
	}
}

func TestAnInstallWithoutTheBundledProgramsListsNone(t *testing.T) {
	// The dev stack runs the binary outside the image, where the manifest
	// isn't. The raw body tells an empty list apart from null.
	for name, manifest := range map[string]string{
		"no manifest given":  "",
		"manifest not there": filepath.Join(t.TempDir(), "programs.json"),
	} {
		t.Run(name, func(t *testing.T) {
			res := newTestServerWith(t, func(c *app.Config) { c.ProgramsManifest = manifest }).
				Do(http.MethodGet, "/api/about", nil)
			expectStatus(t, res, http.StatusOK)
			if !strings.Contains(string(res.Body), `"programs":[]`) {
				t.Errorf("about = %s, want an empty list of programs", res.Body)
			}
		})
	}
}

func TestAnAppBuiltWithoutItsWebPackagesListsNone(t *testing.T) {
	// testSPA has no dependencies.json. The raw body tells an empty list
	// apart from null, which decoding wouldn't.
	res := newTestServer(t).Do(http.MethodGet, "/api/about", nil)
	if !strings.Contains(string(res.Body), `"web":[]`) {
		t.Errorf("about = %s, want an empty list of web packages", res.Body)
	}
}
