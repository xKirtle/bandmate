package build

import (
	_ "embed"
	"encoding/json"
)

// go-modules.json is the Go modules ./cmd/bandmate is built from, other than
// Bandmate itself, as go-licenses finds them, rendered by go-modules.tpl. It's
// committed, so every build has it, and CI fails when it's stale: after
// changing go.mod, run `go generate ./internal/build`. go-licenses reads the
// packages Linux builds, as the image and CI are.
//
//go:generate sh -c "go run github.com/google/go-licenses/v2@v2.0.1 report ../../cmd/bandmate --ignore github.com/xKirtle/bandmate --template go-modules.tpl > go-modules.json"
//go:embed go-modules.json
var goModules []byte

// Dependency is a third-party package that ships in Bandmate, as the About
// page lists it.
type Dependency struct {
	// Name is a Go module's path, or a web package's name.
	Name    string `json:"name"`
	Version string `json:"version"`
	// License is its SPDX identifier, e.g. MIT, or "Unknown" when it couldn't
	// be identified.
	License string `json:"license"`
	// URL is where to look up a license that couldn't be identified.
	URL string `json:"url,omitempty"`
}

// UnknownLicense is a License that couldn't be identified.
const UnknownLicense = "Unknown"

// GoModules is the Go modules the binary is built from, other than Bandmate
// itself, as go generate last recorded them.
func GoModules() []Dependency {
	var mods []Dependency
	if err := json.Unmarshal(goModules, &mods); err != nil {
		panic("build: go-modules.json is malformed; run go generate ./internal/build: " + err.Error())
	}
	return mods
}
