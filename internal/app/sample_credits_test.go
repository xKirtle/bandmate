package app_test

import (
	"slices"
	"testing"

	"github.com/xKirtle/bandmate/internal/app"
)

// The Instruments' recorded samples ship in the web app (ADR 0030), and
// About credits them as their licences ask.

func TestAboutCreditsThePianosSamples(t *testing.T) {
	got := getDependencies(t, func(*app.Config) {})

	i := slices.IndexFunc(got.Data, func(d dependency) bool { return d.Name == "Salamander Grand Piano" })
	if i < 0 {
		t.Fatalf("data = %+v, want the Salamander Grand Piano", got.Data)
	}
	if d := got.Data[i]; d.Version == "" || d.License != "CC-BY-3.0" {
		t.Errorf("Salamander Grand Piano = %+v, want a version and CC-BY-3.0", d)
	}
}
