package app_test

import (
	"bytes"
	"math"
	"net/http"
	"reflect"
	"testing"
)

// A Clip's Nudge moves its audio by hand inside it, on top of the latency
// offset its Takes were placed by: only the Nudge changes, never the Clip's
// window, and it's there for a Clip of Takes, of a Beat and of a Sound
// alike (ADR 0028). Setting it back undoes it.

// setClipNudge sends a request to move a Clip's audio inside it, in seconds.
func (ts *testServer) setClipNudge(songID, clipID int64, nudge float64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPut, clipPath(songID, clipID)+"/nudge", map[string]any{"nudge": nudge})
}

// near tells whether two times are the same, give or take rounding.
func near(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func TestAClipsNudgeIsZeroUntilSetAndMovesNothingElse(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	if c.Nudge != 0 {
		t.Errorf("clip = %+v, want it unnudged", c)
	}

	got := timelineChange(t, ts.setClipNudge(r.song.ID, c.ID, -0.25)).Tracks[1].Clips[0]

	if !near(got.Nudge, -0.25) {
		t.Errorf("nudge = %v, want -0.25", got.Nudge)
	}
	// The Clip keeps its window, and its Takes stay where they were
	// recorded: only the audio the Clip plays moves.
	if got.Start != c.Start || got.Offset != c.Offset || got.Length != c.Length {
		t.Errorf("clip = %+v, want its window as it was: %+v", got, c)
	}
	if !reflect.DeepEqual(got.Takes, c.Takes) {
		t.Errorf("takes = %+v, want them as they were: %+v", got.Takes, c.Takes)
	}
}

// A Nudge is the Clip's, whatever it plays, so a Clip of a Beat has one as
// a Clip of Takes does.
func TestEveryKindOfClipIsNudged(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	beatClip := r.tl.Tracks[0].Clips[0]

	nudged := timelineChange(t, ts.setClipNudge(r.song.ID, beatClip.ID, 0.75)).Tracks[0].Clips[0]

	if !near(nudged.Nudge, 0.75) {
		t.Errorf("nudge = %v, want 0.75", nudged.Nudge)
	}
	if nudged.Start != beatClip.Start || nudged.Offset != beatClip.Offset || nudged.Length != beatClip.Length {
		t.Errorf("clip = %+v, want its window as it was: %+v", nudged, beatClip)
	}
}

func TestANudgeIsUndoneAndRedoneExactly(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	nudged := timelineChange(t, ts.setClipNudge(r.song.ID, c.ID, -0.25)).Tracks[1].Clips[0]

	undone := timelineChange(t, ts.setClipNudge(r.song.ID, c.ID, c.Nudge)).Tracks[1].Clips[0]
	if !reflect.DeepEqual(undone, c) {
		t.Errorf("clip = %+v, want it as before the nudge: %+v", undone, c)
	}
	redone := timelineChange(t, ts.setClipNudge(r.song.ID, c.ID, -0.25)).Tracks[1].Clips[0]
	if !reflect.DeepEqual(redone, nudged) {
		t.Errorf("clip = %+v, want it as nudged: %+v", redone, nudged)
	}
}

// nudgedOutAndTrimmedToIt nudges a recording's Clip a second later and
// trims it out to reach its Take there, so the Clip plays 0:00.5 to 0:05 of
// a span its Take ends 0:04 into: the shape the rules are tried in.
func nudgedOutAndTrimmedToIt(t *testing.T, ts *testServer, r recordedTake) timeline {
	t.Helper()
	timelineChange(t, ts.setClipNudge(r.song.ID, r.clip.ID, 1))
	return timelineChange(t, ts.trimClip(r.song.ID, r.clip.ID, 0.5, 4.5))
}

func TestNudgingAClipFollowsItsRules(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	before := nudgedOutAndTrimmedToIt(t, ts, r)
	other := ts.createSong("Other")

	for name, c := range map[string]struct {
		res    response
		status int
		msg    string
	}{
		"not a number": {ts.Do(http.MethodPut, clipPath(r.song.ID, r.clip.ID)+"/nudge",
			map[string]any{"nudge": "soon"}), http.StatusBadRequest, ""},
		"none given": {ts.Do(http.MethodPut, clipPath(r.song.ID, r.clip.ID)+"/nudge",
			map[string]any{}), http.StatusBadRequest, "nudge is required"},
		"an unknown Clip":     {ts.setClipNudge(r.song.ID, 999, 0.1), http.StatusNotFound, ""},
		"another Song's Clip": {ts.setClipNudge(other.ID, r.clip.ID, 0.1), http.StatusNotFound, ""},
	} {
		t.Run(name, func(t *testing.T) {
			if c.msg == "" {
				expectStatus(t, c.res, c.status)
			} else {
				expectError(t, c.res, c.status, c.msg)
			}
		})
	}
	expectStale(t, ts.DoAt(r.tl.Version, http.MethodPut, clipPath(r.song.ID, r.clip.ID)+"/nudge",
		map[string]any{"nudge": 0.5}))
	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
	}
}

// A Clip's audio nudged earlier out from under its end leaves it playing
// silence there, rather than being refused, and the Clip keeps its window
// whichever way its audio goes (ADR 0023).
func TestAClipsAudioNudgesEarlierOutFromUnderItsEnd(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	out := nudgedOutAndTrimmedToIt(t, ts, r).Tracks[1].Clips[0]

	back := timelineChange(t, ts.setClipNudge(r.song.ID, r.clip.ID, 0)).Tracks[1].Clips[0]

	if !near(back.Nudge, 0) || !near(back.Takes[0].Position, 0) {
		t.Errorf("clip = %+v, want its audio back where it was recorded", back)
	}
	if back.Start != out.Start || back.Offset != out.Offset || back.Length != out.Length {
		t.Errorf("clip = %+v, want its window as it was: %+v", back, out)
	}
	// And on past where it was recorded, the window still staying put:
	// nothing is taken back for it.
	earlier := timelineChange(t, ts.setClipNudge(r.song.ID, r.clip.ID, -0.25)).Tracks[1].Clips[0]
	if !near(earlier.Nudge, -0.25) || !near(earlier.Takes[0].Position, 0) {
		t.Errorf("clip = %+v, want its audio a quarter second earlier", earlier)
	}
	if earlier.Start != out.Start || !near(earlier.Offset, out.Offset) || earlier.Length != out.Length {
		t.Errorf("clip = %+v, want its window as it was: %+v", earlier, out)
	}
}

// A Nudge travels with a Clip as its Gain, Tempo and Pitch do: carried by a
// Duplicate and by both halves of a Split, and inherited by a Retake.
func TestADuplicateAndBothHalvesOfASplitKeepTheNudge(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	timelineChange(t, ts.setClipNudge(r.song.ID, r.clip.ID, -0.25))

	copied := timelineChange(t, ts.duplicateClip(r.song.ID, r.clip.ID)).Tracks[1].Clips[1]
	if !near(copied.Nudge, -0.25) {
		t.Errorf("copy = %+v, want it nudged as the original is", copied)
	}

	halves := timelineChange(t, ts.splitClips(r.song.ID, 3.5, r.clip.ID)).Tracks[1].Clips
	if len(halves) != 3 || !near(halves[0].Nudge, -0.25) || !near(halves[1].Nudge, -0.25) {
		t.Errorf("halves = %+v, want both nudged as the Clip was", halves)
	}
}

func TestARetakeInheritsItsClipsNudge(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	timelineChange(t, ts.setClipNudge(r.song.ID, r.clip.ID, 0.3))

	got := timelineChange(t, ts.retake(r.song.ID, r.clip.ID, retakeUpload(0, 0, 3))).Tracks[1].Clips[0]

	if !near(got.Nudge, 0.3) {
		t.Errorf("clip = %+v, want the Nudge it had, which the new Take wants too", got)
	}
}

func TestADownloadedTakeIsItsFileAsRecordedNamedAfterTheSongAndTake(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	// Nudged and trimmed, it's still downloaded whole, as recorded.
	timelineChange(t, ts.setClipNudge(r.song.ID, c.ID, 0.25))
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
