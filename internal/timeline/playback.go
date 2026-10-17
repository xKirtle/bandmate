package timeline

// ClipPlayback is how a Clip plays its audio: its Gain, Tempo, Pitch and
// Fades. Every Clip shape embeds it, so its fields stay flat in JSON. It
// has no JSON decoder of its own: an embedded type's would decode the whole
// shape it's in.
type ClipPlayback struct {
	// Gain is how much louder or quieter it plays, in dB, before its Track's
	// volume applies: from MinGain to MaxGain, 0 until it's set.
	Gain float64 `json:"gain"`
	// Tempo is how fast it plays its audio, without changing its Pitch, as a
	// ratio of as recorded: from MinTempo to MaxTempo, 1 until it's set. Its
	// Length is Timeline time, so it plays Length × Tempo seconds of its
	// source.
	Tempo float64 `json:"tempo"`
	// Pitch is how many semitones its audio is moved up or down, without
	// changing its Tempo: a whole number from MinPitch to MaxPitch, 0 until
	// it's set. It never changes its Length.
	Pitch float64 `json:"pitch"`
	// FadeIn and FadeOut are how long it rises from silence at its start
	// and falls to silence at its end, in seconds, each measured from that
	// edge as trimmed: 0 for none. Together they never run longer than it.
	FadeIn  float64 `json:"fadeIn"`
	FadeOut float64 `json:"fadeOut"`
}

// WithDefaults is the playback as a request gives it, with what it leaves
// out filled in: a Tempo of 0, which no Clip can have, means none was given,
// so the Clip plays as recorded.
func (pb ClipPlayback) WithDefaults() ClipPlayback {
	if pb.Tempo == 0 {
		pb.Tempo = 1
	}
	return pb
}

// asRecorded is the playback of a Clip as recorded, e.g. one a recording
// or an import adds: its defaults.
func asRecorded() ClipPlayback {
	return ClipPlayback{}.WithDefaults()
}

// check checks the playback of a new Clip length seconds long: its Tempo,
// Pitch, Gain and Fades.
func (pb ClipPlayback) check(length float64) error {
	if err := checkTempo(pb.Tempo); err != nil {
		return err
	}
	if err := checkPitch(pb.Pitch); err != nil {
		return err
	}
	if err := checkGain(pb.Gain); err != nil {
		return err
	}
	return pb.fades().check(length)
}

// fades are its Fades.
func (pb ClipPlayback) fades() Fades {
	return Fades{In: pb.FadeIn, Out: pb.FadeOut}
}

// setFades sets its Fades.
func (pb *ClipPlayback) setFades(f Fades) {
	pb.FadeIn, pb.FadeOut = f.In, f.Out
}
