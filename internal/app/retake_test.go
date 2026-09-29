package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// A Retake records another Take into a Clip of Takes, from its start with
// the same lead-in as recording: it gets the next number, becomes the
// active Take, and the Clip grows to fit it, up to the next Clip. Setting a
// Clip's Takes back as they were is how undo and redo work.

// retakeUpload is a Take lasting seconds, sung into a Clip, with
// capture from captureStart and the latency offset taken off.
func retakeUpload(captureStart, latency, seconds float64) audioUpload {
	return audioUpload{
		FileName:    "take.wav",
		ContentType: "audio/wav",
		Data:        wavFile(seconds, 1, 24),
		Details: map[string]any{
			"captureStart": captureStart, "latencyOffset": latency, "peaks": []float64{0.5, 1},
		},
	}
}

func clipTakesPath(songID, clipID int64) string {
	return clipPath(songID, clipID) + "/takes"
}

// retake sends a Take recorded into a Clip.
func (ts *testServer) retake(songID, clipID int64, u audioUpload) response {
	ts.t.Helper()
	return ts.SendUpload(http.MethodPost, clipTakesPath(songID, clipID), u)
}

// takesOf is how a Clip of Takes is to be set: its Takes, each where it
// starts in the Clip's source span, the one it plays, and its placement.
type takesOf struct {
	Takes        []takeAt `json:"takes"`
	ActiveTakeID int64    `json:"activeTakeId"`
	Start        float64  `json:"start"`
	Offset       float64  `json:"offset"`
	Length       float64  `json:"length"`
}

type takeAt struct {
	ID       int64   `json:"id"`
	Position float64 `json:"position"`
	Nudge    float64 `json:"nudge"`
}

// takesAsIn is how a Clip's Takes are set in c.
func takesAsIn(c clip) takesOf {
	s := takesOf{ActiveTakeID: *c.ActiveTakeID, Start: c.Start, Offset: c.Offset, Length: c.Length}
	for _, tk := range c.Takes {
		s.Takes = append(s.Takes, takeAt{tk.ID, tk.Position, tk.Nudge})
	}
	return s
}

// setTakes sends a request to set a Clip's Takes.
func (ts *testServer) setTakes(songID, clipID int64, s takesOf) response {
	ts.t.Helper()
	return ts.Do(http.MethodPut, clipTakesPath(songID, clipID), s)
}

// numbers lists a Clip's Takes' numbers, the active one starred.
func numbers(c clip) string {
	s := ""
	for _, tk := range c.Takes {
		s += fmt.Sprint(tk.Number)
		if tk.ID == *c.ActiveTakeID {
			s += "*"
		}
		s += " "
	}
	return s
}

func TestARetakeAddsTheNextTakeActiveAndGrowsTheClipToFitIt(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	// The Clip shows 0:02 to 0:05 of a Take from 0:01.5 to 0:05.5. The
	// Retake leads in from 0:00, and was sung 0.25s before the mic heard it,
	// so it runs from -0:00.25 to 0:06.75.
	upload := retakeUpload(0, 0.25, 7)

	got := timelineChange(t, ts.retake(r.song.ID, r.clip.ID, upload))

	c := got.Tracks[1].Clips[0]
	// Its source span now starts where the Retake does, 2.25s before the
	// Clip, which still starts at 0:02 and now plays to the Retake's end.
	if at := clipAt(got, r.clip.ID); at != "1:2+4.75@2.25" {
		t.Errorf("clip = %s, want it at 0:02 to 0:06.75, 2.25s into its source", at)
	}
	if len(c.Takes) != 2 {
		t.Fatalf("takes = %+v, want the first and the Retake", c.Takes)
	}
	first, tk := c.Takes[0], c.Takes[1]
	if want := r.take; first.ID != want.ID || first.Position != 1.75 || first.Number != 1 {
		t.Errorf("first take = %+v, want it where it was on the Timeline, 1.75s into the span", first)
	}
	want := take{ID: tk.ID, Number: 2, Size: int64(len(upload.Data)), Duration: 7, SampleRate: wavRate,
		LatencyOffset: 0.25, Position: 0, RecordedAt: tk.RecordedAt}
	if !reflect.DeepEqual(tk, want) || *c.ActiveTakeID != tk.ID {
		t.Errorf("retake = %+v, active %d; want %+v, active", tk, *c.ActiveTakeID, want)
	}
	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
	served := ts.Do(http.MethodGet, takePath(r.song.ID, tk.ID)+"/audio", nil)
	expectStatus(t, served, http.StatusOK)
	if string(served.Body) != string(upload.Data) {
		t.Errorf("the Retake's audio differs from what was uploaded")
	}
}

func TestAShortRetakeLeavesTheClipsLengthAlone(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)

	got := timelineChange(t, ts.retake(r.song.ID, r.clip.ID, retakeUpload(0, 0, 3)))

	if at := clipAt(got, r.clip.ID); at != "1:2+3@2" {
		t.Errorf("clip = %s, want it still at 0:02 to 0:05", at)
	}
}

func TestARetakeGrowsItsClipOnlyUpToTheNextClip(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	dup := timelineChange(t, ts.duplicateClip(r.song.ID, r.clip.ID)).Tracks[1].Clips[1]
	timelineChange(t, ts.moveClip(r.song.ID, dup.ID, r.vox.ID, 6))

	got := timelineChange(t, ts.retake(r.song.ID, r.clip.ID, retakeUpload(0, 0, 10)))

	// The Retake runs to 0:10, but the next Clip starts at 0:06.
	if at := clipAt(got, r.clip.ID); at != "1:2+4@2" {
		t.Errorf("clip = %s, want it grown to the next Clip at 0:06", at)
	}
	// Once there's room, the rest can be trimmed into view.
	timelineChange(t, ts.deleteClip(r.song.ID, dup.ID))
	got = timelineChange(t, ts.trimClip(r.song.ID, r.clip.ID, 2, 8))
	if at := clipAt(got, r.clip.ID); at != "1:2+8@2" {
		t.Errorf("clip = %s, want the Retake's overrun showing to 0:10", at)
	}
}

func TestTakeNumbersAreNeverReused(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	id := r.clip.ID
	retakeOnce := func() clip {
		t.Helper()
		return timelineChange(t, ts.retake(r.song.ID, id, retakeUpload(0, 0, 3))).Tracks[1].Clips[0]
	}
	retakeOnce()
	c := retakeOnce()
	if got := numbers(c); got != "1 2 3* " {
		t.Fatalf("takes = %s, want 1 2 3*", got)
	}

	// Take 3 leaves the Clip, as undoing it does, but its number stays used.
	undone := takesAsIn(c)
	undone.Takes, undone.ActiveTakeID = undone.Takes[:2], c.Takes[0].ID
	timelineChange(t, ts.setTakes(r.song.ID, id, undone))
	if got := numbers(retakeOnce()); got != "1 2 4* " {
		t.Errorf("takes = %s, want the next Take numbered 4", got)
	}

	// So does a Clip placed back from its Takes, told the last number used.
	c = ts.getTimeline(r.song.ID).Tracks[1].Clips[0]
	timelineChange(t, ts.deleteClip(r.song.ID, id))
	back := timelineChange(t, ts.placeClip(r.song.ID, map[string]any{
		"trackId": r.vox.ID, "takeIds": []int64{c.Takes[0].ID}, "activeTakeId": c.Takes[0].ID,
		"start": c.Start, "offset": c.Offset, "length": c.Length, "lastTakeNumber": 4,
	}))
	id = back.Tracks[1].Clips[0].ID
	if got := numbers(retakeOnce()); got != "1 5* " {
		t.Errorf("takes = %s, want the next Take numbered 5", got)
	}

	// And a copy of the Clip.
	dup := timelineChange(t, ts.duplicateClip(r.song.ID, id)).Tracks[1].Clips[1]
	got := timelineChange(t, ts.retake(r.song.ID, dup.ID, retakeUpload(dup.Start-2, 0, 3)))
	if got := numbers(got.Tracks[1].Clips[1]); got != "1 5 6* " {
		t.Errorf("copy's takes = %s, want the next Take numbered 6", got)
	}
}

func TestARetakeIsUndoneAndRedoneBySettingTheClipsTakes(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	after := timelineChange(t, ts.retake(r.song.ID, r.clip.ID, retakeUpload(0, 0.25, 7)))
	retaken := after.Tracks[1].Clips[0]

	undone := timelineChange(t, ts.setTakes(r.song.ID, r.clip.ID, takesAsIn(r.clip)))

	if c := undone.Tracks[1].Clips[0]; !reflect.DeepEqual(c, r.clip) {
		t.Errorf("clip = %+v, want it as before the Retake: %+v", c, r.clip)
	}
	redone := timelineChange(t, ts.setTakes(r.song.ID, r.clip.ID, takesAsIn(retaken)))
	if c := redone.Tracks[1].Clips[0]; !reflect.DeepEqual(c, retaken) {
		t.Errorf("clip = %+v, want it as after the Retake: %+v", c, retaken)
	}
}

func TestARetakeFollowsItsRulesAndKeepsNothingWhenRefused(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	beatClip := r.tl.Tracks[0].Clips[0].ID
	timelineChange(t, ts.retake(r.song.ID, r.clip.ID, retakeUpload(0, 0, 3)))
	before := ts.getTimeline(r.song.ID)
	files := takeFiles(t, ts)

	for name, c := range map[string]struct {
		res    response
		status int
		msg    string
	}{
		"into a Clip of a Beat": {ts.retake(r.song.ID, beatClip, retakeUpload(0, 0, 3)),
			http.StatusBadRequest, "only a Clip of Takes can be retaken"},
		"ending before the Clip starts": {ts.retake(r.song.ID, r.clip.ID, retakeUpload(0, 0, 1.5)),
			http.StatusBadRequest, "the Take ended before its Clip's start"},
		"with a negative latency offset": {ts.retake(r.song.ID, r.clip.ID, retakeUpload(0, -1, 3)),
			http.StatusBadRequest, "a latency offset can't be negative"},
		"in stereo": {ts.retake(r.song.ID, r.clip.ID, audioUpload{FileName: "take.wav", ContentType: "audio/wav",
			Data: wavFile(3, 2, 24), Details: retakeUpload(0, 0, 3).Details}),
			http.StatusBadRequest, "a Take must be a mono 24-bit WAV file"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, c.res, c.status, c.msg)
		})
	}
	expectStatus(t, ts.retake(r.song.ID, 999, retakeUpload(0, 0, 3)), http.StatusNotFound)
	expectStale(t, ts.SendUploadAt(r.tl.Version, http.MethodPost, clipTakesPath(r.song.ID, r.clip.ID),
		retakeUpload(0, 0, 3)))

	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
	}
	if got := takeFiles(t, ts); !reflect.DeepEqual(got, files) {
		t.Errorf("take files = %q, want only those kept before: %q", got, files)
	}
}

func TestSettingAClipsTakesFollowsTheirRules(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	other := timelineChange(t, ts.recordTake(r.song.ID, takeRecording(r.vox.ID, 10, 10, 0, 2))).Tracks[1].Clips[1]
	beatClip := r.tl.Tracks[0].Clips[0].ID
	before := ts.getTimeline(r.song.ID)
	with := func(change func(s *takesOf)) takesOf {
		s := takesAsIn(r.clip)
		change(&s)
		return s
	}

	for name, c := range map[string]struct {
		res    response
		status int
		msg    string
	}{
		"with no Takes": {ts.setTakes(r.song.ID, r.clip.ID, with(func(s *takesOf) { s.Takes = nil })),
			http.StatusBadRequest, "a Clip of Takes plays one of them"},
		"playing none of them": {ts.setTakes(r.song.ID, r.clip.ID, with(func(s *takesOf) { s.ActiveTakeID = 999 })),
			http.StatusBadRequest, "a Clip of Takes plays one of them"},
		"a Take twice": {ts.setTakes(r.song.ID, r.clip.ID, with(func(s *takesOf) { s.Takes = append(s.Takes, s.Takes[0]) })),
			http.StatusBadRequest, "a Take can only be in a Clip once"},
		"another Clip's Take": {ts.setTakes(r.song.ID, r.clip.ID, with(func(s *takesOf) {
			s.Takes = append(s.Takes, takeAt{ID: other.Takes[0].ID})
		})), http.StatusConflict, "a Take can only be in one Clip"},
		"an unknown Take": {ts.setTakes(r.song.ID, r.clip.ID, with(func(s *takesOf) { s.Takes = append(s.Takes, takeAt{ID: 999}) })),
			http.StatusBadRequest, "there's no such Take in this Song"},
		"a Take before the span": {ts.setTakes(r.song.ID, r.clip.ID, with(func(s *takesOf) { s.Takes[0].Position = -1 })),
			http.StatusBadRequest, "a Take can't start before its Clip's source"},
		"past the Takes' end": {ts.setTakes(r.song.ID, r.clip.ID, with(func(s *takesOf) { s.Length = 4 })),
			http.StatusBadRequest, "a Clip can't play past the end of its source"},
		"into a neighbour": {ts.setTakes(r.song.ID, r.clip.ID, with(func(s *takesOf) { s.Start = 8 })),
			http.StatusConflict, "Clips can't overlap on a Track"},
		"of a Clip of a Beat": {ts.setTakes(r.song.ID, beatClip, takesAsIn(r.clip)),
			http.StatusBadRequest, "only a Clip of Takes has Takes"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, c.res, c.status, c.msg)
		})
	}
	expectStatus(t, ts.setTakes(r.song.ID, 999, takesAsIn(r.clip)), http.StatusNotFound)
	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
	}
}
