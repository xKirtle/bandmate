package app_test

import (
	"fmt"
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
	song := ts.getSong(p.song.ID)

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
	if after.Key != song.Key || !reflect.DeepEqual(after.BPM, song.BPM) {
		t.Errorf("song = %+v, want its Key and BPM as they were: %+v", after, song)
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

func TestSettingTheTempoOfSeveralClipsIsOneChange(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.setClipTempos(p.song.ID, clipTempo{p.first, 0.5}, clipTempo{p.second, 2}))

	if a, b := clipAt(got, p.first), clipAt(got, p.second); a != "0:0+20@0" || b != "0:30+10@0" {
		t.Errorf("clips = %s and %s, want the first slowed to 20 s and the second sped up to 10 s", a, b)
	}
	// If one can't be set, none is.
	expectStatus(t, ts.setClipTempos(p.song.ID, clipTempo{p.first, 1}, clipTempo{999, 1}), http.StatusNotFound)
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, got)
	}
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

func TestAClipSlowedIntoTheNextMovesOntoANewTrackBelowItsOwn(t *testing.T) {
	ts := newTestServer(t)
	s, ids := threeOnOneTrack(t, ts, 0, 15)

	got := timelineChange(t, ts.setClipTempo(s.ID, ids[0], 0.5))

	if want := []string{"Track 1", "Track 3", "Adlibs"}; !reflect.DeepEqual(trackNames(got), want) {
		t.Fatalf("tracks = %q, want a new Track right below Track 1, named as a Merge names one", trackNames(got))
	}
	if at := clipAt(got, ids[0]); at != "1:0+20@0" {
		t.Errorf("slowed clip = %s, want it on the new Track, from where it started", at)
	}
	if at := clipAt(got, ids[1]); at != "0:15+10@0" {
		t.Errorf("next clip = %s, want it where it was", at)
	}
	// One that still fits stays put.
	got = timelineChange(t, ts.setClipTempo(s.ID, ids[1], 0.5))
	if at := clipAt(got, ids[1]); at != "0:15+20@0" {
		t.Errorf("clip with room = %s, want it where it was", at)
	}
}

func TestSlowedClipsFromOneTrackShareANewTrackWhereTheyFit(t *testing.T) {
	ts := newTestServer(t)
	s, ids := threeOnOneTrack(t, ts, 0, 11, 30, 41)

	got := timelineChange(t, ts.setClipTempos(s.ID, clipTempo{ids[0], 0.5}, clipTempo{ids[2], 0.5}))

	if want := []string{"Track 1", "Track 3", "Adlibs"}; !reflect.DeepEqual(trackNames(got), want) {
		t.Fatalf("tracks = %q, want one new Track for both", trackNames(got))
	}
	if a, b := clipAt(got, ids[0]), clipAt(got, ids[2]); a != "1:0+20@0" || b != "1:30+20@0" {
		t.Errorf("slowed clips = %s and %s, want both on the new Track", a, b)
	}
	if a, b := clipAt(got, ids[1]), clipAt(got, ids[3]); a != "0:11+10@0" || b != "0:41+10@0" {
		t.Errorf("other clips = %s and %s, want them where they were", a, b)
	}
}

func TestSlowedClipsThatDontFitTogetherGetANewTrackEach(t *testing.T) {
	ts := newTestServer(t)
	s, ids := threeOnOneTrack(t, ts, 0, 12, 22)
	// A 2-second Clip between the first two.
	b := ts.getTimeline(s.ID).Beats[0]
	tl := timelineChange(t, ts.placeClip(s.ID, map[string]any{
		"trackId": ts.getTimeline(s.ID).Tracks[0].ID, "beatId": b.ID, "start": 10, "offset": 0, "length": 2,
	}))
	short := tl.Tracks[0].Clips[1].ID

	got := timelineChange(t, ts.setClipTempos(s.ID, clipTempo{ids[0], 0.5}, clipTempo{ids[1], 0.5}))

	if want := []string{"Track 1", "Track 3", "Track 4", "Adlibs"}; !reflect.DeepEqual(trackNames(got), want) {
		t.Fatalf("tracks = %q, want two new Tracks below Track 1, in order", trackNames(got))
	}
	if a, b := clipAt(got, ids[0]), clipAt(got, ids[1]); a != "1:0+20@0" || b != "2:12+20@0" {
		t.Errorf("slowed clips = %s and %s, want one on each new Track", a, b)
	}
	if a, b := clipAt(got, short), clipAt(got, ids[2]); a != "0:10+2@0" || b != "0:22+10@0" {
		t.Errorf("other clips = %s and %s, want them where they were", a, b)
	}
}

func TestASlowedClipFitsWhereTheNextOneMovedAwayFrom(t *testing.T) {
	ts := newTestServer(t)
	s, ids := threeOnOneTrack(t, ts, 0, 10, 20)

	got := timelineChange(t, ts.setClipTempos(s.ID, clipTempo{ids[0], 0.5}, clipTempo{ids[1], 0.5}))

	if at := clipAt(got, ids[1]); at != "1:10+20@0" {
		t.Errorf("second clip = %s, want it on a new Track, as it runs into the third", at)
	}
	if at := clipAt(got, ids[0]); at != "0:0+20@0" {
		t.Errorf("first clip = %s, want it where it was, with room up to the third now", at)
	}
}

func TestATrimIsCheckedAgainstTheAudioAClipCoversAtItsTempo(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipTempo(p.song.ID, p.first, 0.5))

	got := timelineChange(t, ts.trimClip(p.song.ID, p.first, 2, 16))
	if at := clipAt(got, p.first); at != "0:4+16@2" {
		t.Errorf("clip = %s, want it from 2 s in, 4 s along the Timeline, to the end of its 10 s Beat", at)
	}
	expectError(t, ts.trimClip(p.song.ID, p.first, 2, 16.5), http.StatusBadRequest,
		"a Clip can't play past the end of its source")
	expectError(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.short.ID, "tempo": 2, "start": 0, "offset": 0, "length": 5.5,
	}), http.StatusBadRequest, "a Clip can't play past the end of its source")
}

func TestSplitDuplicatePasteAndPlacingBackKeepATempo(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipTempo(p.song.ID, p.first, 0.5))

	got := timelineChange(t, ts.splitClips(p.song.ID, 5, p.first))
	left, right := got.Tracks[0].Clips[0], got.Tracks[0].Clips[1]
	if fmt.Sprintf("%s %s", clipAt(got, left.ID), clipAt(got, right.ID)) != "0:0+5@0 0:5+15@2.5" {
		t.Errorf("halves = %s and %s, want the cut 2.5 s into the audio", clipAt(got, left.ID), clipAt(got, right.ID))
	}
	if left.Tempo != 0.5 || right.Tempo != 0.5 {
		t.Errorf("halves = %+v and %+v, want both at 50%%", left, right)
	}

	got = timelineChange(t, ts.duplicateClip(p.song.ID, p.second))
	if c := got.Tracks[0].Clips[3]; c.Tempo != 1 {
		t.Errorf("duplicate = %+v, want it at the original's 100%%", c)
	}
	timelineChange(t, ts.setClipTempo(p.song.ID, p.second, 1.25))
	got = timelineChange(t, ts.duplicateClip(p.song.ID, p.second))
	if c := got.Tracks[0].Clips[4]; c.Tempo != 1.25 || c.Length != 16 {
		t.Errorf("duplicate = %+v, want it at 125%%, as long as the original", c)
	}

	got = timelineChange(t, ts.pasteClips(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.short.ID, "tempo": 0.5, "start": 0, "offset": 0, "length": 20,
	}))
	if c := got.Tracks[1].Clips[0]; c.Tempo != 0.5 {
		t.Errorf("pasted clip = %+v, want it at 50%%", c)
	}
	got = timelineChange(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "tempo": 2, "start": 30, "offset": 0, "length": 10,
	}))
	if c := got.Tracks[1].Clips[1]; c.Tempo != 2 {
		t.Errorf("placed clip = %+v, want it at 200%%", c)
	}
	expectError(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "tempo": 3, "start": 50, "offset": 0, "length": 5,
	}), http.StatusBadRequest, "a Clip's Tempo goes from 50% to 200%")
}

func TestAMergedClipStartsAt100Percent(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setClipTempo(p.song.ID, p.first, 0.5))

	got := timelineChange(t, ts.mergeClips(p.song.ID, mergedAudio(50, onTrack(p.tl.Tracks[0].ID), p.first, p.second)))

	if c := got.Tracks[0].Clips[0]; c.Tempo != 1 {
		t.Errorf("merged clip = %+v, want it at 100%%", c)
	}
}

func TestAClipOfTakesCanOnlyBeRetakenAt100Percent(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	tl := timelineChange(t, ts.recordTake(s.ID, takeRecording(ts.getTimeline(s.ID).Tracks[0].ID, 0, 0, 0, 3)))
	clipID := tl.Tracks[0].Clips[0].ID
	takeID := tl.Tracks[0].Clips[0].Takes[0].ID

	got := timelineChange(t, ts.setClipTempo(s.ID, clipID, 0.5))
	if at := clipAt(got, clipID); at != "0:0+6@0" {
		t.Errorf("clip = %s, want its 3 s Take over 6 s", at)
	}
	expectError(t, ts.retake(s.ID, clipID, retakeUpload(0, 0, 3)), http.StatusBadRequest,
		"set the Clip's Tempo back to 100% to retake it")

	// A nudge stays in the recording's own time.
	got = timelineChange(t, ts.nudgeTake(s.ID, clipID, takeID, 0.25))
	if tk := clipByID(t, got, clipID).Takes[0]; tk.Nudge != 0.25 || tk.Position != 0.25 {
		t.Errorf("take = %+v, want it nudged 0.25 s later in its recording", tk)
	}

	timelineChange(t, ts.setClipTempo(s.ID, clipID, 1))
	timelineChange(t, ts.retake(s.ID, clipID, retakeUpload(0, 0, 3)))
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
