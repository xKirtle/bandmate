package audio

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
)

// WAV is what a WAV file's header says about its audio.
type WAV struct {
	// Format is the WAVE format tag: 1 for integer PCM.
	Format        uint16
	Channels      uint16
	SampleRate    uint32
	BitsPerSample uint16
	// Frames is how many samples each channel holds.
	Frames int64
}

// Duration is how long the audio lasts, in seconds.
func (w WAV) Duration() float64 {
	return float64(w.Frames) / float64(w.SampleRate)
}

// ErrNotWAV means a file isn't a WAV file this package can read.
var ErrNotWAV = errors.New("not a WAV file")

// ReadWAV reads a WAV file's header: its "fmt " chunk and the size of its
// "data" chunk, skipping any other chunks.
func ReadWAV(r io.Reader) (WAV, error) {
	var riff struct {
		ID   [4]byte
		Size uint32
		Wave [4]byte
	}
	if err := binary.Read(r, binary.LittleEndian, &riff); err != nil || string(riff.ID[:]) != "RIFF" || string(riff.Wave[:]) != "WAVE" {
		return WAV{}, ErrNotWAV
	}
	var w WAV
	sawFormat := false
	for {
		var chunk struct {
			ID   [4]byte
			Size uint32
		}
		if err := binary.Read(r, binary.LittleEndian, &chunk); err != nil {
			return WAV{}, ErrNotWAV
		}
		switch string(chunk.ID[:]) {
		case "fmt ":
			var f struct {
				Format        uint16
				Channels      uint16
				SampleRate    uint32
				ByteRate      uint32
				BlockAlign    uint16
				BitsPerSample uint16
			}
			if chunk.Size < 16 || binary.Read(r, binary.LittleEndian, &f) != nil {
				return WAV{}, ErrNotWAV
			}
			if f.Channels == 0 || f.SampleRate == 0 || f.BitsPerSample == 0 || f.BlockAlign != f.Channels*((f.BitsPerSample+7)/8) {
				return WAV{}, ErrNotWAV
			}
			w = WAV{Format: f.Format, Channels: f.Channels, SampleRate: f.SampleRate, BitsPerSample: f.BitsPerSample}
			sawFormat = true
			if err := skip(r, int64(chunk.Size)-16); err != nil {
				return WAV{}, err
			}
		case "data":
			if !sawFormat {
				return WAV{}, ErrNotWAV
			}
			w.Frames = int64(chunk.Size) / int64(w.Channels*((w.BitsPerSample+7)/8))
			return w, nil
		default:
			if err := skip(r, int64(chunk.Size)); err != nil {
				return WAV{}, err
			}
		}
		// Chunks are padded to an even size.
		if chunk.Size%2 == 1 {
			if err := skip(r, 1); err != nil {
				return WAV{}, err
			}
		}
	}
}

func skip(r io.Reader, n int64) error {
	if _, err := io.CopyN(io.Discard, r, n); err != nil {
		return ErrNotWAV
	}
	return nil
}

// ReadWAV reads the received file's WAV header.
func (r *Received) ReadWAV() (WAV, error) {
	f, err := os.Open(r.path)
	if err != nil {
		return WAV{}, fmt.Errorf("opening upload: %w", err)
	}
	defer f.Close()
	return ReadWAV(f)
}
