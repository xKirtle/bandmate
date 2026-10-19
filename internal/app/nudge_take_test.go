package app_test

import (
	"bytes"
	"fmt"
	"math"
	"net/http"
	"reflect"
	"testing"
)

// Nudging a Take moves it by hand within its Clip, on top of its latency
// offset: only its position changes, never the Clip's window. Setting the
// Clip's Takes as they were undoes it. Downloading a Take gives its file as
// recorded, named after the Song and the Take.

func (ts *testServer) nudgeTake(songID, clipID, takeID int64, nudge float64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPut, fmt.Sprintf("%s/%d/nudge", clipTakesPath(songID, clipID), takeID),
		map[string]any{"nudge": nudge})
}

// near tells whether two times are the same, give or take rounding.
func near(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func TestANudgeIsUndoneAndRedoneExactly(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	nudged := timelineChange(t, ts.nudgeTake(r.song.ID, c.ID, c.Takes[2].ID, -0.25)).Tracks[1].Clips[0]

	undone := timelineChange(t, ts.setTakes(r.song.ID, c.ID, takesAsIn(c))).Tracks[1].Clips[0]
	if !reflect.DeepEqual(undone, c) {
		t.Errorf("clip = %+v, want it as before the nudge: %+v", undone, c)
	}
	redone := timelineChange(t, ts.nudgeTake(r.song.ID, c.ID, c.Takes[2].ID, -0.25)).Tracks[1].Clips[0]
	if !reflect.DeepEqual(redone, nudged) {
		t.Errorf("clip = %+v, want it as nudged: %+v", redone, nudged)
	}
	// Setting it as nudged gives it back its nudge too.
	timelineChange(t, ts.setTakes(r.song.ID, c.ID, takesAsIn(c)))
	again := timelineChange(t, ts.setTakes(r.song.ID, c.ID, takesAsIn(nudged))).Tracks[1].Clips[0]
	if !reflect.DeepEqual(again, nudged) {
		t.Errorf("clip = %+v, want it as nudged: %+v", again, nudged)
	}
}

func TestNudgingATakeFollowsItsRules(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	other := timelineChange(t, ts.recordTake(r.song.ID, takeRecording(r.vox.ID, 10, 10, 0, 2))).Tracks[1].Clips[1]
	beatClip := r.tl.Tracks[0].Clips[0].ID
	// Nudged later and trimmed to its end: the Clip the other rules are
	// tried on, a Take's worth of Timeline away from where it started.
	timelineChange(t, ts.nudgeTake(r.song.ID, r.clip.ID, r.take.ID, 1))
	before := timelineChange(t, ts.trimClip(r.song.ID, r.clip.ID, 0.5, 4.5))

	for name, c := range map[string]struct {
		res    response
		status int
		msg    string
	}{
		"not a number": {ts.Do(http.MethodPut, fmt.Sprintf("%s/%d/nudge", clipTakesPath(r.song.ID, r.clip.ID), r.take.ID),
			map[string]any{"nudge": "soon"}), http.StatusBadRequest, ""},
		"another Clip's Take": {ts.nudgeTake(r.song.ID, r.clip.ID, other.Takes[0].ID, 0.1), http.StatusNotFound, ""},
		"of a Clip of a Beat": {ts.nudgeTake(r.song.ID, beatClip, r.take.ID, 0.1), http.StatusBadRequest,
			"only a Clip of Takes has Takes"},
		"an unknown Clip": {ts.nudgeTake(r.song.ID, 999, r.take.ID, 0.1), http.StatusNotFound, ""},
	} {
		t.Run(name, func(t *testing.T) {
			if c.msg == "" {
				expectStatus(t, c.res, c.status)
			} else {
				expectError(t, c.res, c.status, c.msg)
			}
		})
	}
	expectStale(t, ts.DoAt(r.tl.Version, http.MethodPut,
		fmt.Sprintf("%s/%d/nudge", clipTakesPath(r.song.ID, r.clip.ID), r.take.ID), map[string]any{"nudge": 0.5}))
	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
	}
}

// A Take nudged earlier out from under its Clip's end leaves the Clip
// playing silence there, rather than being refused: the shape a Clip
// trimmed out to a Take nudged later is in (ADR 0023).
func TestATakeNudgesEarlierOutFromUnderItsClipsEnd(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	// Nudged a second later and trimmed out to reach it, the Clip plays
	// 0:00.5 to 0:05 of a span its Take ends 0:05 into.
	timelineChange(t, ts.nudgeTake(r.song.ID, r.clip.ID, r.take.ID, 1))
	out := timelineChange(t, ts.trimClip(r.song.ID, r.clip.ID, 0.5, 4.5)).Tracks[1].Clips[0]

	back := timelineChange(t, ts.nudgeTake(r.song.ID, r.clip.ID, r.take.ID, 0)).Tracks[1].Clips[0]

	// The Take is where it was recorded, and the Clip's window hasn't moved,
	// though its Take no longer reaches its end.
	if tk := back.Takes[0]; !near(tk.Nudge, 0) || !near(tk.Position, 0) {
		t.Errorf("take = %+v, want it back where it was recorded", tk)
	}
	if back.Start != out.Start || back.Offset != out.Offset || back.Length != out.Length {
		t.Errorf("clip = %+v, want its window as it was: %+v", back, out)
	}
	// And on past where it was recorded, which takes its span back as ever.
	earlier := timelineChange(t, ts.nudgeTake(r.song.ID, r.clip.ID, r.take.ID, -0.25)).Tracks[1].Clips[0]
	if tk := earlier.Takes[0]; !near(tk.Nudge, -0.25) || !near(tk.Position, 0) {
		t.Errorf("take = %+v, want it nudged a quarter second earlier", tk)
	}
	if earlier.Start != out.Start || !near(earlier.Offset, out.Offset+0.25) || earlier.Length != out.Length {
		t.Errorf("clip = %+v, want its span taken back under its window: %+v", earlier, out)
	}
	// Setting its Takes back, as an undo does, puts the Clip back as it was.
	undone := timelineChange(t, ts.setTakes(r.song.ID, r.clip.ID, takesAsIn(out))).Tracks[1].Clips[0]
	if !reflect.DeepEqual(undone, out) {
		t.Errorf("clip = %+v, want it as before the nudge: %+v", undone, out)
	}
}

func TestADuplicatedTakeKeepsItsNudge(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	timelineChange(t, ts.nudgeTake(r.song.ID, r.clip.ID, r.take.ID, -0.25))

	got := timelineChange(t, ts.duplicateClip(r.song.ID, r.clip.ID))

	if tk := got.Tracks[1].Clips[1].Takes[0]; tk.Nudge != -0.25 {
		t.Errorf("copy = %+v, want it nudged as the original is", tk)
	}
}

func TestADownloadedTakeIsItsFileAsRecordedNamedAfterTheSongAndTake(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	// Nudged and trimmed, it's still downloaded whole, as recorded.
	timelineChange(t, ts.nudgeTake(r.song.ID, c.ID, c.Takes[0].ID, 0.25))
	timelineChange(t, ts.trimClip(r.song.ID, c.ID, c.Offset+0.5, c.Length-0.5))
	path := takePath(r.song.ID, c.Takes[0].ID) + "/audio"

	download := ts.Do(http.MethodGet, path+"?download", nil)

	expectStatus(t, download, http.StatusOK)
	if !bytes.Equal(download.Body, r.audio) || download.Header.Get("Content-Type") != "audio/wav" {
		t.Errorf("download = %d bytes of %s, want the %d bytes recorded as audio/wav",
			len(download.Body), download.Header.Get("Content-Type"), len(r.audio))
	}
	if got, want := download.Header.Get("Content-Disposition"), `attachment; filename="Night Drive - Take 1.wav"`; got != want {
		t.Errorf("Content-Disposition = %q, want %q", got, want)
	}
	ranged := ts.DoRaw(http.MethodGet, path+"?download", http.Header{"Range": {"bytes=4-11"}}, nil)
	expectStatus(t, ranged, http.StatusPartialContent)
	if !bytes.Equal(ranged.Body, r.audio[4:12]) {
		t.Errorf("range = %q, want %q", ranged.Body, r.audio[4:12])
	}
	if got := ts.Do(http.MethodGet, path, nil).Header.Get("Content-Disposition"); got != "" {
		t.Errorf("Content-Disposition = %q, want none so it plays", got)
	}
	expectStatus(t, ts.Do(http.MethodGet, takePath(ts.createSong("Other").ID, c.Takes[0].ID)+"/audio?download", nil),
		http.StatusNotFound)
}

// A title that names a folder is no path: its slashes become dashes.
func TestADownloadedTakeIsNamedWithTheSongsTitleAsItIs(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	ts.updateSong(r.song.ID, map[string]any{"title": "Café / Noir"})

	download := ts.Do(http.MethodGet, takePath(r.song.ID, r.take.ID)+"/audio?download", nil)

	expectStatus(t, download, http.StatusOK)
	if got, want := download.Header.Get("Content-Disposition"), `attachment; filename*=utf-8''Caf%C3%A9%20-%20Noir%20-%20Take%201.wav`; got != want {
		t.Errorf("Content-Disposition = %q, want %q", got, want)
	}
}
