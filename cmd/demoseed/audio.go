package main

import (
	"bytes"
	"encoding/binary"
	"math"
)

// The seed makes its own audio, so it needs nothing but Go and uses
// nothing anyone else wrote: a click track for the Beat, and hummed tones
// for the Takes.

// sampleRate is the rate of all the seed's audio, low to keep it small.
const sampleRate = 22050

// clickTrack is a click on every beat at bpm for seconds, the first of
// each bar of 4 higher and louder.
func clickTrack(bpm, seconds float64) []float64 {
	samples := make([]float64, int(seconds*sampleRate))
	beat := 60 / bpm
	for n := 0; float64(n)*beat < seconds; n++ {
		pitch, level := 1320.0, 0.55
		if n%4 == 0 {
			pitch, level = 1760, 0.9
		}
		addTone(samples, float64(n)*beat, 0.12, func(t float64) (float64, float64) {
			return pitch, level * math.Exp(-t/0.03)
		})
	}
	return samples
}

// phrase is one Line hummed in a Take: its notes, one per half beat, from
// when it starts on the Take.
type phrase struct {
	start float64
	notes []float64 // in Hz
}

// hum is a Take of seconds holding phrases: each note swells and fades
// like a sung syllable, with a little vibrato, level loud at the loudest.
func hum(seconds float64, phrases []phrase, level float64) []float64 {
	samples := make([]float64, int(seconds*sampleRate))
	const note = 60.0 / heroBPM / 2
	for _, p := range phrases {
		for i, pitch := range p.notes {
			addTone(samples, p.start+float64(i)*note, note, func(t float64) (float64, float64) {
				swell := math.Sin(math.Pi * t / note)
				return pitch * (1 + 0.01*math.Sin(2*math.Pi*5.5*t)), level * swell * swell
			})
		}
	}
	return samples
}

// addTone mixes into samples a tone lasting length seconds from start,
// whose pitch in Hz and level shape gives at each moment into it. It has a
// soft overtone, so it sounds less like a test tone.
func addTone(samples []float64, start, length float64, shape func(t float64) (pitch, level float64)) {
	phase := 0.0
	first := int(start * sampleRate)
	for i := 0; i < int(length*sampleRate) && first+i < len(samples); i++ {
		t := float64(i) / sampleRate
		pitch, level := shape(t)
		phase += 2 * math.Pi * pitch / sampleRate
		samples[first+i] += level * (0.8*math.Sin(phase) + 0.2*math.Sin(2*phase))
	}
}

// peaks is the waveform the web app draws: the loudest sample of each
// 1/100 of a second, from 0 to 1.
func peaks(samples []float64) []float64 {
	const window = sampleRate / 100
	var out []float64
	for i := 0; i < len(samples); i += window {
		loudest := 0.0
		for _, s := range samples[i:min(i+window, len(samples))] {
			loudest = max(loudest, math.Abs(s))
		}
		out = append(out, min(loudest, 1))
	}
	return out
}

// duration is how long samples last, in seconds.
func duration(samples []float64) float64 {
	return float64(len(samples)) / sampleRate
}

// wav encodes samples as a mono integer PCM WAV file of bits per sample
// (16 or 24), clipping anything past full scale.
func wav(samples []float64, bits int) []byte {
	width := bits / 8
	data := make([]byte, 0, len(samples)*width)
	full := float64(int(1)<<(bits-1) - 1)
	for _, s := range samples {
		v := int32(math.Round(max(-1, min(1, s)) * full))
		data = append(data, byte(v), byte(v>>8))
		if width == 3 {
			data = append(data, byte(v>>16))
		}
	}
	var b bytes.Buffer
	write := func(v any) { binary.Write(&b, binary.LittleEndian, v) }
	b.WriteString("RIFF")
	write(uint32(36 + len(data)))
	b.WriteString("WAVEfmt ")
	write(uint32(16))
	write(uint16(1)) // integer PCM
	write(uint16(1)) // mono
	write(uint32(sampleRate))
	write(uint32(sampleRate * width))
	write(uint16(width))
	write(uint16(bits))
	b.WriteString("data")
	write(uint32(len(data)))
	b.Write(data)
	return b.Bytes()
}
