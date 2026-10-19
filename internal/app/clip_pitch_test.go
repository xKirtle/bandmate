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
