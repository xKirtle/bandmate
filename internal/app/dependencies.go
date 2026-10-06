package app

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"os"

	"github.com/xKirtle/bandmate/internal/build"
)

// webDependencies is the SPA build's manifest of the node_modules packages in
// its bundle, which the Vite config's dependencyManifest plugin writes.
const webDependencies = "dependencies.json"

// dependencies is the third-party packages that ship in Bandmate, as the
// About page lists them: the Go modules the binary is built from, the web
// packages in the SPA's bundle, and the programs bundled beside them in the
// image.
type dependencies struct {
	Go       []build.Dependency `json:"go"`
	Web      []build.Dependency `json:"web"`
	Programs []build.Dependency `json:"programs"`
}

// shipped is what ships: goModules, else the binary's own, the web packages
// the built SPA recorded, if any, and the programs the image's build recorded
// in programsManifest, if any.
func shipped(goModules []build.Dependency, spa fs.FS, programsManifest string) dependencies {
	if goModules == nil {
		goModules = build.GoModules()
	}
	// No manifest ("" included) is ErrNotExist, so lists none.
	return dependencies{
		Go:       listedGoModules(goModules),
		Web:      recorded("the web app's dependencies", func() ([]byte, error) { return fs.ReadFile(spa, webDependencies) }),
		Programs: recorded("the bundled programs", func() ([]byte, error) { return os.ReadFile(programsManifest) }),
	}
}

// recorded is the dependencies listed in a build's manifest, which read
// reads, or none when there's no manifest: a build without them, such as an
// SPA that hasn't been built or a binary run outside the image, has none.
// A manifest that can't be read is logged, naming it as manifestOf says,
// and lists none, so it never stops the app starting.
func recorded(manifestOf string, read func() ([]byte, error)) []build.Dependency {
	manifest, err := read()
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return []build.Dependency{}
	case err != nil:
		log.Printf("reading %s: %v", manifestOf, err)
		return []build.Dependency{}
	}
	var deps []build.Dependency
	if err := json.Unmarshal(manifest, &deps); err != nil {
		log.Printf("reading %s: %v", manifestOf, err)
	}
	if deps == nil {
		deps = []build.Dependency{}
	}
	return deps
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
