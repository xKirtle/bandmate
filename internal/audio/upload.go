package audio

import (
	"math"
	"mime"
	"path/filepath"
	"strings"
)

// Upload describes an uploaded audio file: what came with it, and what the
// browser worked out by decoding it.
type Upload struct {
	FileName string
	// ContentType is the type the upload declared, if any.
	ContentType string
	// Duration is in seconds.
	Duration float64
	// Peaks is the waveform: the loudest sample of each 1/100 of a second,
	// from 0 to 1.
	Peaks []float64
}

// Problem says what's wrong with what the browser sent about the file, in
// words safe to show the user, or "" if nothing is.
func (u Upload) Problem() string {
	if u.Duration <= 0 || math.IsInf(u.Duration, 0) || math.IsNaN(u.Duration) {
		return "duration must be more than 0 seconds"
	}
	if len(u.Peaks) == 0 {
		return "peaks are required"
	}
	for _, p := range u.Peaks {
		if p < 0 || p > 1 {
			return "peaks must be between 0 and 1"
		}
	}
	return ""
}

// Name is what to call the upload: the name it was given, else its file's
// name without the extension, else its whole name (one that's all
// extension, e.g. ".m4a"), else fallback.
func (u Upload) Name(given, fallback string) string {
	if name := strings.TrimSpace(given); name != "" {
		return name
	}
	if name := strings.TrimSpace(strings.TrimSuffix(u.FileName, filepath.Ext(u.FileName))); name != "" {
		return name
	}
	if name := strings.TrimSpace(u.FileName); name != "" {
		return name
	}
	return fallback
}

// fallbackTypes are the media types of audio files by extension, for
// uploads that don't declare an audio type.
var fallbackTypes = map[string]string{
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
	".flac": "audio/flac",
	".m4a":  "audio/mp4",
	".aac":  "audio/aac",
	".ogg":  "audio/ogg",
	".oga":  "audio/ogg",
	".opus": "audio/ogg",
	".webm": "audio/webm",
	".aif":  "audio/aiff",
	".aiff": "audio/aiff",
}

// MediaType is the type to serve the file with. Only audio types are
// trusted: anything else could make a browser treat the file as a page.
func (u Upload) MediaType() string {
	if t, _, err := mime.ParseMediaType(u.ContentType); err == nil && strings.HasPrefix(t, "audio/") {
		return t
	}
	if t, ok := fallbackTypes[strings.ToLower(filepath.Ext(u.FileName))]; ok {
		return t
	}
	return "application/octet-stream"
}
