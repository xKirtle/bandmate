package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// A Clip's Pitch is how many semitones its audio is moved up or down, from
// −12 to +12, without changing its Tempo. It never changes the Clip's
// length, nor anything else about it.

// clipPitch is one Clip's Pitch to set, in semitones.
type clipPitch struct {
	ClipID int64   `json:"clipId"`
	Pitch  float64 `json:"pitch"`
}

// setClipPitches sends a request to set the Pitch of Clips, all at once.
func (ts *testServer) setClipPitches(songID int64, pitches ...clipPitch) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/clips/pitch", map[string]any{"clips": pitches})
}

// setClipPitch sends a request to set one Clip's Pitch.
func (ts *testServer) setClipPitch(songID, clipID int64, pitch float64) response {
	ts.t.Helper()
	return ts.setClipPitches(songID, clipPitch{clipID, pitch})
}

func TestAClipsPitchIs0UntilSet(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	for _, c := range p.tl.Tracks[0].Clips {
		if c.Pitch != 0 {
			t.Errorf("clip = %+v, want it at 0 semitones", c)
		}
	}
}

func TestMovingAClipsPitchKeepsItsPlaceLengthTempoAndFades(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.trimClip(p.song.ID, p.second, 2, 16))
	timelineChange(t, ts.setClipFades(p.song.ID, p.second, 4, 3))
	timelineChange(t, ts.setClipTempo(p.song.ID, p.second, 0.8))
	song := ts.getSong(p.song.ID)

	got := timelineChange(t, ts.setClipPitch(p.song.ID, p.second, -2))

	c := clipByID(t, got, p.second)
	if at := clipAt(got, p.second); at != "0:32+20@2" {
		t.Errorf("clip = %s, want it where and as long as it was", at)
	}
	if c.Pitch != -2 || c.Tempo != 0.8 || c.FadeIn != 5 || c.FadeOut != 3.75 {
		t.Errorf("clip = %+v, want it 2 semitones down, still at 80%% with its Fades as they were", c)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
	after := ts.getSong(p.song.ID)
	if after.Key != song.Key || !reflect.DeepEqual(after.BPM, song.BPM) {
		t.Errorf("song = %+v, want its Key and BPM as they were: %+v", after, song)
	}

	// The Tempo can still change on its own.
	got = timelineChange(t, ts.setClipTempo(p.song.ID, p.second, 1))
	if c := clipByID(t, got, p.second); c.Pitch != -2 || clipAt(got, p.second) != "0:32+16@2" {
		t.Errorf("clip back at 100%% = %+v, want it 16 s long, still 2 semitones down", c)
	}
	got = timelineChange(t, ts.setClipPitch(p.song.ID, p.second, 0))
	if c := clipByID(t, got, p.second); c.Pitch != 0 {
		t.Errorf("clip reset = %+v, want it at 0 semitones", c)
	}
}

func TestAClipsPitchIsAWholeNumberOfSemitonesFromMinus12To12(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	for _, pitch := range []float64{-12, 12, 3} {
		got := timelineChange(t, ts.setClipPitch(p.song.ID, p.second, pitch))
		if c := clipByID(t, got, p.second); c.Pitch != pitch {
			t.Errorf("pitch = %v, want %v", c.Pitch, pitch)
		}
	}
	for _, pitch := range []float64{-13, 13, 1.5} {
		expectError(t, ts.setClipPitch(p.song.ID, p.second, pitch), http.StatusBadRequest,
			"a Clip's Pitch is a whole number of semitones from -12 to +12")
	}
	expectError(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/pitch", map[string]any{"clips": []any{}}),
		http.StatusBadRequest, "clips are required")
	expectError(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/pitch", map[string]any{
		"clips": []map[string]any{{"clipId": p.first}},
	}), http.StatusBadRequest, "each Clip's pitch is required")
	expectError(t, ts.setClipPitches(p.song.ID, clipPitch{p.first, 1}, clipPitch{p.first, 2}),
		http.StatusBadRequest, "each Clip's Pitch can only be set once")
}

func TestSettingThePitchOfSeveralClipsIsOneChange(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.setClipPitches(p.song.ID, clipPitch{p.first, -2}, clipPitch{p.second, 5}))

	if a, b := clipByID(t, got, p.first), clipByID(t, got, p.second); a.Pitch != -2 || b.Pitch != 5 {
		t.Errorf("clips = %+v and %+v, want them at -2 and +5 semitones", a, b)
	}
	// If one can't be set, none is.
	expectStatus(t, ts.setClipPitches(p.song.ID, clipPitch{p.first, 0}, clipPitch{999, 0}), http.StatusNotFound)
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, got)
	}
}

func TestSplitDuplicatePasteAndPlacingBackKeepAPitch(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipPitch(p.song.ID, p.first, -3))

	got := timelineChange(t, ts.splitClips(p.song.ID, 5, p.first))
	left, right := got.Tracks[0].Clips[0], got.Tracks[0].Clips[1]
	if left.Pitch != -3 || right.Pitch != -3 {
		t.Errorf("halves = %+v and %+v, want both 3 semitones down", left, right)
	}

	got = timelineChange(t, ts.duplicateClip(p.song.ID, right.ID))
	if c := got.Tracks[0].Clips[2]; c.Pitch != -3 {
		t.Errorf("duplicate = %+v, want it 3 semitones down", c)
	}

	got = timelineChange(t, ts.pasteClips(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.short.ID, "pitch": 7, "start": 0, "offset": 0, "length": 10,
	}))
	if c := got.Tracks[1].Clips[0]; c.Pitch != 7 {
		t.Errorf("pasted clip = %+v, want it 7 semitones up", c)
	}
	got = timelineChange(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "pitch": -12, "start": 30, "offset": 0, "length": 10,
	}))
	if c := got.Tracks[1].Clips[1]; c.Pitch != -12 {
		t.Errorf("placed clip = %+v, want it 12 semitones down", c)
	}
	expectError(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "pitch": 13, "start": 50, "offset": 0, "length": 5,
	}), http.StatusBadRequest, "a Clip's Pitch is a whole number of semitones from -12 to +12")
}

func TestAMergedClipStartsAt0Semitones(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipPitch(p.song.ID, p.first, 4))

	got := timelineChange(t, ts.mergeClips(p.song.ID, mergedAudio(50, onTrack(p.tl.Tracks[0].ID), p.first, p.second)))

	if c := got.Tracks[0].Clips[0]; c.Pitch != 0 {
		t.Errorf("merged clip = %+v, want it at 0 semitones", c)
	}
}

func TestAClipOfTakesCanOnlyBeRetakenAt0Semitones(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	tl := timelineChange(t, ts.recordTake(s.ID, takeRecording(ts.getTimeline(s.ID).Tracks[0].ID, 0, 0, 0, 3)))
	clipID := tl.Tracks[0].Clips[0].ID

	timelineChange(t, ts.setClipPitch(s.ID, clipID, -1))
	expectError(t, ts.retake(s.ID, clipID, retakeUpload(0, 0, 3)), http.StatusBadRequest,
		"set the Clip's Pitch back to 0 to retake it")

	timelineChange(t, ts.setClipPitch(s.ID, clipID, 0))
	timelineChange(t, ts.retake(s.ID, clipID, retakeUpload(0, 0, 3)))
}

func TestSettingThePitchOfAClipNotOnTheSongsTimelineIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	other := ts.createSong("Other")

	expectStatus(t, ts.setClipPitch(p.song.ID, 999, 2), http.StatusNotFound)
	expectStatus(t, ts.setClipPitch(other.ID, p.first, 2), http.StatusNotFound)
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, p.tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, p.tl)
	}
}
