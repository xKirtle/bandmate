package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/xKirtle/bandmate/internal/audio"
)

// Beats and Masters are uploaded the same way: the audio file as uploaded,
// with what the browser worked out by decoding it. Covers are uploaded
// likewise, as the pictures the browser made.

// maxDetailsSize caps the JSON sent alongside an audio file. The waveform
// peaks make up most of it: 100 per second is under 1 MB for half an hour.
const maxDetailsSize = 8 << 20

// uploadDetails is what the browser worked out by decoding an audio file,
// sent with it.
type uploadDetails struct {
	Duration float64   `json:"duration"`
	Peaks    []float64 `json:"peaks"`
}

func (d uploadDetails) audio(fileName, contentType string) audio.Upload {
	return audio.Upload{FileName: fileName, ContentType: contentType, Duration: d.Duration, Peaks: d.Peaks}
}

// uploadedFile is the "file" part of an upload, stored under a temporary
// name.
type uploadedFile struct {
	*audio.Received
	name        string
	contentType string
}

// readUpload reads a multipart upload of an audio file ("file") and a JSON
// object ("details") decoded into details. The file is streamed into files and
// capped at the upload limit. On failure it answers the request, keeps
// nothing and returns false; on success the caller keeps or discards the
// file.
func (a *App) readUpload(w http.ResponseWriter, r *http.Request, files *audio.Files, details any) (uploadedFile, bool) {
	tooLarge := fmt.Sprintf("the file is larger than the upload limit of %s", audio.FormatSize(a.maxUpload))
	got, ok := readFiles(w, r, a.maxUpload, tooLarge, []filePart{{"file", files}}, details)
	return got["file"], ok
}

// filePart is a file expected in an upload: the name of its part, and
// where it's received.
type filePart struct {
	name  string
	files *audio.Files
}

// readFiles reads a multipart upload of one file for each of parts and a
// JSON object ("details") decoded into details. Each file is streamed into
// its part's files, and all of them together are capped at limit, beyond
// which tooLarge is the answer. On failure it answers the request, keeps
// nothing and returns false; on success the caller keeps or discards the
// files, by part name.
func readFiles(w http.ResponseWriter, r *http.Request, limit int64, tooLarge string, parts []filePart, details any) (map[string]uploadedFile, bool) {
	got := map[string]uploadedFile{}
	fail := func(status int, msg string) (map[string]uploadedFile, bool) {
		for _, f := range got {
			f.Discard()
		}
		writeError(w, status, msg)
		return nil, false
	}
	bodyLimit := limit + maxDetailsSize
	if r.ContentLength > bodyLimit {
		return fail(http.StatusRequestEntityTooLarge, tooLarge)
	}
	r.Body = http.MaxBytesReader(w, r.Body, bodyLimit)
	form, err := r.MultipartReader()
	if err != nil {
		return fail(http.StatusBadRequest, "the upload must be a multipart form")
	}
	filesFor := map[string]*audio.Files{}
	for _, p := range parts {
		filesFor[p.name] = p.files
	}
	var received int64
	sawDetails := false
	for {
		part, err := form.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return fail(http.StatusRequestEntityTooLarge, tooLarge)
		}
		if err != nil {
			return fail(http.StatusBadRequest, "the upload must be a multipart form")
		}
		name := part.FormName()
		if name == "details" {
			dec := json.NewDecoder(io.LimitReader(part, maxDetailsSize))
			dec.DisallowUnknownFields()
			if err := dec.Decode(details); err != nil {
				return fail(http.StatusBadRequest, "details must be valid JSON with known fields")
			}
			sawDetails = true
			continue
		}
		files, ok := filesFor[name]
		if !ok {
			continue
		}
		if _, dup := got[name]; dup {
			return fail(http.StatusBadRequest, "send one "+name)
		}
		file, err := files.Receive(part, limit-received)
		if errors.Is(err, audio.ErrTooLarge) || errors.As(err, &maxBytes) {
			return fail(http.StatusRequestEntityTooLarge, tooLarge)
		}
		if err != nil {
			log.Printf("receiving upload: %v", err)
			return fail(http.StatusInternalServerError, "something went wrong")
		}
		received += file.Size
		got[name] = uploadedFile{Received: file, name: part.FileName(), contentType: part.Header.Get("Content-Type")}
	}
	for _, p := range parts {
		if _, ok := got[p.name]; !ok {
			return fail(http.StatusBadRequest, p.name+" is required")
		}
	}
	if !sawDetails {
		return fail(http.StatusBadRequest, "details are required")
	}
	return got, true
}
