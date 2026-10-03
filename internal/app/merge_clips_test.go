package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// Merging Clips on one Track renders them, in the browser, into one WAV,
// which becomes a new Sound of the Song, "Merged Clip", in a Clip that
// replaces them. Undo and redo replace one set of Clips with the other.

// mergedAudio is the WAV the browser renders for a Merge spanning seconds:
// stereo and 24-bit, as a Mixdown's.
func mergedAudio(seconds float64, clipIDs ...int64) audioUpload {
	return audioUpload{
		FileName:    "merged.wav",
		ContentType: "audio/wav",
		Data:        wavFile(seconds, 2, 24),
		Details:     map[string]any{"clipIds": clipIDs, "peaks": []float64{0.5, 1, 0.25}},
	}
}

// mergeClips sends a request to merge Clips into one.
func (ts *testServer) mergeClips(songID int64, u audioUpload) response {
	ts.t.Helper()
	return ts.SendUpload(http.MethodPost, timelinePath(songID)+"/clips/merge", u)
}

// replaceClips sends a request to delete Clips and place others in one step.
func (ts *testServer) replaceClips(songID int64, clipIDs []int64, clips ...map[string]any) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/clips/replace", map[string]any{"clipIds": clipIDs, "clips": clips})
}

func TestMergingClipsOnATrackMakesOneClipOfANewSound(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	// Short plays 0:00 to 0:10 and Long 0:30 to 0:50, with a gap between.
	got := timelineChange(t, ts.mergeClips(p.song.ID, mergedAudio(50, p.first, p.second)))

	clips := got.Tracks[0].Clips
	if len(clips) != 1 || clips[0].SoundID == nil {
		t.Fatalf("clips = %+v, want one Clip of a Sound in their place", clips)
	}
	c := clips[0]
	if c.ID == p.first || c.ID == p.second || c.Start != 0 || c.Offset != 0 || c.Length != 50 || c.Name != nil {
		t.Errorf("clip = %+v, want a new, unnamed Clip from the first's start to the last's end", c)
	}
	want := []sound{{ID: *c.SoundID, Name: "Merged Clip", FileName: "Merged Clip.wav",
		Size: int64(len(wavFile(50, 2, 24))), Duration: 50}}
	if !reflect.DeepEqual(got.Sounds, want) {
		t.Errorf("sounds = %+v, want %+v", got.Sounds, want)
	}
	if got.Version != p.tl.Version+1 {
		t.Errorf("version = %d, want one more than %d", got.Version, p.tl.Version)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}

	served := ts.Do(http.MethodGet, soundPath(p.song.ID, *c.SoundID)+"/audio", nil)
	expectStatus(t, served, http.StatusOK)
	if got := served.Header.Get("Content-Type"); got != "audio/wav" {
		t.Errorf("Content-Type = %q, want audio/wav", got)
	}
	var read sound
	res := ts.Do(http.MethodGet, soundPath(p.song.ID, *c.SoundID), nil)
	res.JSON(t, &read)
	if !reflect.DeepEqual(read.Peaks, []float64{0.5, 1, 0.25}) {
		t.Errorf("peaks = %v, want those sent", read.Peaks)
	}
}

func TestMergingAClipOfTakesDetachesItsTakes(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	// A Beat after the Take's Clip, which ends at 0:05.
	tl := timelineChange(t, ts.addBeatToTrack(r.song.ID, r.vox.ID, r.tl.Beats[0].ID))
	beat := tl.Tracks[1].Clips[1]

	got := timelineChange(t, ts.mergeClips(r.song.ID, mergedAudio(33, beat.ID, r.clip.ID)))

	vox := got.Tracks[1].Clips
	if len(vox) != 1 || vox[0].SoundID == nil || vox[0].Start != 2 || vox[0].Length != 33 || len(vox[0].Takes) != 0 {
		t.Fatalf("vox clips = %+v, want one Clip of a Sound from 0:02 to 0:35", vox)
	}
	if len(got.Tracks[0].Clips) != 1 {
		t.Errorf("Beat track = %+v, want it untouched", got.Tracks[0])
	}
	// Its Take is only detached, as a deleted Clip's is, to come back by undo.
	expectStatus(t, ts.Do(http.MethodGet, takePath(r.song.ID, r.take.ID), nil), http.StatusOK)
}

func TestAMergeIsRefusedWholeAndKeepsNothing(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	onAdlibs := timelineChange(t, ts.addBeatToTrack(p.song.ID, p.tl.Tracks[1].ID, p.short.ID)).Tracks[1].Clips[0]
	other := ts.createSong("Other")
	theirs := timelineChange(t, ts.addBeatToSong(other.ID, p.short.ID)).Tracks[0].Clips[0]
	before := ts.getTimeline(p.song.ID)
	notWAV := mergedAudio(50, p.first, p.second)
	notWAV.Data = []byte("not a WAV")
	mono16 := mergedAudio(50, p.first, p.second)
	mono16.Data = wavFile(50, 1, 16)

	for name, c := range map[string]struct {
		upload audioUpload
		status int
		msg    string
	}{
		"one Clip": {mergedAudio(10, p.first), http.StatusBadRequest, "merge two or more Clips"},
		"the same Clip twice": {mergedAudio(10, p.first, p.first), http.StatusBadRequest,
			"each Clip can only be merged once"},
		"Clips on several Tracks": {mergedAudio(50, p.first, p.second, onAdlibs.ID), http.StatusBadRequest,
			"Clips merged must be on one Track"},
		"another Song's Clip": {mergedAudio(50, p.first, theirs.ID), http.StatusNotFound, "not found"},
		"audio that isn't a WAV": {notWAV, http.StatusBadRequest,
			"a merged Clip's audio must be a 24-bit WAV file"},
		"audio that isn't 24-bit": {mono16, http.StatusBadRequest,
			"a merged Clip's audio must be a 24-bit WAV file"},
		"audio shorter than the Clips": {mergedAudio(49, p.first, p.second), http.StatusBadRequest,
			"the merged audio must last as long as the Clips merged"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.mergeClips(p.song.ID, c.upload), c.status, c.msg)
			if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
			}
			if files := soundFiles(t, ts); len(files) != 0 {
				t.Errorf("sound files = %q, want none kept", files)
			}
		})
	}

	t.Run("based on an old version", func(t *testing.T) {
		res := ts.SendUploadAt(before.Version-1, http.MethodPost, timelinePath(p.song.ID)+"/clips/merge",
			mergedAudio(50, p.first, p.second))
		expectStatus(t, res, http.StatusConflict)
		if files := soundFiles(t, ts); len(files) != 0 {
			t.Errorf("sound files = %q, want none kept", files)
		}
	})
}

func TestAMergeIsUndoneAndRedoneByReplacingClips(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	tl := timelineChange(t, ts.addBeatToTrack(r.song.ID, r.vox.ID, r.tl.Beats[0].ID))
	beat := tl.Tracks[1].Clips[1]
	merged := timelineChange(t, ts.mergeClips(r.song.ID, mergedAudio(33, r.clip.ID, beat.ID))).Tracks[1].Clips[0]

	// Undo: the merged Clip out, the originals back, each as it was.
	undone := timelineChange(t, ts.replaceClips(r.song.ID, []int64{merged.ID},
		map[string]any{"trackId": r.vox.ID, "takeIds": []int64{r.take.ID}, "activeTakeId": r.take.ID,
			"start": 2, "offset": 0.5, "length": 3},
		map[string]any{"trackId": r.vox.ID, "beatId": beat.BeatID, "start": beat.Start, "offset": 0, "length": beat.Length}))

	vox := undone.Tracks[1].Clips
	if len(vox) != 2 || !reflect.DeepEqual(vox[0].Takes, []take{r.take}) || vox[0].Start != 2 ||
		vox[1].BeatID != beat.BeatID || vox[1].Start != beat.Start {
		t.Fatalf("vox clips = %+v, want the Take's Clip and the Beat's back", vox)
	}
	if len(undone.Sounds) != 0 {
		t.Errorf("sounds = %+v, want the merged Sound no longer used", undone.Sounds)
	}

	// Redo: the originals out, the merged Sound's Clip back.
	redone := timelineChange(t, ts.replaceClips(r.song.ID, []int64{vox[0].ID, vox[1].ID},
		map[string]any{"trackId": r.vox.ID, "soundId": *merged.SoundID, "start": 2, "offset": 0, "length": 33}))

	if c := redone.Tracks[1].Clips; len(c) != 1 || *c[0].SoundID != *merged.SoundID || c[0].Start != 2 {
		t.Errorf("vox clips = %+v, want the merged Clip back", c)
	}
	expectStatus(t, ts.Do(http.MethodGet, takePath(r.song.ID, r.take.ID), nil), http.StatusOK)
}

func TestAReplaceOfClipsIsRefusedWhole(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	before := ts.getTimeline(p.song.ID)

	for name, c := range map[string]struct {
		res    response
		status int
		msg    string
	}{
		"onto a Clip left there": {ts.replaceClips(p.song.ID, []int64{p.first},
			map[string]any{"trackId": before.Tracks[0].ID, "beatId": p.long.ID, "start": 25, "offset": 0, "length": 10}),
			http.StatusConflict, "Clips can't overlap on a Track"},
		"nothing to delete": {ts.replaceClips(p.song.ID, []int64{},
			map[string]any{"trackId": before.Tracks[1].ID, "beatId": p.long.ID, "start": 0, "offset": 0, "length": 10}),
			http.StatusBadRequest, "clipIds are required"},
		"nothing to place": {ts.replaceClips(p.song.ID, []int64{p.first}),
			http.StatusBadRequest, "clips are required"},
		"on a new Track": {ts.replaceClips(p.song.ID, []int64{p.first},
			map[string]any{"newTrack": 0, "beatId": p.long.ID, "start": 0, "offset": 0, "length": 10}),
			http.StatusBadRequest, "there's no such new Track"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, c.res, c.status, c.msg)
			if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
}
