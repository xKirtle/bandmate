package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// Undo brings back what was deleted exactly as it was, through intents made
// for it: placing a Clip with its trim, and adding a Track at a position
// with its levels and Clips.

// placeClip sends a request to place a stretch of a Beat on a Track.
func (ts *testServer) placeClip(songID int64, body map[string]any) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/clips", body)
}

func TestAClipCanBePlacedWithItsTrim(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.placeClip(p.song.ID, map[string]any{
		"trackId": p.tl.Tracks[1].ID, "beatId": p.long.ID, "start": 12.5, "offset": 4, "length": 6,
	}))

	if want := []string{fmt.Sprintf("%d@12.5+6", p.long.ID)}; !reflect.DeepEqual(clipsOf(got, 1), want) {
		t.Errorf("clips = %q, want %q", clipsOf(got, 1), want)
	}
	if c := got.Tracks[1].Clips[0]; c.ID == p.first || c.ID == p.second || c.Offset != 4 {
		t.Errorf("clip = %+v, want a new Clip playing from 4s of its Beat", c)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
}

func TestAPlacedClipFollowsTheTimelinesRules(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	beatTrack := p.tl.Tracks[0].ID
	other := ts.createSong("Other")
	otherTrack := timelineChange(t, ts.addTrack(other.ID, "Elsewhere")).Tracks[0].ID

	for name, c := range map[string]struct {
		body   map[string]any
		status int
		msg    string
	}{
		"overlapping a Clip": {map[string]any{"trackId": beatTrack, "beatId": p.short.ID, "start": 25, "offset": 0, "length": 10},
			http.StatusConflict, "Clips can't overlap on a Track"},
		"before 0:00": {map[string]any{"trackId": beatTrack, "beatId": p.short.ID, "start": -1, "offset": 0, "length": 5},
			http.StatusBadRequest, "a Clip can't start before 0:00"},
		"past its source": {map[string]any{"trackId": beatTrack, "beatId": p.short.ID, "start": 60, "offset": 5, "length": 6},
			http.StatusBadRequest, "a Clip can't play past the end of its source"},
		"before its source": {map[string]any{"trackId": beatTrack, "beatId": p.short.ID, "start": 60, "offset": -1, "length": 5},
			http.StatusBadRequest, "a Clip can't start before its source does"},
		"for no time": {map[string]any{"trackId": beatTrack, "beatId": p.short.ID, "start": 60, "offset": 0, "length": 0},
			http.StatusBadRequest, "a Clip must play for some time"},
		"of an unknown Beat": {map[string]any{"trackId": beatTrack, "beatId": 999, "start": 60, "offset": 0, "length": 5},
			http.StatusBadRequest, "there's no such Beat in the Beat Library"},
		"on another Song's Track": {map[string]any{"trackId": otherTrack, "beatId": p.short.ID, "start": 60, "offset": 0, "length": 5},
			http.StatusBadRequest, "there's no such Track on this Timeline"},
		"missing its placement": {map[string]any{"trackId": beatTrack, "beatId": p.short.ID},
			http.StatusBadRequest, "trackId or newTrack, start, offset and length are required"},
		"playing nothing": {map[string]any{"trackId": beatTrack, "start": 60, "offset": 0, "length": 5},
			http.StatusBadRequest, "a Clip plays one of a Beat, a Sound or Takes"},
		"on a new Track": {map[string]any{"newTrack": 0, "beatId": p.short.ID, "start": 60, "offset": 0, "length": 5},
			http.StatusBadRequest, "there's no such new Track"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.placeClip(p.song.ID, c.body), c.status, c.msg)
			if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, p.tl) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, p.tl)
			}
		})
	}
}

func TestADeletedTrackCanBeAddedBackAsItWas(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	tl := timelineChange(t, ts.addTrack(p.song.ID, "Lead vox"))
	beatTrack := tl.Tracks[0]
	timelineChange(t, ts.trimClip(p.song.ID, p.second, 2, 15))
	timelineChange(t, ts.updateTrack(p.song.ID, beatTrack.ID, map[string]any{"volume": -4.5, "muted": true, "soloed": true}))
	timelineChange(t, ts.deleteTrack(p.song.ID, beatTrack.ID))

	got := timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/tracks", map[string]any{
		"name": "Beat", "position": 0, "volume": -4.5, "muted": true, "soloed": true,
		"clips": []map[string]any{
			{"beatId": p.short.ID, "start": 0, "offset": 0, "length": 10},
			{"beatId": p.long.ID, "start": 32, "offset": 2, "length": 15},
		},
	}))

	if want := []string{"Beat", "Adlibs", "Lead vox"}; !reflect.DeepEqual(trackNames(got), want) {
		t.Errorf("tracks = %q, want the Track back on top: %q", trackNames(got), want)
	}
	back := got.Tracks[0]
	if back.ID == beatTrack.ID || back.Volume != -4.5 || !back.Muted || !back.Soloed {
		t.Errorf("track = %+v, want a new Track with its levels back", back)
	}
	if want := []string{fmt.Sprintf("%d@0+10", p.short.ID), fmt.Sprintf("%d@32+15", p.long.ID)}; !reflect.DeepEqual(clipsOf(got, 0), want) {
		t.Errorf("clips = %q, want %q", clipsOf(got, 0), want)
	}
	if back.Clips[1].Offset != 2 {
		t.Errorf("clip = %+v, want its trim back", back.Clips[1])
	}
	// Positions stay in order around it.
	if want := []string{"Beat", "Adlibs", "Lead vox", "Harmony"}; !reflect.DeepEqual(trackNames(timelineChange(t, ts.addTrack(p.song.ID, "Harmony"))), want) {
		t.Errorf("a Track added after goes at the bottom: want %q", want)
	}
	between := timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/tracks", map[string]any{"name": "Keys", "position": 2}))
	if want := []string{"Beat", "Adlibs", "Keys", "Lead vox", "Harmony"}; !reflect.DeepEqual(trackNames(between), want) {
		t.Errorf("tracks = %q, want %q", trackNames(between), want)
	}
}

func TestATrackAddedBackFollowsTheTimelinesRules(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	for name, c := range map[string]struct {
		body   map[string]any
		status int
		msg    string
	}{
		"with overlapping Clips": {map[string]any{"name": "Beat", "clips": []map[string]any{
			{"beatId": p.short.ID, "start": 0, "offset": 0, "length": 10},
			{"beatId": p.short.ID, "start": 5, "offset": 0, "length": 10},
		}}, http.StatusConflict, "Clips can't overlap on a Track"},
		"with a Clip past its source": {map[string]any{"name": "Beat", "clips": []map[string]any{
			{"beatId": p.short.ID, "start": 0, "offset": 2, "length": 10},
		}}, http.StatusBadRequest, "a Clip can't play past the end of its source"},
		"too loud": {map[string]any{"name": "Beat", "volume": 37},
			http.StatusBadRequest, "a Track's volume goes from -36 dB to +36 dB"},
		"out of place": {map[string]any{"name": "Beat", "position": 3},
			http.StatusBadRequest, "a Track's position must be from 0 to the number of Tracks"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/tracks", c.body), c.status, c.msg)
			if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, p.tl) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, p.tl)
			}
		})
	}
}
