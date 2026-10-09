package timeline

// Where a Clip's audio meets the Timeline. A Clip's start and length are
// Timeline time, while its offset, a Take's position and nudge, and its
// source's duration are time in its audio. It plays its audio at a rate:
// how many seconds of its source it plays for each second of the Timeline.
// Everything that crosses between the two goes through here, as the
// browser's clipTime does, so the rate is the one place a Clip's speed is
// decided. For now every Clip plays its audio as recorded, at rate 1.

// rate is how many seconds of its source a Clip plays for each second of
// the Timeline.
func (p placement) rate() float64 {
	return 1
}

// sourceAt is where in its source a Clip is at time t on the Timeline, in
// seconds; before its start or past its end too.
func (p placement) sourceAt(t float64) float64 {
	return p.offset + (t-p.start)*p.rate()
}

// timelineAt is when on the Timeline a Clip reaches a position in its
// source, in seconds; outside its trim too.
func (p placement) timelineAt(position float64) float64 {
	return p.start + (position-p.offset)/p.rate()
}

// sourceLength is how many seconds of its source a Clip plays over seconds
// of the Timeline.
func (p placement) sourceLength(seconds float64) float64 {
	return seconds * p.rate()
}

// timelineLength is how many seconds of the Timeline a Clip takes to play
// seconds of its source.
func (p placement) timelineLength(seconds float64) float64 {
	return seconds / p.rate()
}

// sourceEnd is where in its source a Clip stops playing.
func (p placement) sourceEnd() float64 {
	return p.sourceAt(p.start + p.length)
}
