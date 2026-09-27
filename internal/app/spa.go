package app

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// spaHandler serves the built single-page app. Paths that aren't files in
// the build fall back to index.html so client-side routes work on reload.
func spaHandler(spa fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name != "" && name != "index.html" {
			if info, err := fs.Stat(spa, name); err == nil && !info.IsDir() {
				http.ServeFileFS(w, r, spa, name)
				return
			}
		}
		serveIndex(w, spa)
	})
}

func serveIndex(w http.ResponseWriter, spa fs.FS) {
	index, err := fs.ReadFile(spa, "index.html")
	if errors.Is(err, fs.ErrNotExist) {
		http.Error(w, "The web app hasn't been built. Run `npm run build` in web/.", http.StatusServiceUnavailable)
		return
	}
	if err != nil {
		http.Error(w, "reading web app", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// The entry page references hashed assets, so it must never be cached
	// stale after an upgrade.
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(index)
}
