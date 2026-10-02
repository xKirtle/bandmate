package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// clipMove is where one Clip of a group goes: a Track and a start.
type clipMove struct {
	ClipID  int64   `json:"clipId"`
	TrackID int64   `json:"trackId"`
	Start   float64 `json:"start"`
}

// moveClips sends a request to move several Clips at once.
func (ts *testServer) moveClips(songID int64, moves ...clipMove) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/clips/move", map[string]any{"clips": moves})
}

func TestSeveralClipsCanBeMovedAtOnce(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	beatTrack, adlibs := p.tl.Tracks[0].ID, p.tl.Tracks[1].ID

	got := timelineChange(t, ts.moveClips(p.song.ID,
		clipMove{p.first, adlibs, 5},
		clipMove{p.second, beatTrack, 40}))

	if at := clipAt(got, p.first); at != "1:5+10@0" {
		t.Errorf("first clip = %s, want it on the second Track at 0:05", at)
	}
	if at := clipAt(got, p.second); at != "0:40+20@0" {
		t.Errorf("second clip = %s, want it at 0:40", at)
	}
	if got.Version != p.tl.Version+1 {
		t.Errorf("version = %d, want one more than %d", got.Version, p.tl.Version)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
}

func TestClipsMovedTogetherAreCheckedWhereTheyLand(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	beatTrack := p.tl.Tracks[0].ID

	// The first lands where the second was, which has moved on by then.
	got := timelineChange(t, ts.moveClips(p.song.ID,
		clipMove{p.first, beatTrack, 35},
		clipMove{p.second, beatTrack, 60}))

	if at := clipAt(got, p.first); at != "0:35+10@0" {
		t.Errorf("first clip = %s, want it at 0:35", at)
	}
	if at := clipAt(got, p.second); at != "0:60+20@0" {
		t.Errorf("second clip = %s, want it at 1:00", at)
	}
}

func TestAMoveOfSeveralClipsIsRefusedWhole(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	beatTrack, adlibs := p.tl.Tracks[0].ID, p.tl.Tracks[1].ID
	// A third Clip, outside the group, at 0:00-0:10 on the second Track.
	timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips",
		map[string]any{"trackId": adlibs, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10}))
	other := ts.createSong("Other")
	theirs := timelineChange(t, ts.addBeatToSong(other.ID, p.short.ID))
	before := ts.getTimeline(p.song.ID)

	for name, c := range map[string]struct {
		moves  []clipMove
		status int
		msg    string
	}{
		"onto a Clip outside the group": {
			[]clipMove{{p.first, beatTrack, 70}, {p.second, adlibs, 5}}, http.StatusConflict, "Clips can't overlap on a Track"},
		"onto each other": {
			[]clipMove{{p.first, beatTrack, 70}, {p.second, beatTrack, 65}}, http.StatusConflict, "Clips can't overlap on a Track"},
		"before 0:00": {
			[]clipMove{{p.first, beatTrack, 60}, {p.second, beatTrack, -1}}, http.StatusBadRequest, "a Clip can't start before 0:00"},
		"onto another Song's Track": {
			[]clipMove{{p.first, beatTrack, 60}, {p.second, theirs.Tracks[0].ID, 100}}, http.StatusBadRequest,
			"there's no such Track on this Timeline"},
		"the same Clip twice": {
			[]clipMove{{p.first, beatTrack, 60}, {p.first, beatTrack, 80}}, http.StatusBadRequest, "each Clip can only move once"},
		"no Clips": {
			[]clipMove{}, http.StatusBadRequest, "clips are required"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.moveClips(p.song.ID, c.moves...), c.status, c.msg)
			if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
			}
		})
	}

	t.Run("another Song's Clip", func(t *testing.T) {
		expectStatus(t, ts.moveClips(p.song.ID,
			clipMove{p.first, beatTrack, 60},
			clipMove{theirs.Tracks[0].Clips[0].ID, beatTrack, 100}), http.StatusNotFound)
		if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
			t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
		}
	})
}
