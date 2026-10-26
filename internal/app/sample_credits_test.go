package app_test

import (
	"slices"
	"testing"

	"github.com/xKirtle/bandmate/internal/app"
)

// The Instruments' recorded samples ship in the web app (ADR 0030), and
// About credits them as their licences ask.

func TestAboutCreditsTheInstrumentsSamples(t *testing.T) {
	got := getDependencies(t, func(*app.Config) {})

	for _, name := range []string{"Salamander Grand Piano", "University of Iowa Musical Instrument Samples"} {
		i := slices.IndexFunc(got.Data, func(d dependency) bool { return d.Name == name })
		if i < 0 {
			t.Errorf("data = %+v, want the %s", got.Data, name)
			continue
		}
		if d := got.Data[i]; d.Version == "" || d.License != "CC-BY-3.0" {
			t.Errorf("%s = %+v, want a version and CC-BY-3.0", name, d)
		}
	}
}
