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
	// Loop is null until one is set.
	Loop *loop `json:"loop"`
}

// loop is the stretch of the Timeline that playback repeats while it's on.
type loop struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	On    bool    `json:"on"`
}

// track is a lane on the Timeline with its Clips, in Timeline order.
type track struct {
	ID     int64   `json:"id"`
	Name   string  `json:"name"`
	Volume float64 `json:"volume"`
	Muted  bool    `json:"muted"`
	Soloed bool    `json:"soloed"`
	Clips  []clip  `json:"clips"`
}

// clip is a stretch of a Beat, or of Takes, placed on a Track.
type clip struct {
	ID           int64   `json:"id"`
	BeatID       int64   `json:"beatId"`
	Takes        []take  `json:"takes"`
	ActiveTakeID *int64  `json:"activeTakeId"`
	Start        float64 `json:"start"`
	Offset       float64 `json:"offset"`
	Length       float64 `json:"length"`
}

// take is a recording in a Clip, without its peaks unless read on its own.
type take struct {
	ID            int64     `json:"id"`
	Number        int       `json:"number"`
	Size          int64     `json:"size"`
	Duration      float64   `json:"duration"`
	SampleRate    int       `json:"sampleRate"`
	LatencyOffset float64   `json:"latencyOffset"`
	Position      float64   `json:"position"`
	RecordedAt    string    `json:"recordedAt"`
	Peaks         []float64 `json:"peaks"`
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
	wantClips := []clip{{ID: firstClipID(tr), BeatID: b.ID, Takes: []take{}, Start: 0, Offset: 0, Length: 95.5}}
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
// version of a Song whose Timeline holds one Beat and a Loop.
var timelineChanges = []struct {
	name string
	send func(ts *testServer, songID int64, tl timeline, version int64) response
}{
	{"add a beat", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPost, timelinePath(songID)+"/beats", map[string]any{"beatId": tl.Beats[0].ID})
	}},
	{"add a track", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPost, timelinePath(songID)+"/tracks", map[string]any{"name": "Adlibs"})
	}},
	{"move a clip", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPost, clipPath(songID, tl.Tracks[0].Clips[0].ID)+"/move",
			map[string]any{"trackId": tl.Tracks[0].ID, "start": 5})
	}},
	{"trim a clip", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPost, clipPath(songID, tl.Tracks[0].Clips[0].ID)+"/trim",
			map[string]any{"offset": 1, "length": 5})
	}},
	{"duplicate a clip", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPost, clipPath(songID, tl.Tracks[0].Clips[0].ID)+"/duplicate", nil)
	}},
	{"place a clip", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPost, timelinePath(songID)+"/clips",
			map[string]any{"trackId": tl.Tracks[0].ID, "beatId": tl.Beats[0].ID, "start": 20, "offset": 1, "length": 5})
	}},
	{"delete a clip", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodDelete, clipPath(songID, tl.Tracks[0].Clips[0].ID), nil)
	}},
	{"rename a track", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPatch, trackPath(songID, tl.Tracks[0].ID), map[string]any{"name": "Instrumental"})
	}},
	{"set a track's levels", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPatch, trackPath(songID, tl.Tracks[0].ID), map[string]any{"volume": -3, "muted": true, "soloed": true})
	}},
	{"reorder tracks", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPut, timelinePath(songID)+"/tracks", map[string]any{"tracks": []int64{tl.Tracks[0].ID}})
	}},
	{"delete a track", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodDelete, trackPath(songID, tl.Tracks[0].ID), nil)
	}},
	{"set the loop", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPut, loopPath(songID), map[string]any{"start": 4, "end": 8, "on": true})
	}},
	{"switch the loop on", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodPatch, loopPath(songID), map[string]any{"on": true})
	}},
	{"clear the loop", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.DoAt(v, http.MethodDelete, loopPath(songID), nil)
	}},
	{"record a take", func(ts *testServer, songID int64, tl timeline, v int64) response {
		return ts.SendUploadAt(v, http.MethodPost, timelinePath(songID)+"/takes",
			takeRecording(tl.Tracks[0].ID, 10, 8, 0, 3))
	}},
}

// timelineToChange sets up a Song whose Timeline holds one 10-second Beat and
// a Loop that's off, for timelineChanges.
func timelineToChange(t *testing.T, ts *testServer) (song, timeline) {
	t.Helper()
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, ts.beatOfLength("Beat", 10).ID))
	return s, timelineChange(t, ts.setLoop(s.ID, map[string]any{"start": 1, "end": 5}))
}

func TestChangingTheTimelineCountsAsEditingTheSong(t *testing.T) {
	for _, c := range timelineChanges {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			s, before := timelineToChange(t, ts)
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
			s, old := timelineToChange(t, ts)
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
	timelineChange(t, ts.setLoop(gone.ID, map[string]any{"start": 1, "end": 5, "on": true}))

	expectStatus(t, ts.Do(http.MethodDelete, songPath(gone.ID), nil), http.StatusNoContent)

	expectStatus(t, ts.Do(http.MethodGet, timelinePath(gone.ID), nil), http.StatusNotFound)
	if read := ts.getBeat(b.ID); len(read.Songs) != 0 {
		t.Errorf("beat songs = %+v, want none once the Song is deleted", read.Songs)
	}
	expectStatus(t, ts.Do(http.MethodGet, beatPath(b.ID)+"/audio", nil), http.StatusOK)
	// No Song uses it any more, so it can go.
	expectStatus(t, ts.Do(http.MethodDelete, beatPath(b.ID), nil), http.StatusNoContent)
}

// clipPath is where one of a Song's Clips lives.
func clipPath(songID, clipID int64) string {
	return fmt.Sprintf("%s/clips/%d", timelinePath(songID), clipID)
}

// moveClip sends a request to move a Clip to a start on a Track.
func (ts *testServer) moveClip(songID, clipID, trackID int64, start float64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, clipPath(songID, clipID)+"/move", map[string]any{"trackId": trackID, "start": start})
}

// trimClip sends a request to have a Clip play length seconds of its
// source from offset.
func (ts *testServer) trimClip(songID, clipID int64, offset, length float64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, clipPath(songID, clipID)+"/trim", map[string]any{"offset": offset, "length": length})
}

// duplicateClip sends a request to copy a Clip.
func (ts *testServer) duplicateClip(songID, clipID int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, clipPath(songID, clipID)+"/duplicate", nil)
}

// deleteClip sends a request to delete a Clip.
func (ts *testServer) deleteClip(songID, clipID int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodDelete, clipPath(songID, clipID), nil)
}

// addTrack sends a request to add a Track at the bottom of a Song's
// Timeline.
func (ts *testServer) addTrack(songID int64, name string) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/tracks", map[string]any{"name": name})
}

// clipAt is a Clip's place on the Timeline and its trim, as
// "track:start+length@offset".
func clipAt(tl timeline, clipID int64) string {
	for i, tr := range tl.Tracks {
		for _, c := range tr.Clips {
			if c.ID == clipID {
				return fmt.Sprintf("%d:%g+%g@%g", i, c.Start, c.Length, c.Offset)
			}
		}
	}
	return "nowhere"
}

// twoClips is a Song with a 10-second Beat at 0:00 on its beat Track and a
// 20-second one at 0:30 after it, and an empty second Track.
type twoClips struct {
	song        song
	short, long beat
	// first and second are the Clips of the short and the long Beat.
	first, second int64
	tl            timeline
}

func placeTwoClips(t *testing.T, ts *testServer) twoClips {
	t.Helper()
	p := twoClips{song: ts.createSong("Night Drive"), short: ts.beatOfLength("Short", 10), long: ts.beatOfLength("Long", 20)}
	timelineChange(t, ts.addBeatToSong(p.song.ID, p.short.ID))
	tl := timelineChange(t, ts.addBeatToSong(p.song.ID, p.long.ID))
	p.first, p.second = tl.Tracks[0].Clips[0].ID, tl.Tracks[0].Clips[1].ID
	tl = timelineChange(t, ts.moveClip(p.song.ID, p.second, tl.Tracks[0].ID, 30))
	p.tl = timelineChange(t, ts.addTrack(p.song.ID, "Adlibs"))
	return p
}

func TestATrackCanBeAddedAtTheBottom(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, ts.beatOfLength("Beat", 10).ID))

	got := timelineChange(t, ts.addTrack(s.ID, "  Lead vox "))

	if len(got.Tracks) != 2 {
		t.Fatalf("tracks = %+v, want two", got.Tracks)
	}
	want := track{ID: got.Tracks[1].ID, Name: "Lead vox", Volume: 0, Clips: []clip{}}
	if !reflect.DeepEqual(got.Tracks[1], want) {
		t.Errorf("tracks = %+v, want an empty \"Lead vox\" Track at 0 dB, neither muted nor soloed, below the beat Track", got.Tracks)
	}
	expectError(t, ts.addTrack(s.ID, " "), http.StatusBadRequest, "a Track's name is required")
}

func TestAClipCanBeMovedAlongItsTrack(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	if got := clipAt(p.tl, p.second); got != "0:30+20@0" {
		t.Fatalf("second clip = %s, want it moved to 0:30", got)
	}
	got := timelineChange(t, ts.moveClip(p.song.ID, p.first, p.tl.Tracks[0].ID, 12.5))

	if at := clipAt(got, p.first); at != "0:12.5+10@0" {
		t.Errorf("first clip = %s, want it at 0:12.5", at)
	}
	if want := []string{fmt.Sprintf("%d@12.5+10", p.short.ID), fmt.Sprintf("%d@30+20", p.long.ID)}; !reflect.DeepEqual(clipsOf(got, 0), want) {
		t.Errorf("clips = %q, want %q", clipsOf(got, 0), want)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
}

func TestAClipCanBeMovedOntoAnotherTrack(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	// It may land where it overlaps a Clip on the Track it leaves.
	got := timelineChange(t, ts.moveClip(p.song.ID, p.second, p.tl.Tracks[1].ID, 5))

	if at := clipAt(got, p.second); at != "1:5+20@0" {
		t.Errorf("second clip = %s, want it on the second Track at 0:05", at)
	}
	if len(got.Tracks[0].Clips) != 1 {
		t.Errorf("beat track clips = %+v, want only the first left", got.Tracks[0].Clips)
	}
}

func TestMovingAClipIntoANeighbourIsRejected(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	beatTrack := p.tl.Tracks[0].ID
	timelineChange(t, ts.moveClip(p.song.ID, p.first, p.tl.Tracks[1].ID, 0))
	before := ts.getTimeline(p.song.ID)

	// The second Clip is at 0:30-0:50 on the beat Track, the first at
	// 0:00-0:10 on the other one.
	for name, send := range map[string]func() response{
		"overlapping its start": func() response { return ts.moveClip(p.song.ID, p.first, beatTrack, 25) },
		"overlapping its end":   func() response { return ts.moveClip(p.song.ID, p.first, beatTrack, 49.5) },
		"inside it":             func() response { return ts.moveClip(p.song.ID, p.first, beatTrack, 35) },
		"covering it":           func() response { return ts.moveClip(p.song.ID, p.second, p.tl.Tracks[1].ID, 0) },
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, send(), http.StatusConflict, "Clips can't overlap on a Track")
			if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
			}
		})
	}

	// A Clip never collides with itself.
	timelineChange(t, ts.moveClip(p.song.ID, p.first, p.tl.Tracks[1].ID, 0.5))
	// Touching a neighbour's edge is fine, on either side.
	got := timelineChange(t, ts.moveClip(p.song.ID, p.first, beatTrack, 20))
	if at := clipAt(got, p.first); at != "0:20+10@0" {
		t.Errorf("first clip = %s, want it just before the second", at)
	}
	got = timelineChange(t, ts.moveClip(p.song.ID, p.first, beatTrack, 50))
	if at := clipAt(got, p.first); at != "0:50+10@0" {
		t.Errorf("first clip = %s, want it just after the second", at)
	}
}

func TestAMoveMustStayOnTheSongsTimeline(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	other := ts.createSong("Other")
	timelineChange(t, ts.addBeatToSong(other.ID, p.short.ID))
	otherTrack := ts.getTimeline(other.ID).Tracks[0].ID

	expectError(t, ts.moveClip(p.song.ID, p.first, p.tl.Tracks[0].ID, -1), http.StatusBadRequest,
		"a Clip can't start before 0:00")
	expectError(t, ts.moveClip(p.song.ID, p.first, otherTrack, 100), http.StatusBadRequest,
		"there's no such Track on this Timeline")
	expectError(t, ts.Do(http.MethodPost, clipPath(p.song.ID, p.first)+"/move", map[string]any{"start": 1}),
		http.StatusBadRequest, "trackId and start are required")
	expectStatus(t, ts.moveClip(p.song.ID, 999, p.tl.Tracks[0].ID, 100), http.StatusNotFound)
	expectStatus(t, ts.moveClip(other.ID, p.first, otherTrack, 100), http.StatusNotFound)
}

func TestEitherEdgeOfAClipCanBeTrimmedWithinItsSource(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	fileBefore := ts.Do(http.MethodGet, beatPath(p.long.ID)+"/audio", nil).Body

	// Skipping 4s of the start keeps the rest where it was on the Timeline.
	got := timelineChange(t, ts.trimClip(p.song.ID, p.second, 4, 16))
	if at := clipAt(got, p.second); at != "0:34+16@4" {
		t.Errorf("after trimming the start, second clip = %s, want 0:34+16@4", at)
	}
	got = timelineChange(t, ts.trimClip(p.song.ID, p.second, 4, 10.5))
	if at := clipAt(got, p.second); at != "0:34+10.5@4" {
		t.Errorf("after trimming the end, second clip = %s, want 0:34+10.5@4", at)
	}
	// Trimmed back out, all the way to the source's edges.
	got = timelineChange(t, ts.trimClip(p.song.ID, p.second, 0, 20))
	if at := clipAt(got, p.second); at != "0:30+20@0" {
		t.Errorf("after untrimming, second clip = %s, want 0:30+20@0", at)
	}

	// Rounding in the browser can leave a trim right back to the source's
	// start a hair short of it.
	got = timelineChange(t, ts.trimClip(p.song.ID, p.second, -1e-12, 20))
	if at := clipAt(got, p.second); at != "0:30+20@0" {
		t.Errorf("after a trim rounded past the source's start, second clip = %s, want 0:30+20@0", at)
	}

	if served := ts.Do(http.MethodGet, beatPath(p.long.ID)+"/audio", nil).Body; string(served) != string(fileBefore) {
		t.Errorf("audio = %q, want the file untouched", served)
	}
	if b := ts.getBeat(p.long.ID); b.Duration != 20 {
		t.Errorf("beat duration = %g, want it untouched", b.Duration)
	}
}

func TestATrimCantGoBeyondItsSource(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	for name, c := range map[string]struct {
		offset, length float64
		msg            string
	}{
		"before its start": {-1, 10, "a Clip can't start before its source does"},
		"past its end":     {5, 15.5, "a Clip can't play past the end of its source"},
		"to nothing":       {5, 0, "a Clip must play for some time"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.trimClip(p.song.ID, p.second, c.offset, c.length), http.StatusBadRequest, c.msg)
		})
	}
	expectError(t, ts.Do(http.MethodPost, clipPath(p.song.ID, p.second)+"/trim", map[string]any{"offset": 1}),
		http.StatusBadRequest, "offset and length are required")
	// Pulling the start back 1s would start the Clip before 0:00.
	timelineChange(t, ts.trimClip(p.song.ID, p.first, 2, 8))
	timelineChange(t, ts.moveClip(p.song.ID, p.first, p.tl.Tracks[0].ID, 1))
	expectError(t, ts.trimClip(p.song.ID, p.first, 0, 10), http.StatusBadRequest, "a Clip can't start before 0:00")

	if read := ts.getTimeline(p.song.ID); clipAt(read, p.second) != "0:30+20@0" || clipAt(read, p.first) != "0:1+8@2" {
		t.Errorf("clips = %s and %s, want the rejected trims to change nothing", clipAt(read, p.first), clipAt(read, p.second))
	}
}

func TestTrimmingIntoANeighbourIsRejected(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	// The second Clip plays 5s-15s of its Beat, at 0:35-0:45.
	timelineChange(t, ts.trimClip(p.song.ID, p.second, 5, 10))
	// The first Clip plays 0s-8s of its Beat at 0:27-0:35, touching it.
	timelineChange(t, ts.trimClip(p.song.ID, p.first, 0, 8))
	before := timelineChange(t, ts.moveClip(p.song.ID, p.first, p.tl.Tracks[0].ID, 27))

	expectError(t, ts.trimClip(p.song.ID, p.first, 0, 8.5), http.StatusConflict, "Clips can't overlap on a Track")
	expectError(t, ts.trimClip(p.song.ID, p.second, 4.5, 10.5), http.StatusConflict, "Clips can't overlap on a Track")

	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
	}
}

func TestSeveralClipsCanPlayTheSameBeat(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	// Duplicated, a Clip repeats right after itself when there's room...
	got := timelineChange(t, ts.duplicateClip(p.song.ID, p.first))
	want := []string{
		fmt.Sprintf("%d@0+10", p.short.ID),
		fmt.Sprintf("%d@10+10", p.short.ID),
		fmt.Sprintf("%d@30+20", p.long.ID),
	}
	if !reflect.DeepEqual(clipsOf(got, 0), want) {
		t.Errorf("clips = %q, want %q", clipsOf(got, 0), want)
	}
	// ...and after the Track's last Clip when there isn't, keeping its trim.
	timelineChange(t, ts.trimClip(p.song.ID, p.second, 2, 15))
	got = timelineChange(t, ts.duplicateClip(p.song.ID, p.first))
	dup := got.Tracks[0].Clips[3]
	if dup.BeatID != p.short.ID || dup.Start != 47 || dup.Offset != 0 || dup.Length != 10 {
		t.Errorf("duplicate = %+v, want the short Beat at 0:47", dup)
	}
	got = timelineChange(t, ts.duplicateClip(p.song.ID, p.second))
	dup = got.Tracks[0].Clips[4]
	if dup.BeatID != p.long.ID || dup.Start != 57 || dup.Offset != 2 || dup.Length != 15 {
		t.Errorf("duplicate = %+v, want the long Beat's trim at 0:57", dup)
	}
	// Adding the same Beat again reuses it too.
	got = timelineChange(t, ts.addBeatToSong(p.song.ID, p.long.ID))

	if n := len(got.Tracks[0].Clips); n != 6 {
		t.Errorf("clips = %d, want 6", n)
	}
	if len(got.Beats) != 2 {
		t.Errorf("beats = %+v, want each Beat listed once", got.Beats)
	}
	if b := ts.getBeat(p.short.ID); len(b.Songs) != 1 {
		t.Errorf("beat songs = %+v, want the Song listed once", b.Songs)
	}
	expectStatus(t, ts.duplicateClip(p.song.ID, 999), http.StatusNotFound)
}

func TestAClipCanBeDeleted(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.duplicateClip(p.song.ID, p.first))

	got := timelineChange(t, ts.deleteClip(p.song.ID, p.second))

	if want := []string{fmt.Sprintf("%d@0+10", p.short.ID), fmt.Sprintf("%d@10+10", p.short.ID)}; !reflect.DeepEqual(clipsOf(got, 0), want) {
		t.Errorf("clips = %q, want %q", clipsOf(got, 0), want)
	}
	if len(got.Beats) != 1 || got.Beats[0].ID != p.short.ID {
		t.Errorf("beats = %+v, want only the Beat still played", got.Beats)
	}
	// No Clip plays the long Beat any more, so it can go.
	expectStatus(t, ts.Do(http.MethodDelete, beatPath(p.long.ID), nil), http.StatusNoContent)
	expectStatus(t, ts.deleteClip(p.song.ID, p.second), http.StatusNotFound)
}

// trackPath is where one of a Song's Tracks lives.
func trackPath(songID, trackID int64) string {
	return fmt.Sprintf("%s/tracks/%d", timelinePath(songID), trackID)
}

// updateTrack sends a request to change some of a Track's name and levels.
func (ts *testServer) updateTrack(songID, trackID int64, changes map[string]any) response {
	ts.t.Helper()
	return ts.Do(http.MethodPatch, trackPath(songID, trackID), changes)
}

func TestATracksVolumeMuteAndSoloAreSavedWithTheSong(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	beat, adlibs := p.tl.Tracks[0], p.tl.Tracks[1]

	timelineChange(t, ts.updateTrack(p.song.ID, beat.ID, map[string]any{"volume": -12.5, "muted": true}))
	got := timelineChange(t, ts.updateTrack(p.song.ID, adlibs.ID, map[string]any{"soloed": true}))

	wantBeat := track{ID: beat.ID, Name: "Beat", Volume: -12.5, Muted: true, Clips: beat.Clips}
	wantAdlibs := track{ID: adlibs.ID, Name: "Adlibs", Soloed: true, Clips: []clip{}}
	if !reflect.DeepEqual(got.Tracks, []track{wantBeat, wantAdlibs}) {
		t.Errorf("tracks = %+v, want %+v", got.Tracks, []track{wantBeat, wantAdlibs})
	}
	ts.Stop()
	restarted := startTestServer(t, ts.DataDir)
	if read := restarted.getTimeline(p.song.ID); !reflect.DeepEqual(read.Tracks, got.Tracks) {
		t.Errorf("tracks after restart = %+v, want %+v", read.Tracks, got.Tracks)
	}
}

func TestATracksVolumeGoesFromSilenceToPlusSixDecibels(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	trackID := p.tl.Tracks[0].ID

	for _, v := range []float64{-60, 6, 0} {
		got := timelineChange(t, ts.updateTrack(p.song.ID, trackID, map[string]any{"volume": v}))
		if got.Tracks[0].Volume != v {
			t.Errorf("volume = %g, want %g", got.Tracks[0].Volume, v)
		}
	}
	before := ts.getTimeline(p.song.ID)
	for _, v := range []float64{-60.5, 6.01, 12} {
		expectError(t, ts.updateTrack(p.song.ID, trackID, map[string]any{"volume": v}),
			http.StatusBadRequest, "a Track's volume goes from -60 dB (silence) to +6 dB")
	}
	if got := ts.getTimeline(p.song.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", got, before)
	}
	expectStatus(t, ts.updateTrack(p.song.ID, 999, map[string]any{"muted": true}), http.StatusNotFound)
}

// deleteTrack sends a request to delete a Track.
func (ts *testServer) deleteTrack(songID, trackID int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodDelete, trackPath(songID, trackID), nil)
}

// reorderTracks sends a request to put a Song's Tracks in this order, top
// to bottom.
func (ts *testServer) reorderTracks(songID int64, order []int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPut, timelinePath(songID)+"/tracks", map[string]any{"tracks": order})
}

// trackNames lists a Timeline's Tracks, top to bottom.
func trackNames(tl timeline) []string {
	out := []string{}
	for _, tr := range tl.Tracks {
		out = append(out, tr.Name)
	}
	return out
}

func TestTracksCanBeReordered(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	tl := timelineChange(t, ts.addTrack(p.song.ID, "Lead vox"))
	beat, adlibs, lead := tl.Tracks[0].ID, tl.Tracks[1].ID, tl.Tracks[2].ID

	got := timelineChange(t, ts.reorderTracks(p.song.ID, []int64{lead, beat, adlibs}))

	if want := []string{"Lead vox", "Beat", "Adlibs"}; !reflect.DeepEqual(trackNames(got), want) {
		t.Errorf("tracks = %q, want %q", trackNames(got), want)
	}
	if len(got.Tracks[1].Clips) != 2 {
		t.Errorf("beat track clips = %+v, want its Clips to move with it", got.Tracks[1].Clips)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
	added := timelineChange(t, ts.addTrack(p.song.ID, "Harmony"))
	if want := []string{"Lead vox", "Beat", "Adlibs", "Harmony"}; !reflect.DeepEqual(trackNames(added), want) {
		t.Errorf("tracks = %q, want a new Track still added at the bottom: %q", trackNames(added), want)
	}
}

func TestReorderingMustListEveryTrackOnce(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	beat, adlibs := p.tl.Tracks[0].ID, p.tl.Tracks[1].ID
	other := timelineChange(t, ts.addTrack(ts.createSong("Other").ID, "Elsewhere")).Tracks[0].ID

	for name, order := range map[string][]int64{
		"missing one":        {beat},
		"listed twice":       {beat, beat},
		"another song's one": {beat, other},
		"too many":           {beat, adlibs, other},
		"none":               {},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.reorderTracks(p.song.ID, order), http.StatusBadRequest,
				"the new order must list every Track exactly once")
			if got := ts.getTimeline(p.song.ID); !reflect.DeepEqual(got, p.tl) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", got, p.tl)
			}
		})
	}
}

func TestDeletingATrackRemovesItsClipsButKeepsTheirBeats(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	beatTrack, adlibs := p.tl.Tracks[0].ID, p.tl.Tracks[1].ID
	// The long Beat also plays on the other Track, so it's still used after.
	timelineChange(t, ts.moveClip(p.song.ID, p.second, adlibs, 0))
	timelineChange(t, ts.duplicateClip(p.song.ID, p.second))
	tl := timelineChange(t, ts.moveClip(p.song.ID, p.second, beatTrack, 30))
	if len(tl.Tracks[0].Clips) != 2 {
		t.Fatalf("beat track clips = %+v, want both Beats", tl.Tracks[0].Clips)
	}

	got := timelineChange(t, ts.deleteTrack(p.song.ID, beatTrack))

	if want := []string{"Adlibs"}; !reflect.DeepEqual(trackNames(got), want) {
		t.Errorf("tracks = %q, want %q", trackNames(got), want)
	}
	if want := []string{fmt.Sprintf("%d@20+20", p.long.ID)}; !reflect.DeepEqual(clipsOf(got, 0), want) {
		t.Errorf("clips = %q, want the other Track's Clip untouched: %q", clipsOf(got, 0), want)
	}
	if len(got.Beats) != 1 || got.Beats[0].ID != p.long.ID {
		t.Errorf("beats = %+v, want only the Beat still played", got.Beats)
	}
	for _, b := range []beat{p.short, p.long} {
		expectStatus(t, ts.Do(http.MethodGet, beatPath(b.ID)+"/audio", nil), http.StatusOK)
	}
	// No Clip plays the short Beat any more, so it can go.
	expectStatus(t, ts.Do(http.MethodDelete, beatPath(p.short.ID), nil), http.StatusNoContent)
	expectStatus(t, ts.deleteTrack(p.song.ID, beatTrack), http.StatusNotFound)
}

func TestANewBeatAfterTheBeatTrackIsDeletedGoesOnANewBeatTrack(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	timelineChange(t, ts.deleteTrack(p.song.ID, p.tl.Tracks[0].ID))
	got := timelineChange(t, ts.addBeatToSong(p.song.ID, p.short.ID))

	if want := []string{"Adlibs", "Beat"}; !reflect.DeepEqual(trackNames(got), want) {
		t.Errorf("tracks = %q, want %q", trackNames(got), want)
	}
	if want := []string{fmt.Sprintf("%d@0+10", p.short.ID)}; !reflect.DeepEqual(clipsOf(got, 1), want) {
		t.Errorf("clips = %q, want %q", clipsOf(got, 1), want)
	}
}

func loopPath(songID int64) string {
	return timelinePath(songID) + "/loop"
}

// setLoop sends a request to set a Song's Loop.
func (ts *testServer) setLoop(songID int64, body map[string]any) response {
	ts.t.Helper()
	return ts.Do(http.MethodPut, loopPath(songID), body)
}

func TestALoopCanBeSetOverAStretchOfTheTimeline(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.setLoop(p.song.ID, map[string]any{"start": 2.5, "end": 12, "on": true}))

	want := &loop{Start: 2.5, End: 12, On: true}
	if !reflect.DeepEqual(got.Loop, want) {
		t.Errorf("loop = %+v, want %+v", got.Loop, want)
	}
	if !reflect.DeepEqual(got.Tracks, p.tl.Tracks) {
		t.Errorf("tracks = %+v, want them unchanged: %+v", got.Tracks, p.tl.Tracks)
	}
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
}

func TestALoopsStartMustBeBeforeItsEnd(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	before := timelineChange(t, ts.setLoop(p.song.ID, map[string]any{"start": 2, "end": 6, "on": true}))

	for _, stretch := range [][2]float64{{8, 8}, {8, 4}} {
		expectError(t, ts.setLoop(p.song.ID, map[string]any{"start": stretch[0], "end": stretch[1], "on": true}),
			http.StatusBadRequest, "a Loop's start must be before its end")
	}
	expectError(t, ts.setLoop(p.song.ID, map[string]any{"start": -1, "end": 4}),
		http.StatusBadRequest, "a Loop can't start before 0:00")
	expectError(t, ts.setLoop(p.song.ID, map[string]any{"start": 1}),
		http.StatusBadRequest, "start and end are required")

	if got := ts.getTimeline(p.song.ID); !reflect.DeepEqual(got, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", got, before)
	}
}

// switchLoop sends a request to switch a Song's Loop on or off.
func (ts *testServer) switchLoop(songID int64, on bool) response {
	ts.t.Helper()
	return ts.Do(http.MethodPatch, loopPath(songID), map[string]any{"on": on})
}

func TestALoopCanBeSwitchedOnAndOffKeepingItsStretch(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setLoop(p.song.ID, map[string]any{"start": 2, "end": 6}))

	on := timelineChange(t, ts.switchLoop(p.song.ID, true))
	off := timelineChange(t, ts.switchLoop(p.song.ID, false))

	if want := (&loop{Start: 2, End: 6, On: true}); !reflect.DeepEqual(on.Loop, want) {
		t.Errorf("loop switched on = %+v, want %+v", on.Loop, want)
	}
	if want := (&loop{Start: 2, End: 6}); !reflect.DeepEqual(off.Loop, want) {
		t.Errorf("loop switched off = %+v, want %+v", off.Loop, want)
	}
}

func TestAnUnsetLoopCantBeSwitchedOn(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	expectStatus(t, ts.switchLoop(p.song.ID, true), http.StatusNotFound)
	expectError(t, ts.Do(http.MethodPatch, loopPath(p.song.ID), map[string]any{}),
		http.StatusBadRequest, "on is required")

	if got := ts.getTimeline(p.song.ID); !reflect.DeepEqual(got, p.tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", got, p.tl)
	}
}

func TestALoopCanBeCleared(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.setLoop(p.song.ID, map[string]any{"start": 2, "end": 6, "on": true}))

	got := timelineChange(t, ts.Do(http.MethodDelete, loopPath(p.song.ID), nil))

	if got.Loop != nil {
		t.Errorf("loop = %+v, want none", got.Loop)
	}
	if read := ts.getTimeline(p.song.ID); read.Loop != nil {
		t.Errorf("read loop = %+v, want none", read.Loop)
	}
	expectStatus(t, ts.Do(http.MethodDelete, loopPath(p.song.ID), nil), http.StatusNotFound)
}

func TestALoopIsOffUntilSwitchedOnAndIsSavedWithTheSong(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	set := timelineChange(t, ts.setLoop(p.song.ID, map[string]any{"start": 30, "end": 38}))

	if want := (&loop{Start: 30, End: 38}); !reflect.DeepEqual(set.Loop, want) {
		t.Errorf("new loop = %+v, want %+v, off", set.Loop, want)
	}
	got := timelineChange(t, ts.switchLoop(p.song.ID, true))
	ts.Stop()
	restarted := startTestServer(t, ts.DataDir)
	if read := restarted.getTimeline(p.song.ID); !reflect.DeepEqual(read.Loop, got.Loop) {
		t.Errorf("loop after restart = %+v, want %+v", read.Loop, got.Loop)
	}
}
