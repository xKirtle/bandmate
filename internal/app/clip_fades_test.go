package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// setClipFades sends a request to set a Clip's fade in and fade out, in
// seconds.
func (ts *testServer) setClipFades(songID, clipID int64, fadeIn, fadeOut float64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPut, clipPath(songID, clipID)+"/fades", map[string]any{"fadeIn": fadeIn, "fadeOut": fadeOut})
}

// fadesOf is a Clip's fade in and fade out, in seconds.
func fadesOf(c clip) [2]float64 {
	return [2]float64{c.FadeIn, c.FadeOut}
}

// fadesNear tells whether two Clips' Fades are the same, to a microsecond.
func fadesNear(a, b [2]float64) bool {
	return near(a[0], b[0]) && near(a[1], b[1])
}

func TestAClipHasNoFadesUntilSet(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	for _, c := range p.tl.Tracks[0].Clips {
		if c.FadeIn != 0 || c.FadeOut != 0 {
			t.Errorf("clip = %+v, want no Fades", c)
		}
	}
}

func TestAClipsFadesNeverRunLongerThanTheClip(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	// The first Clip plays 10 seconds: two Fades can meet, but not overlap.
	timelineChange(t, ts.setClipFades(p.song.ID, p.first, 4, 6))
	expectError(t, ts.setClipFades(p.song.ID, p.first, 4, 6.5), http.StatusBadRequest,
		"a Clip's Fades can't together run longer than it")
	expectError(t, ts.setClipFades(p.song.ID, p.first, -1, 0), http.StatusBadRequest,
		"a Fade can't be shorter than nothing")
	expectError(t, ts.Do(http.MethodPut, clipPath(p.song.ID, p.first)+"/fades", map[string]any{"fadeIn": 1}),
		http.StatusBadRequest, "fadeIn and fadeOut are required")
}

func TestATrimCanSetTheFadesBack(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipFades(p.song.ID, p.first, 2, 6))
	timelineChange(t, ts.trimClip(p.song.ID, p.first, 0, 4))

	// As undoing the trim does.
	got := timelineChange(t, ts.Do(http.MethodPost, clipPath(p.song.ID, p.first)+"/trim",
		map[string]any{"offset": 0, "length": 10, "fadeIn": 2, "fadeOut": 6}))

	if f := fadesOf(clipByID(t, got, p.first)); f != [2]float64{2, 6} {
		t.Errorf("fades = %v, want them back at [2 6]", f)
	}
	expectError(t, ts.Do(http.MethodPost, clipPath(p.song.ID, p.first)+"/trim",
		map[string]any{"offset": 0, "length": 4, "fadeIn": 2, "fadeOut": 6}),
		http.StatusBadRequest, "a Clip's Fades can't together run longer than it")
	expectError(t, ts.Do(http.MethodPost, clipPath(p.song.ID, p.first)+"/trim",
		map[string]any{"offset": 0, "length": 10, "fadeIn": 2}),
		http.StatusBadRequest, "fadeIn and fadeOut go together")
}

func TestSettingTheFadesOfAClipNotOnTheSongsTimelineIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	other := ts.createSong("Other")

	expectStatus(t, ts.setClipFades(p.song.ID, 999, 1, 1), http.StatusNotFound)
	expectStatus(t, ts.setClipFades(other.ID, p.first, 1, 1), http.StatusNotFound)
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, p.tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, p.tl)
	}
}
