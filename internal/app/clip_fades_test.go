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

func TestAClipsFadesCanBeSetAndAreSaved(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.setClipFades(p.song.ID, p.first, 1.5, 2))

	if f := fadesOf(clipByID(t, got, p.first)); f != [2]float64{1.5, 2} {
		t.Errorf("fades = %v, want [1.5 2]", f)
	}
	if f := fadesOf(clipByID(t, got, p.second)); f != [2]float64{0, 0} {
		t.Errorf("other clip's fades = %v, want none", f)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
	// Setting one back to 0 removes it, and moving the Clip keeps the other.
	timelineChange(t, ts.setClipFades(p.song.ID, p.first, 0, 2))
	got = timelineChange(t, ts.moveClip(p.song.ID, p.first, p.tl.Tracks[1].ID, 3))
	if f := fadesOf(clipByID(t, got, p.first)); f != [2]float64{0, 2} {
		t.Errorf("fades after moving = %v, want [0 2]", f)
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

func TestTrimmingAClipCarriesItsFadesWithItsEdges(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipFades(p.song.ID, p.first, 2, 3))

	got := timelineChange(t, ts.trimClip(p.song.ID, p.first, 1, 7))

	if f := fadesOf(clipByID(t, got, p.first)); f != [2]float64{2, 3} {
		t.Errorf("fades after trimming = %v, want them as they were, [2 3]", f)
	}
}

func TestTrimmingAClipShorterThanItsFadesShortensThemToFit(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipFades(p.song.ID, p.first, 2, 6))

	// 8 seconds of Fades in 4 seconds of Clip: each takes its share.
	got := timelineChange(t, ts.trimClip(p.song.ID, p.first, 0, 4))

	if f := fadesOf(clipByID(t, got, p.first)); !fadesNear(f, [2]float64{1, 3}) {
		t.Errorf("fades = %v, want them shortened to [1 3]", f)
	}
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

func TestADuplicateCopiesItsClipsFades(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipFades(p.song.ID, p.first, 1, 2))

	got := timelineChange(t, ts.duplicateClip(p.song.ID, p.first))

	if f := fadesOf(got.Tracks[0].Clips[1]); f != [2]float64{1, 2} {
		t.Errorf("duplicate's fades = %v, want [1 2]", f)
	}
}

func TestAClipPastedOrPlacedBackKeepsItsFades(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.pasteClips(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.short.ID, "fadeIn": 1, "fadeOut": 0.5, "start": 0, "offset": 0, "length": 5,
	}))
	if f := fadesOf(got.Tracks[1].Clips[0]); f != [2]float64{1, 0.5} {
		t.Errorf("pasted clip's fades = %v, want [1 0.5]", f)
	}
	got = timelineChange(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "fadeOut": 3, "start": 12.5, "offset": 4, "length": 6,
	}))
	if f := fadesOf(got.Tracks[1].Clips[1]); f != [2]float64{0, 3} {
		t.Errorf("placed clip's fades = %v, want [0 3]", f)
	}
	got = timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/tracks", map[string]any{
		"name": "Back", "clips": []map[string]any{{"beatId": p.short.ID, "fadeIn": 2, "start": 0, "offset": 0, "length": 10}},
	}))
	if f := fadesOf(got.Tracks[2].Clips[0]); f != [2]float64{2, 0} {
		t.Errorf("fades of a Clip on a Track added back = %v, want [2 0]", f)
	}
	expectError(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "fadeIn": 4, "fadeOut": 4, "start": 30, "offset": 0, "length": 6,
	}), http.StatusBadRequest, "a Clip's Fades can't together run longer than it")
}

func TestAClipOfTakesKeepsItsFadesThroughARetake(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	tl := timelineChange(t, ts.recordTake(s.ID, takeRecording(ts.getTimeline(s.ID).Tracks[0].ID, 0, 0, 0, 3)))
	clipID := tl.Tracks[0].Clips[0].ID

	timelineChange(t, ts.setClipFades(s.ID, clipID, 0.5, 1))
	got := timelineChange(t, ts.retake(s.ID, clipID, retakeUpload(0, 0, 3)))

	if f := fadesOf(clipByID(t, got, clipID)); f != [2]float64{0.5, 1} {
		t.Errorf("fades after a Retake = %v, want [0.5 1]", f)
	}
}

func TestSettingAClipsTakesCanSetItsFadesBack(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	tl := timelineChange(t, ts.recordTake(s.ID, takeRecording(ts.getTimeline(s.ID).Tracks[0].ID, 0, 0, 0, 3)))
	c := tl.Tracks[0].Clips[0]
	timelineChange(t, ts.setClipFades(s.ID, c.ID, 1, 1))

	// Shorter than its Fades, they shorten to fit; given, they're set.
	short := takesAsIn(c)
	short.Length = 1
	got := timelineChange(t, ts.setTakes(s.ID, c.ID, short))
	if f := fadesOf(clipByID(t, got, c.ID)); !fadesNear(f, [2]float64{0.5, 0.5}) {
		t.Errorf("fades = %v, want them shortened to [0.5 0.5]", f)
	}
	back := takesAsIn(c)
	back.FadeIn, back.FadeOut = ptr(1.0), ptr(1.0)
	got = timelineChange(t, ts.setTakes(s.ID, c.ID, back))
	if f := fadesOf(clipByID(t, got, c.ID)); f != [2]float64{1, 1} {
		t.Errorf("fades = %v, want them back at [1 1]", f)
	}
	back.FadeOut = nil
	expectError(t, ts.setTakes(s.ID, c.ID, back), http.StatusBadRequest, "fadeIn and fadeOut go together")
}

func TestAMergedClipStartsWithNoFades(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipFades(p.song.ID, p.first, 1, 2))

	got := timelineChange(t, ts.mergeClips(p.song.ID, mergedAudio(50, onTrack(p.tl.Tracks[0].ID), p.first, p.second)))

	if f := fadesOf(got.Tracks[0].Clips[0]); f != [2]float64{0, 0} {
		t.Errorf("merged clip's fades = %v, want none", f)
	}
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
