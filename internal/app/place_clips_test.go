package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// placeClips sends a request to place several Clips at once, each a Track
// id and what placeClip takes.
func (ts *testServer) placeClips(songID int64, clips ...map[string]any) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/clips/place", map[string]any{"clips": clips})
}

func TestClipsDeletedTogetherCanBePlacedBackTogether(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	tl := timelineChange(t, ts.importSound(r.song.ID, soundFile("hum.m4a", "Hum", r.tl.Tracks[0].ID, 8)))
	hum := tl.Tracks[0].Clips[1]
	gone := timelineChange(t, ts.deleteClips(r.song.ID, r.clip.ID, hum.ID))

	got := timelineChange(t, ts.placeClips(r.song.ID,
		map[string]any{"trackId": r.vox.ID, "takeIds": []int64{r.take.ID}, "activeTakeId": r.take.ID,
			"start": 2, "offset": 0.5, "length": 3},
		map[string]any{"trackId": tl.Tracks[0].ID, "soundId": *hum.SoundID, "name": "Hook",
			"start": hum.Start, "offset": 0, "length": hum.Length}))

	vox := got.Tracks[1].Clips
	if len(vox) != 1 || !reflect.DeepEqual(vox[0].Takes, []take{r.take}) || vox[0].Start != 2 ||
		vox[0].Offset != 0.5 || vox[0].Length != 3 {
		t.Errorf("vox clips = %+v, want the Take back at 0:02", vox)
	}
	back := got.Tracks[0].Clips
	if len(back) != 2 || back[1].SoundID == nil || *back[1].SoundID != *hum.SoundID || nameOf(back[1]) != "Hook" ||
		back[1].Start != hum.Start {
		t.Errorf("beat track clips = %+v, want the Sound's Clip back after the Beat", back)
	}
	if got.Version != gone.Version+1 {
		t.Errorf("version = %d, want one more than %d", got.Version, gone.Version)
	}
	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
}

func TestAPlacingOfSeveralClipsIsRefusedWhole(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	beatTrack, adlibs := p.tl.Tracks[0].ID, p.tl.Tracks[1].ID
	before := ts.getTimeline(p.song.ID)
	short := func(trackID int64, start float64) map[string]any {
		return map[string]any{"trackId": trackID, "beatId": p.short.ID, "start": start, "offset": 0, "length": 10}
	}

	for name, c := range map[string]struct {
		clips  []map[string]any
		status int
		msg    string
	}{
		"onto a Clip there": {
			[]map[string]any{short(adlibs, 0), short(beatTrack, 5)}, http.StatusConflict, "Clips can't overlap on a Track"},
		"onto each other": {
			[]map[string]any{short(adlibs, 0), short(adlibs, 5)}, http.StatusConflict, "Clips can't overlap on a Track"},
		"before 0:00": {
			[]map[string]any{short(adlibs, 0), short(beatTrack, -1)}, http.StatusBadRequest, "a Clip can't start before 0:00"},
		"without a Track": {
			[]map[string]any{short(adlibs, 0), {"beatId": p.short.ID, "start": 60, "offset": 0, "length": 10}},
			http.StatusBadRequest, "trackId or newTrack, start, offset and length are required"},
		"no Clips": {[]map[string]any{}, http.StatusBadRequest, "clips are required"},
		"onto a new Track not added": {[]map[string]any{{"newTrack": 0, "beatId": p.short.ID, "start": 60,
			"offset": 0, "length": 10}}, http.StatusBadRequest, "there's no such new Track"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.placeClips(p.song.ID, c.clips...), c.status, c.msg)
			if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
}
