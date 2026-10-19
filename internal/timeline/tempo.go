package timeline

import (
	"context"
	"fmt"
	"slices"

	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/songversion"
)

// ClipTempo is the Tempo to set on one of several Clips at once, as a
// ratio of as recorded.
type ClipTempo struct {
	ClipID int64   `json:"clipId"`
	Tempo  float64 `json:"tempo"`
}

// SetClipTempos sets how fast each of several Clips plays its audio, in one
// step. Each keeps its start and the stretch of its source it plays, so its
// length scales, and its Fades with it, staying on the same audio. Speeding
// a Clip up always fits. One slowed until it runs into the next Clip on its
// Track moves, keeping its start, onto a new Track right below its own,
// named as a Merge names one; those from one Track that no longer fit share
// such a Track where they fit together, else another goes below it. Clips
// that still fit stay put, counting the room those moving away leave, and
// nothing else moves. If any Tempo can't be
// set, none is.
func (s *Store) SetClipTempos(ctx context.Context, songID int64, based songversion.Version, tempos []ClipTempo) (Timeline, error) {
	if len(tempos) == 0 {
		return Timeline{}, domain.Invalid("clips are required")
	}
	for i, t := range tempos {
		if slices.ContainsFunc(tempos[:i], func(o ClipTempo) bool { return o.ClipID == t.ClipID }) {
			return Timeline{}, domain.Invalid("each Clip's Tempo can only be set once")
		}
		if err := checkTempo(t.Tempo); err != nil {
			return Timeline{}, err
		}
	}
	return s.editTimeline(ctx, songID, based, func(tl Timeline, ids *ids) (Timeline, error) {
		return tl.settingTempos(tempos, ids)
	})
}

// atTempo is c played at another Tempo: from the same start, the same
// stretch of its source, so its length, and its Fades, scale.
func atTempo(c Clip, tempo float64) Clip {
	scale := tempoScale(c.Tempo, tempo)
	c.Tempo = tempo
	c.Length *= scale
	c.setFades(Fades{In: c.FadeIn * scale, Out: c.FadeOut * scale})
	return c
}

// tempoScale is how much a Clip's length scales by, playing the same
// stretch of its source, when its Tempo goes from one to another.
func tempoScale(from, to float64) float64 {
	return from / to
}

// checkTempo checks that a Clip's Tempo is from MinTempo to MaxTempo.
func checkTempo(tempo float64) error {
	if !(tempo >= MinTempo && tempo <= MaxTempo) {
		return domain.Invalid(fmt.Sprintf("a Clip's Tempo goes from %g%% to %g%%", MinTempo*100, MaxTempo*100))
	}
	return nil
}
