package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// renameClip sends a request to give a Clip a name, or clear it with "".
func (ts *testServer) renameClip(songID, clipID int64, name string) response {
	ts.t.Helper()
	return ts.Do(http.MethodPut, clipPath(songID, clipID)+"/name", map[string]any{"name": name})
}

// clipByID finds a Clip on a Timeline.
func clipByID(t *testing.T, tl timeline, clipID int64) clip {
	t.Helper()
	for _, tr := range tl.Tracks {
		for _, c := range tr.Clips {
			if c.ID == clipID {
				return c
			}
		}
	}
	t.Fatalf("clip %d isn't on the Timeline", clipID)
	return clip{}
}

// nameOf is a Clip's name, or "(unnamed)".
func nameOf(c clip) string {
	if c.Name == nil {
		return "(unnamed)"
	}
	return *c.Name
}

func TestAClipIsUnnamedUntilNamed(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	for _, c := range p.tl.Tracks[0].Clips {
		if c.Name != nil {
			t.Errorf("clip = %+v, want it unnamed", c)
		}
	}
}

func TestRenamingAClipNotOnTheSongsTimelineIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	other := ts.createSong("Other")

	expectStatus(t, ts.renameClip(p.song.ID, 999, "Chorus"), http.StatusNotFound)
	expectStatus(t, ts.renameClip(other.ID, p.first, "Chorus"), http.StatusNotFound)
	expectError(t, ts.Do(http.MethodPut, clipPath(p.song.ID, p.first)+"/name", map[string]any{}),
		http.StatusBadRequest, "name is required")
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, p.tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, p.tl)
	}
}
