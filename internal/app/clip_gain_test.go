package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// setClipGain sends a request to set a Clip's Gain, in dB.
func (ts *testServer) setClipGain(songID, clipID int64, gain float64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPut, clipPath(songID, clipID)+"/gain", map[string]any{"gain": gain})
}

func TestAClipsGainIsZeroUntilSet(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	for _, c := range p.tl.Tracks[0].Clips {
		if c.Gain != 0 {
			t.Errorf("clip = %+v, want it at 0 dB", c)
		}
	}
}

func TestAClipsGainGoesFromMinus36ToPlus36(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	for _, gain := range []float64{-36, 36} {
		got := timelineChange(t, ts.setClipGain(p.song.ID, p.first, gain))
		if g := clipByID(t, got, p.first).Gain; g != gain {
			t.Errorf("gain = %v, want %v", g, gain)
		}
	}
	for _, gain := range []float64{-36.5, 36.1} {
		expectError(t, ts.setClipGain(p.song.ID, p.first, gain), http.StatusBadRequest,
			"a Clip's Gain goes from -36 dB to +36 dB")
	}
	expectError(t, ts.Do(http.MethodPut, clipPath(p.song.ID, p.first)+"/gain", map[string]any{}),
		http.StatusBadRequest, "gain is required")
}

func TestAClipPastedOrPlacedBackKeepsItsGain(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.pasteClips(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.short.ID, "gain": -3, "start": 0, "offset": 0, "length": 5,
	}))
	if g := got.Tracks[1].Clips[0].Gain; g != -3 {
		t.Errorf("pasted clip's gain = %v, want -3", g)
	}
	got = timelineChange(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "gain": 2.5, "start": 12.5, "offset": 4, "length": 6,
	}))
	if g := got.Tracks[1].Clips[1].Gain; g != 2.5 {
		t.Errorf("placed clip's gain = %v, want 2.5", g)
	}
	got = timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/tracks", map[string]any{
		"name": "Back", "clips": []map[string]any{{"beatId": p.short.ID, "gain": 1, "start": 0, "offset": 0, "length": 10}},
	}))
	if g := got.Tracks[2].Clips[0].Gain; g != 1 {
		t.Errorf("gain of a Clip on a Track added back = %v, want 1", g)
	}
	expectError(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "gain": 40, "start": 30, "offset": 0, "length": 6,
	}), http.StatusBadRequest, "a Clip's Gain goes from -36 dB to +36 dB")
}

func TestSettingTheGainOfAClipNotOnTheSongsTimelineIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	other := ts.createSong("Other")

	expectStatus(t, ts.setClipGain(p.song.ID, 999, 3), http.StatusNotFound)
	expectStatus(t, ts.setClipGain(other.ID, p.first, 3), http.StatusNotFound)
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, p.tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, p.tl)
	}
}
