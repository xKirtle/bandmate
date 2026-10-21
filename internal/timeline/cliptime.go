package timeline

// Where a Clip's audio meets the Timeline. A Clip's Start and Length are
// Timeline time, while its Offset, its Nudge, a Take's position and its
// source's duration are time in its audio. It plays its audio at a rate:
// how many seconds of its source it plays for each second of the Timeline.
// Everything that crosses between the two goes through here, as the
// browser's clipTime does, so the rate is the one place a Clip's speed is
// decided: its Tempo.

// rate is how many seconds of its source a Clip plays for each second of
// the Timeline.
func (c Clip) rate() float64 {
	return c.Tempo
}

// sourceAt is where in its source c is at time t on the Timeline, in
// seconds; before its start or past its end too.
func (c Clip) sourceAt(t float64) float64 {
	return c.Offset + (t-c.Start)*c.rate()
}

// timelineAt is when on the Timeline c reaches a position in its source, in
// seconds; outside its trim too.
func (c Clip) timelineAt(position float64) float64 {
	return c.Start + (position-c.Offset)/c.rate()
}

// sourceLength is how many seconds of its source c plays over seconds of
// the Timeline.
func (c Clip) sourceLength(seconds float64) float64 {
	return seconds * c.rate()
}

// timelineLength is how many seconds of the Timeline c takes to play
// seconds of its source.
func (c Clip) timelineLength(seconds float64) float64 {
	return seconds / c.rate()
}

// sourceEnd is where in its source c stops playing.
func (c Clip) sourceEnd() float64 {
	return c.Offset + c.sourceLength(c.Length)
}
