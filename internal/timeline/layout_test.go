package timeline

import "testing"

// beatClip is a Clip of Beat 1, which lasts 60 seconds, as recorded.
func beatClip(id int64, start, length float64) Clip {
	beat := int64(1)
	return Clip{ID: id, BeatID: &beat, Tempo: 1, Takes: []Take{}, Start: start, Length: length}
}

// timelineOf is a Timeline of one Track per list of Clips, playing Beat 1,
// 60 seconds long.
func timelineOf(tracks ...[]Clip) Timeline {
	tl := Timeline{Beats: []Beat{{ID: 1, Duration: 60}}}
	for i, clips := range tracks {
		tl.Tracks = append(tl.Tracks, Track{ID: int64(i + 1), Clips: clips})
	}
	return tl
}

func TestCheckLayoutOverlap(t *testing.T) {
	tests := []struct {
		name          string
		before, after Timeline
		want          *violation
	}{
		{
			name:   "a Clip moved onto another",
			before: timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 10, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 2, 4)}),
			want:   &violation{rule: ruleNoOverlap, clipID: 2},
		},
		{
			name:   "a Clip moved to touch another's end",
			before: timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 10, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 4, 4)}),
		},
		{
			name:   "a Clip moved a rounding hair into another",
			before: timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 10, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 4-tolerance/2, 4)}),
		},
		{
			name:   "a Clip moved more than the tolerance into another",
			before: timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 10, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 4-2*tolerance, 4)}),
			want:   &violation{rule: ruleNoOverlap, clipID: 2},
		},
		{
			name:   "a Clip added over another",
			before: timelineOf([]Clip{beatClip(1, 0, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 3, 4)}),
			want:   &violation{rule: ruleNoOverlap, clipID: 2},
		},
		{
			name:   "a Clip moved onto another Track's Clip's place",
			before: timelineOf([]Clip{beatClip(1, 0, 4)}, []Clip{beatClip(2, 10, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 0, 4)}, []Clip{beatClip(2, 0, 4)}),
		},
		{
			name:   "a Clip moved onto a Track where another plays",
			before: timelineOf([]Clip{beatClip(1, 0, 4)}, []Clip{beatClip(2, 0, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 1, 4)}, []Clip{}),
			want:   &violation{rule: ruleNoOverlap, clipID: 2},
		},
		{
			name:   "Clips moved together, passing each other's old places",
			before: timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 4, 4)}),
			after:  timelineOf([]Clip{beatClip(2, 2, 4), beatClip(1, 6, 4)}),
		},
		{
			name:   "Clips moved together onto each other",
			before: timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 10, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 20, 4), beatClip(2, 21, 4)}),
			want:   &violation{rule: ruleNoOverlap, clipID: 1},
		},
		{
			name:   "an already overlapping pair the change doesn't touch",
			before: timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 2, 4), beatClip(3, 10, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 2, 4), beatClip(3, 20, 4)}),
		},
		{
			name:   "a renamed Clip of an already overlapping pair",
			before: timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 2, 4)}),
			after:  timelineOf([]Clip{named(beatClip(1, 0, 4), "Intro"), beatClip(2, 2, 4)}),
		},
		{
			name:   "a Clip moved off an already overlapping one",
			before: timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 2, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 4, 4)}),
		},
		{
			name:   "a change that touches no Clips",
			before: timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 2, 4)}),
			after:  timelineOf([]Clip{beatClip(1, 0, 4), beatClip(2, 2, 4)}, []Clip{}),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := checkLayout(tt.before, tt.after)
			if (got == nil) != (tt.want == nil) || (got != nil && *got != *tt.want) {
				t.Errorf("checkLayout = %+v, want %+v", got, tt.want)
			}
		})
	}
}

// named is c with a name of its own.
func named(c Clip, name string) Clip {
	c.Name = &name
	return c
}

// takesClip is a Clip of Takes, playing the first, each 10 seconds long,
// where it starts in the span and nudged as given.
func takesClip(id int64, start, offset, length float64, takes ...Take) Clip {
	for i := range takes {
		takes[i].Duration = 10
	}
	active := takes[0].ID
	return Clip{ID: id, Tempo: 1, Takes: takes, ActiveTakeID: &active, Start: start, Offset: offset, Length: length}
}

func TestCheckLayoutClips(t *testing.T) {
	sound := int64(1)
	soundClip := Clip{ID: 1, SoundID: &sound, Tempo: 1, Takes: []Take{}, Length: 5}
	slowed := beatClip(1, 0, 60)
	slowed.Tempo, slowed.Length = 0.5, 120
	faded := func(c Clip, in, out float64) Clip {
		c.FadeIn, c.FadeOut = in, out
		return c
	}
	offset := func(c Clip, by float64) Clip {
		c.Offset = by
		return c
	}
	tests := []struct {
		name  string
		after Clip
		want  layoutRule
	}{
		{"a Clip at 0:00", beatClip(1, 0, 4), 0},
		{"a Clip a rounding hair before 0:00", beatClip(1, -tolerance/2, 4), 0},
		{"a Clip before 0:00", beatClip(1, -1, 4), ruleOnTimeline},
		{"a Clip playing all its Beat", beatClip(1, 0, 60), 0},
		{"a Clip playing a rounding hair past its Beat", beatClip(1, 0, 60+tolerance/2), 0},
		{"a Clip playing past its Beat", beatClip(1, 0, 61), rulePastSource},
		{"a Clip trimmed to play past its Beat", offset(beatClip(1, 0, 10), 55), rulePastSource},
		{"a Clip starting before its source", offset(beatClip(1, 0, 10), -1), ruleBeforeSource},
		{"a Clip playing nothing", beatClip(1, 0, 0), ruleNoLength},
		{"a slowed Clip playing all its Beat", slowed, 0},
		{"a Clip playing all its Sound", soundClip, 0},
		{"a Clip playing past its Sound", func() Clip { c := soundClip; c.Length = 6; return c }(), rulePastSource},
		{"a Clip playing up to where its last Take ends",
			takesClip(1, 0, 0, 12, Take{ID: 1}, Take{ID: 2, Position: 2}), 0},
		{"a Clip playing past where its last Take ends",
			takesClip(1, 0, 0, 13, Take{ID: 1}, Take{ID: 2, Position: 2}), rulePastSource},
		{"a Clip playing up to where a Take nudged earlier used to end",
			takesClip(1, 0, 0, 12, Take{ID: 1}, Take{ID: 2, Position: 0, Nudge: -2}), 0},
		{"a Clip playing past where its nudged Take reaches",
			takesClip(1, 0, 0, 13, Take{ID: 1}, Take{ID: 2, Position: 0, Nudge: -2}), rulePastSource},
		{"a Clip with Fades that fit", faded(beatClip(1, 0, 4), 1, 3), 0},
		{"a Clip with Fades a rounding hair too long", faded(beatClip(1, 0, 4), 1, 3+tolerance/2), 0},
		{"a Clip with Fades that don't fit", faded(beatClip(1, 0, 4), 2, 3), ruleFadesFit},
		{"a Clip with a Fade shorter than nothing", faded(beatClip(1, 0, 4), -1, 0), ruleFadesFit},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			before := timelineOf([]Clip{})
			after := timelineOf([]Clip{tt.after})
			after.Sounds = []Sound{{ID: 1, Duration: 5}}
			got := checkLayout(before, after)
			var want *violation
			if tt.want != 0 {
				want = &violation{rule: tt.want, clipID: 1}
			}
			if (got == nil) != (want == nil) || (got != nil && *got != *want) {
				t.Errorf("checkLayout = %+v, want %+v", got, want)
			}
		})
	}
}

func TestCheckLayoutLeavesUntouchedClips(t *testing.T) {
	bad := beatClip(1, 0, 61)
	bad.FadeIn = 70
	before := timelineOf([]Clip{bad, beatClip(2, 70, 4)})
	after := timelineOf([]Clip{bad, beatClip(2, 75, 4)})
	if got := checkLayout(before, after); got != nil {
		t.Errorf("checkLayout = %+v, want none", got)
	}
}

func TestCheckLayoutNudgedTake(t *testing.T) {
	// The Clip is trimmed out to its Take nudged later, which is nudged
	// back: only the Take moves.
	before := timelineOf([]Clip{takesClip(1, 0, 0, 12, Take{ID: 1}, Take{ID: 2, Position: 2, Nudge: 1})})
	after := timelineOf([]Clip{takesClip(1, 0, 0, 12, Take{ID: 1}, Take{ID: 2, Position: 1})})
	want := violation{rule: rulePastSource, clipID: 1}
	if got := checkLayout(before, after); got == nil || *got != want {
		t.Errorf("checkLayout = %+v, want %+v", got, want)
	}
}
