package app

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/xKirtle/bandmate/internal/languagedata"
)

// languageData serves a Language's data, which the page counts syllables
// from itself (ADR 0018). It's sent gzipped to a browser that takes it, as
// every browser does, and with an ETag, so the browser keeps it and asks
// only whether it changed.
func (a *App) languageData(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	data, ok := languagedata.Of(code)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("there's no language %q", code))
		return
	}
	w.Header().Set("ETag", data.ETag)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Vary", "Accept-Encoding")
	if r.Header.Get("If-None-Match") == data.ETag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if acceptsGzip(r) {
		w.Header().Set("Content-Encoding", "gzip")
		if _, err := w.Write(data.Gzipped); err != nil {
			log.Printf("sending %s data: %v", code, err)
		}
		return
	}
	zr, err := gzip.NewReader(bytes.NewReader(data.Gzipped))
	if err != nil {
		log.Printf("reading %s data: %v", code, err)
		writeError(w, http.StatusInternalServerError, "couldn't read the language's data")
		return
	}
	if _, err := io.Copy(w, zr); err != nil {
		log.Printf("sending %s data: %v", code, err)
	}
}

// acceptsGzip reports whether a request takes a gzipped response.
func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		coding, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(coding), "gzip") && strings.ReplaceAll(params, " ", "") != "q=0" {
			return true
		}
	}
	return false
}
