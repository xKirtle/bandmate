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

func TestAClipCanBeNamedAndTheNameIsSaved(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.renameClip(p.song.ID, p.first, "  Chorus 1 "))

	if name := nameOf(clipByID(t, got, p.first)); name != "Chorus 1" {
		t.Errorf("name = %q, want it trimmed: %q", name, "Chorus 1")
	}
	if name := nameOf(clipByID(t, got, p.second)); name != "(unnamed)" {
		t.Errorf("other clip's name = %q, want it unnamed", name)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
	// Moving and trimming keep it.
	timelineChange(t, ts.moveClip(p.song.ID, p.first, p.tl.Tracks[1].ID, 3))
	got = timelineChange(t, ts.trimClip(p.song.ID, p.first, 1, 4))
	if name := nameOf(clipByID(t, got, p.first)); name != "Chorus 1" {
		t.Errorf("name after moving and trimming = %q, want %q", name, "Chorus 1")
	}
}

func TestABlankNameClearsAClipsName(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.renameClip(p.song.ID, p.first, "Chorus 1"))

	got := timelineChange(t, ts.renameClip(p.song.ID, p.first, " \t"))

	if c := clipByID(t, got, p.first); c.Name != nil {
		t.Errorf("clip = %+v, want it unnamed again", c)
	}
}

func TestAClipOfTakesKeepsItsNameThroughARetake(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	tl := timelineChange(t, ts.recordTake(s.ID, takeRecording(ts.getTimeline(s.ID).Tracks[0].ID, 0, 0, 0, 3)))
	clipID := tl.Tracks[0].Clips[0].ID

	timelineChange(t, ts.renameClip(s.ID, clipID, "Hook idea"))
	got := timelineChange(t, ts.retake(s.ID, clipID, retakeUpload(0, 0, 3)))

	if name := nameOf(clipByID(t, got, clipID)); name != "Hook idea" {
		t.Errorf("name after a Retake = %q, want %q", name, "Hook idea")
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

func TestADuplicateCopiesItsClipsName(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.renameClip(p.song.ID, p.first, "Chorus 1"))

	got := timelineChange(t, ts.duplicateClip(p.song.ID, p.first))

	if name := nameOf(got.Tracks[0].Clips[1]); name != "Chorus 1" {
		t.Errorf("duplicate's name = %q, want %q", name, "Chorus 1")
	}
}

func TestAClipPlacedBackKeepsItsName(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "name": "Outro", "start": 12.5, "offset": 4, "length": 6,
	}))

	if name := nameOf(got.Tracks[1].Clips[0]); name != "Outro" {
		t.Errorf("name = %q, want %q", name, "Outro")
	}
	got = timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/tracks", map[string]any{
		"name": "Back", "clips": []map[string]any{{"beatId": p.short.ID, "name": "Intro", "start": 0, "offset": 0, "length": 10}},
	}))
	if name := nameOf(got.Tracks[2].Clips[0]); name != "Intro" {
		t.Errorf("name of a Clip on a Track added back = %q, want %q", name, "Intro")
	}
}
