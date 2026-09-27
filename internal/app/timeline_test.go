package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// timeline is a Song's Timeline as the API returns it.
type timeline struct {
	SongID    int64        `json:"songId"`
	Version   int64        `json:"version"`
	UpdatedAt string       `json:"updatedAt"`
	Tracks    []track      `json:"tracks"`
	Beats     []clipSource `json:"beats"`
}

// track is a lane on the Timeline with its Clips, in Timeline order.
type track struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Clips []clip `json:"clips"`
}

// clip is a stretch of a Beat placed on a Track.
type clip struct {
	ID     int64   `json:"id"`
	BeatID int64   `json:"beatId"`
	Start  float64 `json:"start"`
	Offset float64 `json:"offset"`
	Length float64 `json:"length"`
}

// clipSource is a Beat the Timeline's Clips play, without its peaks.
type clipSource struct {
	ID       int64   `json:"id"`
	Title    string  `json:"title"`
	BPM      *int    `json:"bpm"`
	FileName string  `json:"fileName"`
	Size     int64   `json:"size"`
	Duration float64 `json:"duration"`
}

func timelinePath(songID int64) string {
	return fmt.Sprintf("/api/songs/%d/timeline", songID)
}

// getTimeline reads a Song's Timeline.
func (ts *testServer) getTimeline(songID int64) timeline {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, timelinePath(songID), nil)
	expectStatus(ts.t, res, http.StatusOK)
	var tl timeline
	res.JSON(ts.t, &tl)
	return tl
}

// addBeatToSong sends a request to add a Beat to a Song's Timeline.
func (ts *testServer) addBeatToSong(songID, beatID int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/beats", map[string]any{"beatId": beatID})
}

// timelineChange expects a Timeline change to succeed and returns the
// Timeline.
func timelineChange(t *testing.T, res response) timeline {
	t.Helper()
	expectStatus(t, res, http.StatusOK)
	var tl timeline
	res.JSON(t, &tl)
	return tl
}

// beatOfLength uploads a Beat lasting duration seconds.
func (ts *testServer) beatOfLength(title string, duration float64) beat {
	ts.t.Helper()
	return ts.uploadBeat(fakeAudio(title + ".mp3").with(map[string]any{"title": title, "duration": duration}))
}

func TestANewSongHasAnEmptyTimeline(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	got := ts.getTimeline(s.ID)

	want := timeline{SongID: s.ID, Version: s.Version, UpdatedAt: s.UpdatedAt, Tracks: []track{}, Beats: []clipSource{}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("timeline = %+v, want %+v", got, want)
	}
}

func TestTheFirstBeatLandsAtTheStartOfANewBeatTrack(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	b := ts.uploadBeat(fakeAudio("dark_trap.mp3").with(map[string]any{"title": "Dark Trap", "bpm": 140, "duration": 95.5}))

	got := timelineChange(t, ts.addBeatToSong(s.ID, b.ID))

	if len(got.Tracks) != 1 {
		t.Fatalf("tracks = %+v, want one", got.Tracks)
	}
	tr := got.Tracks[0]
	if tr.Name != "Beat" {
		t.Errorf("track name = %q, want %q", tr.Name, "Beat")
	}
	wantClips := []clip{{ID: firstClipID(tr), BeatID: b.ID, Start: 0, Offset: 0, Length: 95.5}}
	if !reflect.DeepEqual(tr.Clips, wantClips) {
		t.Errorf("clips = %+v, want %+v", tr.Clips, wantClips)
	}
	wantBeats := []clipSource{{ID: b.ID, Title: "Dark Trap", BPM: intPtr(140), FileName: "dark_trap.mp3", Size: b.Size, Duration: 95.5}}
	if !reflect.DeepEqual(got.Beats, wantBeats) {
		t.Errorf("beats = %+v, want %+v", got.Beats, wantBeats)
	}
	if read := ts.getTimeline(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
}

func firstClipID(tr track) int64 {
	if len(tr.Clips) == 0 {
		return 0
	}
	return tr.Clips[0].ID
}

// clipsOf lists a Track's Clips as "beat@start+length".
func clipsOf(tl timeline, trackIndex int) []string {
	out := []string{}
	for _, c := range tl.Tracks[trackIndex].Clips {
		out = append(out, fmt.Sprintf("%d@%g+%g", c.BeatID, c.Start, c.Length))
	}
	return out
}

func TestTheNextBeatIsAppendedAfterTheBeatTracksLastClip(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	intro := ts.beatOfLength("Intro", 10)
	loop := ts.beatOfLength("Loop", 30.5)
	timelineChange(t, ts.addBeatToSong(s.ID, intro.ID))
	timelineChange(t, ts.addBeatToSong(s.ID, loop.ID))

	got := timelineChange(t, ts.addBeatToSong(s.ID, intro.ID))

	if len(got.Tracks) != 1 {
		t.Fatalf("tracks = %+v, want every Beat on the one beat Track", got.Tracks)
	}
	want := []string{
		fmt.Sprintf("%d@0+10", intro.ID),
		fmt.Sprintf("%d@10+30.5", loop.ID),
		fmt.Sprintf("%d@40.5+10", intro.ID),
	}
	if clips := clipsOf(got, 0); !reflect.DeepEqual(clips, want) {
		t.Errorf("clips = %q, want %q", clips, want)
	}
	if len(got.Beats) != 2 {
		t.Errorf("beats = %+v, want each Beat used listed once", got.Beats)
	}
}

func TestARenamedBeatTrackIsStillWhereBeatsGo(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	first := ts.beatOfLength("First", 10)
	tl := timelineChange(t, ts.addBeatToSong(s.ID, first.ID))
	trackID := tl.Tracks[0].ID

	renamed := timelineChange(t, ts.Do(http.MethodPatch, fmt.Sprintf("%s/tracks/%d", timelinePath(s.ID), trackID),
		map[string]any{"name": "  Instrumental "}))
	if renamed.Tracks[0].Name != "Instrumental" {
		t.Errorf("track name = %q, want %q", renamed.Tracks[0].Name, "Instrumental")
	}

	got := timelineChange(t, ts.addBeatToSong(s.ID, ts.beatOfLength("Second", 5).ID))

	if len(got.Tracks) != 1 || got.Tracks[0].ID != trackID || len(got.Tracks[0].Clips) != 2 {
		t.Errorf("tracks = %+v, want the second Beat on the renamed Track", got.Tracks)
	}
}

func TestATrackNeedsAName(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	tl := timelineChange(t, ts.addBeatToSong(s.ID, ts.beatOfLength("Beat", 10).ID))

	res := ts.Do(http.MethodPatch, fmt.Sprintf("%s/tracks/%d", timelinePath(s.ID), tl.Tracks[0].ID),
		map[string]any{"name": " "})

	expectError(t, res, http.StatusBadRequest, "a Track's name is required")
	if got := ts.getTimeline(s.ID); !reflect.DeepEqual(got, tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", got, tl)
	}
}

func TestAddingAnUnknownBeatIsRejected(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	expectError(t, ts.addBeatToSong(s.ID, 999), http.StatusBadRequest, "there's no such Beat in the Beat Library")
	expectError(t, ts.Do(http.MethodPost, timelinePath(s.ID)+"/beats", map[string]any{}),
		http.StatusBadRequest, "beatId is required")

	if got := ts.getSong(s.ID); got.Version != s.Version {
		t.Errorf("version = %d, want it unchanged at %d", got.Version, s.Version)
	}
}

func TestTheTimelineOfAnUnknownSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	b := ts.beatOfLength("Beat", 10)

	expectStatus(t, ts.Do(http.MethodGet, timelinePath(999), nil), http.StatusNotFound)
	expectStatus(t, ts.addBeatToSong(999, b.ID), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodPatch, timelinePath(ts.createSong("Other").ID)+"/tracks/999",
		map[string]any{"name": "Beat"}), http.StatusNotFound)
}

// timelineChanges covers each kind of Timeline change, sent based on a
// version of a Song whose Timeline holds one Beat.
var timelineChanges = []struct {
	name string
	send func(ts *testServer, songID int64, tl timeline, version int64) response
}{
	{"add a beat", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPost, timelinePath(songID)+"/beats", map[string]any{"beatId": tl.Beats[0].ID})
	}},
	{"rename a track", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPatch, fmt.Sprintf("%s/tracks/%d", timelinePath(songID), tl.Tracks[0].ID),
			map[string]any{"name": "Instrumental"})
	}},
}

func TestChangingTheTimelineCountsAsEditingTheSong(t *testing.T) {
	for _, c := range timelineChanges {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			s := ts.createSong("Night Drive")
			before := timelineChange(t, ts.addBeatToSong(s.ID, ts.beatOfLength("Beat", 10).ID))
			ts.createSong("Edited Since")

			got := timelineChange(t, c.send(ts, s.ID, before, before.Version))

			if got.Version == before.Version {
				t.Errorf("version = %d, want it changed", got.Version)
			}
			if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
				t.Errorf("updatedAt = %s, want it after %s", got.UpdatedAt, before.UpdatedAt)
			}
			if read := ts.getSong(s.ID); read.Version != got.Version || read.UpdatedAt != got.UpdatedAt {
				t.Errorf("song version, updatedAt = %d, %s; want %d, %s", read.Version, read.UpdatedAt, got.Version, got.UpdatedAt)
			}
			if first := ts.listSongs()[0]; first.ID != s.ID {
				t.Errorf("top of the Song list = %q, want the Song whose Timeline changed", first.Title)
			}
		})
	}
}

func TestATimelineChangeBasedOnAnOldVersionIsRejectedAndChangesNothing(t *testing.T) {
	for _, c := range timelineChanges {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			s := ts.createSong("Night Drive")
			old := timelineChange(t, ts.addBeatToSong(s.ID, ts.beatOfLength("Beat", 10).ID))
			ts.updateSong(s.ID, map[string]any{"notes": "Edited in another tab"})
			current := ts.getTimeline(s.ID)

			expectStale(t, c.send(ts, s.ID, old, old.Version))

			if read := ts.getTimeline(s.ID); !reflect.DeepEqual(read, current) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, current)
			}
		})
	}
}

func TestABeatInUseCantBeDeletedOrHaveItsFileReplaced(t *testing.T) {
	ts := newTestServer(t)
	b := ts.beatOfLength("Dark Trap", 10)
	night := ts.createSong("Night Drive")
	dawn := ts.createSong("Dawn")
	timelineChange(t, ts.addBeatToSong(night.ID, b.ID))
	timelineChange(t, ts.addBeatToSong(night.ID, b.ID))
	timelineChange(t, ts.addBeatToSong(dawn.ID, b.ID))
	upload := fakeAudio("Dark Trap.mp3")
	wantSongs := []songTitle{{ID: night.ID, Title: "Night Drive"}, {ID: dawn.ID, Title: "Dawn"}}

	for name, res := range map[string]response{
		"delete":  ts.Do(http.MethodDelete, beatPath(b.ID), nil),
		"replace": ts.SendUpload(http.MethodPut, beatPath(b.ID)+"/file", fakeAudio("other.wav")),
	} {
		expectStatus(t, res, http.StatusConflict)
		var e struct {
			Error string
			Code  string
			Songs []songTitle
		}
		res.JSON(t, &e)
		if e.Code != "in_use" || !reflect.DeepEqual(e.Songs, wantSongs) || e.Error == "" {
			t.Errorf("%s: error = %+v, want in_use listing %+v", name, e, wantSongs)
		}
	}

	read := ts.getBeat(b.ID)
	if !reflect.DeepEqual(read.Songs, wantSongs) {
		t.Errorf("beat songs = %+v, want %+v", read.Songs, wantSongs)
	}
	if list := ts.listBeats(); !reflect.DeepEqual(list[0].Songs, wantSongs) {
		t.Errorf("listed beat songs = %+v, want %+v", list[0].Songs, wantSongs)
	}
	if served := ts.Do(http.MethodGet, beatPath(b.ID)+"/audio", nil); string(served.Body) != string(upload.Data) {
		t.Errorf("audio = %q, want the original file", served.Body)
	}
}

func TestDeletingASongDeletesItsTimelineButKeepsItsBeats(t *testing.T) {
	ts := newTestServer(t)
	b := ts.beatOfLength("Dark Trap", 10)
	gone := ts.createSong("Gone")
	timelineChange(t, ts.addBeatToSong(gone.ID, b.ID))

	expectStatus(t, ts.Do(http.MethodDelete, songPath(gone.ID), nil), http.StatusNoContent)

	expectStatus(t, ts.Do(http.MethodGet, timelinePath(gone.ID), nil), http.StatusNotFound)
	if read := ts.getBeat(b.ID); len(read.Songs) != 0 {
		t.Errorf("beat songs = %+v, want none once the Song is deleted", read.Songs)
	}
	expectStatus(t, ts.Do(http.MethodGet, beatPath(b.ID)+"/audio", nil), http.StatusOK)
	// No Song uses it any more, so it can go.
	expectStatus(t, ts.Do(http.MethodDelete, beatPath(b.ID), nil), http.StatusNoContent)
}
