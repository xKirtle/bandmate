package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// A Clip's Tempo is how fast it plays its audio, as a share of as recorded,
// from 50% to 200%. Changing it keeps the Clip's start and the stretch of
// audio it plays, so its length on the Timeline scales, and its Fades with
// it. A Clip slowed until it runs into the next on its Track moves onto a
// new Track right below its own.

// clipTempo is one Clip's Tempo to set, as a ratio.
type clipTempo struct {
	ClipID int64   `json:"clipId"`
	Tempo  float64 `json:"tempo"`
}

// setClipTempos sends a request to set the Tempo of Clips, all at once.
func (ts *testServer) setClipTempos(songID int64, tempos ...clipTempo) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/clips/tempo", map[string]any{"clips": tempos})
}

// setClipTempo sends a request to set one Clip's Tempo.
func (ts *testServer) setClipTempo(songID, clipID int64, tempo float64) response {
	ts.t.Helper()
	return ts.setClipTempos(songID, clipTempo{clipID, tempo})
}

func TestAClipsTempoIs100PercentUntilSet(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	for _, c := range p.tl.Tracks[0].Clips {
		if c.Tempo != 1 {
			t.Errorf("clip = %+v, want it at 100%%", c)
		}
	}
}

func TestSlowingAClipKeepsItsStartAndAudioAndScalesItsLengthAndFades(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.trimClip(p.song.ID, p.second, 2, 16))
	// Long plays 0:32 to 0:48, from 2 s into its Beat.
	timelineChange(t, ts.setClipFades(p.song.ID, p.second, 4, 3))
	s := ts.getSong(p.song.ID)

	got := timelineChange(t, ts.setClipTempo(p.song.ID, p.second, 0.8))

	c := clipByID(t, got, p.second)
	if at := clipAt(got, p.second); at != "0:32+20@2" {
		t.Errorf("clip = %s, want it still from 0:32 and 2 s in, 20 s long to play the same 16 s", at)
	}
	if c.Tempo != 0.8 || c.FadeIn != 5 || c.FadeOut != 3.75 {
		t.Errorf("clip = %+v, want it at 80%% with its Fades 5 s and 3.75 s, on the same audio", c)
	}
	if at := clipAt(got, p.first); at != "0:0+10@0" {
		t.Errorf("other clip = %s, want it where it was", at)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
	after := ts.getSong(p.song.ID)
	if after.Key != s.Key || !reflect.DeepEqual(after.BPM, s.BPM) {
		t.Errorf("song = %+v, want its Key and BPM as they were: %+v", after, s)
	}

	got = timelineChange(t, ts.setClipTempo(p.song.ID, p.second, 2))
	if at := clipAt(got, p.second); at != "0:32+8@2" {
		t.Errorf("clip sped up = %s, want it 8 s long to play the same 16 s", at)
	}
	got = timelineChange(t, ts.setClipTempo(p.song.ID, p.second, 1))
	if at := clipAt(got, p.second); at != "0:32+16@2" {
		t.Errorf("clip back at 100%% = %s, want it as it was", at)
	}
	if c := clipByID(t, got, p.second); c.FadeIn != 4 || c.FadeOut != 3 {
		t.Errorf("clip back at 100%% = %+v, want its Fades as they were", c)
	}
}

func TestAClipPlacedAtATempoOf0IsPlacedAt100Percent(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "tempo": 0, "start": 0, "offset": 0, "length": 10,
	}))

	if c := got.Tracks[1].Clips[0]; c.Tempo != 1 {
		t.Errorf("clip = %+v, want it at 100%%, as a Clip placed with no Tempo", c)
	}
}

func TestAClipsTempoGoesFrom50To200Percent(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	for _, tempo := range []float64{0.5, 2} {
		got := timelineChange(t, ts.setClipTempo(p.song.ID, p.second, tempo))
		if c := clipByID(t, got, p.second); c.Tempo != tempo {
			t.Errorf("tempo = %v, want %v", c.Tempo, tempo)
		}
	}
	for _, tempo := range []float64{0, 0.49, 2.01} {
		expectError(t, ts.setClipTempo(p.song.ID, p.second, tempo), http.StatusBadRequest,
			"a Clip's Tempo goes from 50% to 200%")
	}
	expectError(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/tempo", map[string]any{"clips": []any{}}),
		http.StatusBadRequest, "clips are required")
	expectError(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/tempo", map[string]any{
		"clips": []map[string]any{{"clipId": p.first}},
	}), http.StatusBadRequest, "a Clip's Tempo goes from 50% to 200%")
	expectError(t, ts.setClipTempos(p.song.ID, clipTempo{p.first, 0.8}, clipTempo{p.first, 0.9}),
		http.StatusBadRequest, "each Clip's Tempo can only be set once")
}

// threeOnOneTrack is a Song whose first Track holds the 10-second Beat at
// each of the starts given.
func threeOnOneTrack(t *testing.T, ts *testServer, starts ...float64) (song, []int64) {
	t.Helper()
	s := ts.createSong("Night Drive")
	b := ts.beatOfLength("Short", 10)
	var tl timeline
	for _, at := range starts {
		tl = timelineChange(t, ts.placeClip(s.ID, map[string]any{
			"trackId": ts.getTimeline(s.ID).Tracks[0].ID, "beatId": b.ID, "start": at, "offset": 0, "length": 10,
		}))
	}
	timelineChange(t, ts.addTrack(s.ID, "Adlibs"))
	ids := []int64{}
	for _, c := range tl.Tracks[0].Clips {
		ids = append(ids, c.ID)
	}
	return s, ids
}

func TestSettingTheTempoOfAClipNotOnTheSongsTimelineIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	other := ts.createSong("Other")

	expectStatus(t, ts.setClipTempo(p.song.ID, 999, 0.5), http.StatusNotFound)
	expectStatus(t, ts.setClipTempo(other.ID, p.first, 0.5), http.StatusNotFound)
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, p.tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, p.tl)
	}
}
