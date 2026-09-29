package app_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

// Only Lines are cued: a Section has no Cue of its own, and starts where
// its first Line is cued (ADR 0009).

func TestASectionHasNoCueOfItsOwn(t *testing.T) {
	ts := newTestServer(t)
	s := ts.duplicatedChorus()
	drive, _, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, drive, 2)

	res := ts.Do(http.MethodGet, songPath(s.ID), nil)
	expectStatus(t, res, http.StatusOK)
	var raw struct {
		Sections []map[string]json.RawMessage `json:"sections"`
	}
	if err := json.Unmarshal(res.Body, &raw); err != nil {
		t.Fatalf("decoding song: %v", err)
	}
	for i, sec := range raw.Sections {
		if cue, ok := sec["cue"]; ok {
			t.Errorf("section %d has cue %s, want no Cue of its own", i, cue)
		}
	}
}
