package app

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/xKirtle/bandmate/internal/languagedata"
)

// languageData serves a Language's data, which the page finds Rhymes in
// itself (ADR 0018). It's sent gzipped to a browser that takes it, as
// every browser does, and with an ETag, so the browser keeps it and asks
// only whether it changed.
func (a *App) languageData(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	data, ok := languagedata.Of(code)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("there's no language %q", code))
		return
	}
	gzipped := acceptsGzip(r)
	// The gzipped and plain answers differ, so each has a tag of its own.
	etag := data.ETag
	if gzipped {
		etag = strings.TrimSuffix(etag, `"`) + `-gzip"`
	}
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Vary", "Accept-Encoding")
	if matchesETag(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if gzipped {
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

// matchesETag reports whether an If-None-Match header names etag, weakly
// compared, as a GET's is: a W/ prefix is ignored, and "*" matches any.
func matchesETag(ifNoneMatch, etag string) bool {
	for _, tag := range strings.Split(ifNoneMatch, ",") {
		tag = strings.TrimPrefix(strings.TrimSpace(tag), "W/")
		if tag == "*" || tag == etag {
			return true
		}
	}
	return false
}

// acceptsGzip reports whether a request takes a gzipped response: it names
// gzip in Accept-Encoding with a weight above 0.
func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		coding, params, _ := strings.Cut(part, ";")
		if !strings.EqualFold(strings.TrimSpace(coding), "gzip") {
			continue
		}
		weight, found := strings.CutPrefix(strings.ReplaceAll(params, " ", ""), "q=")
		if !found {
			return true
		}
		q, err := strconv.ParseFloat(weight, 64)
		return err == nil && q > 0
	}
	return false
}
