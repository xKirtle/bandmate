package build

import (
	_ "embed"
	"encoding/json"
)

// go-modules.json is the Go modules ./cmd/bandmate is built from, other than
// Bandmate itself, with the licenses go-licenses finds (see ./gomodules). It's
// committed, so every build has it, and CI fails when it's stale: after
// changing go.mod, run `go generate ./internal/build`. It lists the modules a
// Linux build uses, as the image and CI are.
//
//go:generate go run ./gomodules
//go:embed go-modules.json
var goModules []byte

// Dependency is a third-party package that ships in Bandmate, as the About
// page lists it.
type Dependency struct {
	// Name is a Go module's path, or a web package's name.
	Name    string `json:"name"`
	Version string `json:"version"`
	// License is its SPDX identifier or expression, e.g. MIT or
	// "Apache-2.0 AND BSD-3-Clause", or "Unknown" when it couldn't be
	// identified.
	License string `json:"license"`
	// URL is where to look up a license that couldn't be identified.
	URL string `json:"url,omitempty"`
	// Credit is the attribution its licence asks for, where that's more
	// than its name, such as the data it was built from: a sentence, in
	// parts, some of them links.
	Credit []Link `json:"credit,omitempty"`
}

// Link is a part of a Credit: text, and where it links to, if anywhere.
type Link struct {
	Text string `json:"text"`
	URL  string `json:"url,omitempty"`
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
