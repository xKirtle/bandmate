package app_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// Only Lines are cued: an Occurrence has no Cue of its own, and starts where
// its first Line is cued (ADR 0009).

// cuePath is where an Occurrence's own Cue used to live.
func cuePath(songID, occurrenceID int64) string {
	return fmt.Sprintf("/api/songs/%d/occurrences/%d/cue", songID, occurrenceID)
}

func TestAnOccurrenceHasNoCueOfItsOwn(t *testing.T) {
	ts := newTestServer(t)
	s := ts.repeatedChorus()
	drive, _, _, _ := chorusLines(s)
	ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 2)

	res := ts.Do(http.MethodGet, songPath(s.ID), nil)
	expectStatus(t, res, http.StatusOK)
	var raw struct {
		Arrangement []map[string]json.RawMessage `json:"arrangement"`
	}
	if err := json.Unmarshal(res.Body, &raw); err != nil {
		t.Fatalf("decoding song: %v", err)
	}
	for i, o := range raw.Arrangement {
		if cue, ok := o["cue"]; ok {
			t.Errorf("occurrence %d has cue %s, want no Cue of its own", i, cue)
		}
	}
}

func TestAnOccurrenceCantBeCuedOrClearedOnItsOwn(t *testing.T) {
	ts := newTestServer(t)
	s := ts.repeatedChorus()
	drive, _, _, _ := chorusLines(s)
	before := ts.setLineCue(s.ID, s.Arrangement[0].ID, drive, 2)

	for _, res := range []response{
		ts.Do(http.MethodPut, cuePath(s.ID, s.Arrangement[0].ID), map[string]any{"cue": 5}),
		ts.Do(http.MethodDelete, cuePath(s.ID, s.Arrangement[0].ID), nil),
	} {
		if res.Status < 400 {
			t.Errorf("status = %d, want the request refused", res.Status)
		}
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, before)
	}
}
