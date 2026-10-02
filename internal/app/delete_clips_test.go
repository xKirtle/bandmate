package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// deleteClips sends a request to delete several Clips at once.
func (ts *testServer) deleteClips(songID int64, clipIDs ...int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/clips/delete", map[string]any{"clipIds": clipIDs})
}

func TestSeveralClipsCanBeDeletedAtOnce(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	tl := timelineChange(t, ts.duplicateClip(p.song.ID, p.first))

	got := timelineChange(t, ts.deleteClips(p.song.ID, p.first, p.second))

	if want := []string{fmt.Sprintf("%d@10+10", p.short.ID)}; !reflect.DeepEqual(clipsOf(got, 0), want) {
		t.Errorf("clips = %q, want only the copy left: %q", clipsOf(got, 0), want)
	}
	if got.Version != tl.Version+1 {
		t.Errorf("version = %d, want one more than %d", got.Version, tl.Version)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
}

func TestADeleteOfSeveralClipsIsRefusedWhole(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	other := ts.createSong("Other")
	theirs := timelineChange(t, ts.addBeatToSong(other.ID, p.short.ID))
	before := ts.getTimeline(p.song.ID)

	for name, c := range map[string]struct {
		ids    []int64
		status int
		msg    string
	}{
		"the same Clip twice": {[]int64{p.first, p.first}, http.StatusBadRequest, "each Clip can only be deleted once"},
		"no Clips":            {[]int64{}, http.StatusBadRequest, "clipIds are required"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.deleteClips(p.song.ID, c.ids...), c.status, c.msg)
			if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
			}
		})
	}

	t.Run("another Song's Clip", func(t *testing.T) {
		expectStatus(t, ts.deleteClips(p.song.ID, p.first, theirs.Tracks[0].Clips[0].ID), http.StatusNotFound)
		if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
			t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
		}
		if read := ts.getTimeline(other.ID); !reflect.DeepEqual(read, theirs) {
			t.Errorf("other Song's timeline = %+v, want it unchanged: %+v", read, theirs)
		}
	})
}

func TestClipsDeletedTogetherDetachTheirTakesAndKeepTheirSounds(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	tl := timelineChange(t, ts.importSound(r.song.ID, soundFile("hum.m4a", "Hum", r.tl.Tracks[0].ID, 8)))
	hum := tl.Tracks[0].Clips[1]

	got := timelineChange(t, ts.deleteClips(r.song.ID, r.clip.ID, hum.ID))

	if len(got.Tracks[0].Clips) != 1 || len(got.Tracks[1].Clips) != 0 {
		t.Fatalf("tracks = %+v, want only the Beat's Clip left", got.Tracks)
	}
	expectStatus(t, ts.Do(http.MethodGet, takePath(r.song.ID, r.take.ID), nil), http.StatusOK)
	expectStatus(t, ts.Do(http.MethodGet, soundPath(r.song.ID, *hum.SoundID), nil), http.StatusOK)
	// Each can be placed back as it was, as undo does.
	timelineChange(t, ts.placeTakes(r.song.ID, r.vox.ID, []int64{r.take.ID}, r.take.ID, 2, 0.5, 3))
	timelineChange(t, ts.placeBack(r.song.ID, tl.Tracks[0].ID, hum))
}

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
			http.StatusBadRequest, "trackId, start, offset and length are required"},
		"no Clips": {[]map[string]any{}, http.StatusBadRequest, "clips are required"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.placeClips(p.song.ID, c.clips...), c.status, c.msg)
			if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
}
