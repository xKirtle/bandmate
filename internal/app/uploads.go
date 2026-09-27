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
// with what the browser worked out by decoding it.

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
	fail := func(file uploadedFile, status int, msg string) (uploadedFile, bool) {
		if file.Received != nil {
			file.Discard()
		}
		writeError(w, status, msg)
		return uploadedFile{}, false
	}
	tooLarge := fmt.Sprintf("the file is larger than the upload limit of %s", formatSize(a.maxUpload))
	limit := a.maxUpload + maxDetailsSize
	if r.ContentLength > limit {
		return fail(uploadedFile{}, http.StatusRequestEntityTooLarge, tooLarge)
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	parts, err := r.MultipartReader()
	if err != nil {
		return fail(uploadedFile{}, http.StatusBadRequest, "the upload must be a multipart form")
	}
	var file uploadedFile
	sawDetails := false
	for {
		part, err := parts.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return fail(file, http.StatusRequestEntityTooLarge, tooLarge)
		}
		if err != nil {
			return fail(file, http.StatusBadRequest, "the upload must be a multipart form")
		}
		switch part.FormName() {
		case "details":
			dec := json.NewDecoder(io.LimitReader(part, maxDetailsSize))
			dec.DisallowUnknownFields()
			if err := dec.Decode(details); err != nil {
				return fail(file, http.StatusBadRequest, "details must be valid JSON with known fields")
			}
			sawDetails = true
		case "file":
			if file.Received != nil {
				return fail(file, http.StatusBadRequest, "send one file")
			}
			received, err := files.Receive(part, a.maxUpload)
			if errors.Is(err, audio.ErrTooLarge) || errors.As(err, &maxBytes) {
				return fail(file, http.StatusRequestEntityTooLarge, tooLarge)
			}
			if err != nil {
				log.Printf("receiving upload: %v", err)
				return fail(file, http.StatusInternalServerError, "something went wrong")
			}
			file = uploadedFile{Received: received, name: part.FileName(), contentType: part.Header.Get("Content-Type")}
		}
	}
	if file.Received == nil {
		return fail(file, http.StatusBadRequest, "file is required")
	}
	if !sawDetails {
		return fail(file, http.StatusBadRequest, "details are required")
	}
	return file, true
}

// formatSize writes a byte count for people, e.g. "500 MB".
func formatSize(bytes int64) string {
	const mb = 1 << 20
	if bytes >= mb && bytes%mb == 0 {
		return fmt.Sprintf("%d MB", bytes/mb)
	}
	if bytes >= mb {
		return fmt.Sprintf("%.1f MB", float64(bytes)/mb)
	}
	return fmt.Sprintf("%d bytes", bytes)
}
