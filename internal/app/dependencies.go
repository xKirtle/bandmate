package app

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"

	"github.com/xKirtle/bandmate/internal/build"
)

// webDependencies is the SPA build's manifest of the node_modules packages in
// its bundle, which the Vite config's dependencyManifest plugin writes.
const webDependencies = "dependencies.json"

// dependencies is the third-party packages that ship in Bandmate, as the
// About page lists them.
type dependencies struct {
	Go  []build.Dependency `json:"go"`
	Web []build.Dependency `json:"web"`
}

// shipped is what ships: goModules, else the binary's own, and the web
// packages the built SPA recorded, if any.
func shipped(goModules []build.Dependency, spa fs.FS) dependencies {
	if goModules == nil {
		goModules = build.GoModules()
	}
	d := dependencies{Go: listedGoModules(goModules), Web: []build.Dependency{}}

	manifest, err := fs.ReadFile(spa, webDependencies)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		// The SPA hasn't been built, so no web packages ship.
	case err != nil:
		log.Printf("reading the web app's dependencies: %v", err)
	default:
		if err := json.Unmarshal(manifest, &d.Web); err != nil {
			log.Printf("reading the web app's dependencies: %v", err)
		}
		if d.Web == nil {
			d.Web = []build.Dependency{}
		}
	}
	return d
}

// listedGoModules is the Go modules as the About page lists them: one whose
// license couldn't be identified links to pkg.go.dev, where it can be looked
// up.
func listedGoModules(recorded []build.Dependency) []build.Dependency {
	listed := make([]build.Dependency, len(recorded))
	for i, m := range recorded {
		if m.License == "" || m.License == build.UnknownLicense {
			m.License = build.UnknownLicense
			m.URL = "https://pkg.go.dev/" + m.Name + "@" + m.Version
		}
		listed[i] = m
	}
	return listed
}
