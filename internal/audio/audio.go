// Package audio keeps uploaded files on disk exactly as uploaded, named by
// id rather than by the uploaded file name: audio files, and also Covers'
// pictures. Their metadata lives in the database, with whatever owns them.
package audio

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

// ErrTooLarge means an upload went over its size limit.
var ErrTooLarge = errors.New("audio file too large")

// Files is a directory of audio files.
type Files struct {
	dir string
}

// tempPrefix marks uploads still being received or not yet kept.
const tempPrefix = ".upload-"

// Open returns the files in dir, creating it if needed. Uploads left
// half-received by a crash are removed.
func Open(dir string) (*Files, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating audio directory: %w", err)
	}
	leftovers, err := filepath.Glob(filepath.Join(dir, tempPrefix+"*"))
	if err != nil {
		return nil, err
	}
	for _, path := range leftovers {
		os.Remove(path)
	}
	return &Files{dir: dir}, nil
}

// Received is an uploaded file stored under a temporary name, until it is
// kept under an id or discarded.
type Received struct {
	files *Files
	path  string
	// Size is the file's size in bytes.
	Size int64
}

// Receive stores src under a temporary name. It fails with ErrTooLarge,
// keeping nothing, if src holds more than limit bytes.
func (f *Files) Receive(src io.Reader, limit int64) (*Received, error) {
	tmp, err := os.CreateTemp(f.dir, tempPrefix+"*")
	if err != nil {
		return nil, fmt.Errorf("storing upload: %w", err)
	}
	r := &Received{files: f, path: tmp.Name()}
	// Reading one byte past the limit tells a file of exactly limit bytes
	// apart from a larger one.
	r.Size, err = io.Copy(tmp, io.LimitReader(src, limit+1))
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil && r.Size > limit {
		err = ErrTooLarge
	}
	if err != nil {
		r.Discard()
		if errors.Is(err, ErrTooLarge) {
			return nil, err
		}
		return nil, fmt.Errorf("storing upload: %w", err)
	}
	return r, nil
}

// Keep stores the file under id, replacing any file already there.
func (r *Received) Keep(id int64) error {
	if err := os.Rename(r.path, r.files.path(id)); err != nil {
		return fmt.Errorf("keeping upload: %w", err)
	}
	return nil
}

// Discard removes the file if it hasn't been kept. It is safe to call after
// Keep.
func (r *Received) Discard() {
	os.Remove(r.path)
}

// Serve answers a request for the file stored under id, honouring Range
// requests so players can seek without downloading everything.
func (f *Files) Serve(w http.ResponseWriter, r *http.Request, id int64, contentType string) error {
	file, err := os.Open(f.path(id))
	if err != nil {
		return fmt.Errorf("opening audio file: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("opening audio file: %w", err)
	}
	w.Header().Set("Content-Type", contentType)
	// The type was set on upload; never let a browser guess another one.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// A replaced file keeps its address, so check it's still current
	// before playing a cached copy.
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "", info.ModTime(), file)
	return nil
}

// Remove deletes the file stored under id, if there is one.
func (f *Files) Remove(id int64) error {
	if err := os.Remove(f.path(id)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("removing audio file: %w", err)
	}
	return nil
}

func (f *Files) path(id int64) string {
	return filepath.Join(f.dir, strconv.FormatInt(id, 10))
}
