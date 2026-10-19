package timeline

import (
	"fmt"
	"slices"

	"github.com/xKirtle/bandmate/internal/domain"
)

// The Timeline's placement rules are checked once, on the Timeline a change
// leaves, never a Clip at a time partway through it (ADR 0023). Operations
// write their Clips without checking where; the change path then checks
// the Timeline as it is before and after, and refuses the change if it
// breaks a rule.

// placementRule is one of the rules every Clip on the Timeline keeps.
type placementRule int

// The placement rules. Times within the tolerance of a limit are taken as
// at it, absorbing rounding.
const (
	// ruleOnTimeline: a Clip starts on the Timeline, at 0:00 or later.
	ruleOnTimeline placementRule = iota + 1
	// ruleNoOverlap: no two Clips on a Track overlap. Touching edges is fine.
	ruleNoOverlap
	// ruleBeforeSource, ruleNoLength and rulePastSource keep a Clip within
	// its source: it starts playing where its source does or later, plays
	// for some time, and stops by the source's end.
	ruleBeforeSource
	ruleNoLength
	rulePastSource
	// ruleFadesFit: a Clip's Fades together run no longer than it. (The
	// database refuses a Fade shorter than nothing.)
	ruleFadesFit
)

// violation is a placement rule a change broke, and the Clip it broke it
// on: 0 for one a change was about to add.
type violation struct {
	rule   placementRule
	clipID int64
}

// err is the refusal of a change that broke v's rule, in the rule's own
// words.
func (v violation) err() error {
	switch v.rule {
	case ruleOnTimeline:
		return domain.Invalid("a Clip can't start before 0:00")
	case ruleNoOverlap:
		return domain.Conflict("Clips can't overlap on a Track")
	case ruleBeforeSource:
		return domain.Invalid("a Clip can't start before its source does")
	case ruleNoLength:
		return domain.Invalid("a Clip must play for some time")
	case rulePastSource:
		return domain.Invalid("a Clip can't play past the end of its source")
	case ruleFadesFit:
		return errFadesTooLong
	}
	panic(fmt.Sprintf("no such placement rule: %d", v.rule))
}

// checkLayout checks the Clips a change made or altered, taking the
// Timeline from before to after, against the placement rules, returning the
// first rule one breaks, or nil. Clips it left as they were aren't checked,
// so a Song whose stored layout is already off never refuses the change
// that would fix it.
func checkLayout(before, after Timeline) *violation {
	was := map[int64]placed{}
	for _, t := range before.Tracks {
		for _, c := range t.Clips {
			was[c.ID] = placed{t.ID, c}
		}
	}
	for _, t := range after.Tracks {
		for _, c := range t.Clips {
			if old, ok := was[c.ID]; ok && old.samePlacement(placed{t.ID, c}) {
				continue
			}
			if rule := clipRule(after, t, c); rule != 0 {
				return &violation{rule: rule, clipID: c.ID}
			}
		}
	}
	return nil
}

// clipRule is the first placement rule c, on t on the Timeline tl, breaks,
// or 0 for none.
func clipRule(tl Timeline, t Track, c Clip) placementRule {
	if rule := storedRule(c.Start, c.Offset, c.Length); rule != 0 {
		return rule
	}
	switch {
	case c.sourceEnd() > sourceDuration(tl, c)+tolerance:
		return rulePastSource
	case !c.fades().fit(c.Length):
		return ruleFadesFit
	case overlapsAnother(t, c):
		return ruleNoOverlap
	}
	return 0
}

// storedRule is the first rule a Clip starting at start on the Timeline,
// playing length seconds of it from offset in its source, breaks of those
// the database holds too, or 0 for none: it starts on the Timeline, and
// where its source does or later, and plays for some time.
func storedRule(start, offset, length float64) placementRule {
	switch {
	case offset < -tolerance:
		return ruleBeforeSource
	case length <= 0:
		return ruleNoLength
	case start < -tolerance:
		return ruleOnTimeline
	}
	return 0
}

// sourceDuration is how long c's source is on the Timeline tl, in seconds,
// however c trims it: its Beat's or its Sound's, or the span up to where
// the last of its Takes ends, whichever is active.
func sourceDuration(tl Timeline, c Clip) float64 {
	switch {
	case c.BeatID != nil:
		if i := slices.IndexFunc(tl.Beats, func(b Beat) bool { return b.ID == *c.BeatID }); i >= 0 {
			return tl.Beats[i].Duration
		}
	case c.SoundID != nil:
		if i := slices.IndexFunc(tl.Sounds, func(s Sound) bool { return s.ID == *c.SoundID }); i >= 0 {
			return tl.Sounds[i].Duration
		}
	default:
		return takesEnd(c.Takes)
	}
	return 0
}

// takesEnd is where in their Clip's source span the last of the Takes
// ends. A Take nudged earlier still reaches where it ended before.
func takesEnd(takes []Take) float64 {
	var end float64
	for _, t := range takes {
		end = max(end, t.Position+t.Duration+max(0, -t.Nudge))
	}
	return end
}

// placed is a Clip and the Track it's on.
type placed struct {
	trackID int64
	clip    Clip
}

// samePlacement tells whether a Clip is placed as it was: on the same Track,
// at the same place, playing the same stretch of the same source at the
// same Tempo, with the same Fades. Its name, Gain and Pitch don't count.
func (p placed) samePlacement(q placed) bool {
	a, b := p.clip, q.clip
	return p.trackID == q.trackID &&
		a.Start == b.Start && a.Offset == b.Offset && a.Length == b.Length && a.Tempo == b.Tempo &&
		a.FadeIn == b.FadeIn && a.FadeOut == b.FadeOut &&
		sameID(a.BeatID, b.BeatID) && sameID(a.SoundID, b.SoundID) && sameID(a.ActiveTakeID, b.ActiveTakeID) &&
		slices.EqualFunc(a.Takes, b.Takes, func(x, y Take) bool {
			return x.ID == y.ID && x.Position == y.Position && x.Nudge == y.Nudge && x.Duration == y.Duration
		})
}

// sameID tells whether two optional ids are both unset, or both the same.
func sameID(a, b *int64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// overlapsAnother tells whether c overlaps another of the Clips on t by more
// than the tolerance.
func overlapsAnother(t Track, c Clip) bool {
	return slices.ContainsFunc(t.Clips, func(o Clip) bool {
		return o.ID != c.ID && o.Start < c.Start+c.Length-tolerance && o.Start+o.Length > c.Start+tolerance
	})
}
