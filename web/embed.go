// Package web holds the Svelte single-page app. Its production build in
// dist/ is embedded into the Go binary.
package web

import (
	"embed"
	"io/fs"
)

// dist/.gitkeep is tracked in the repository, so all:dist always matches
// something and the binary builds on a fresh clone, before the SPA has been
// built.
//
//go:embed all:dist
var dist embed.FS

// Dist returns the built SPA with index.html at its root.
func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // "dist" is a valid, embedded path
	}
	return sub
}
