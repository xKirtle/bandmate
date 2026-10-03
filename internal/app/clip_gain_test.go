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

func TestAClipsGainCanBeSetAndIsSaved(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.setClipGain(p.song.ID, p.first, -4.5))

	if g := clipByID(t, got, p.first).Gain; g != -4.5 {
		t.Errorf("gain = %v, want -4.5", g)
	}
	if g := clipByID(t, got, p.second).Gain; g != 0 {
		t.Errorf("other clip's gain = %v, want 0", g)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
	// Moving and trimming keep it.
	timelineChange(t, ts.moveClip(p.song.ID, p.first, p.tl.Tracks[1].ID, 3))
	got = timelineChange(t, ts.trimClip(p.song.ID, p.first, 1, 4))
	if g := clipByID(t, got, p.first).Gain; g != -4.5 {
		t.Errorf("gain after moving and trimming = %v, want -4.5", g)
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

func TestADuplicateCopiesItsClipsGain(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipGain(p.song.ID, p.first, 6))

	got := timelineChange(t, ts.duplicateClip(p.song.ID, p.first))

	if g := got.Tracks[0].Clips[1].Gain; g != 6 {
		t.Errorf("duplicate's gain = %v, want 6", g)
	}
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

func TestAClipOfTakesKeepsItsGainThroughARetake(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	tl := timelineChange(t, ts.recordTake(s.ID, takeRecording(ts.getTimeline(s.ID).Tracks[0].ID, 0, 0, 0, 3)))
	clipID := tl.Tracks[0].Clips[0].ID

	timelineChange(t, ts.setClipGain(s.ID, clipID, -9))
	got := timelineChange(t, ts.retake(s.ID, clipID, retakeUpload(0, 0, 3)))

	if g := clipByID(t, got, clipID).Gain; g != -9 {
		t.Errorf("gain after a Retake = %v, want -9", g)
	}
}

func TestAMergedClipStartsAtZeroDecibels(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipGain(p.song.ID, p.first, 6))

	got := timelineChange(t, ts.mergeClips(p.song.ID, mergedAudio(50, onTrack(p.tl.Tracks[0].ID), p.first, p.second)))

	if g := got.Tracks[0].Clips[0].Gain; g != 0 {
		t.Errorf("merged clip's gain = %v, want 0", g)
	}
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
