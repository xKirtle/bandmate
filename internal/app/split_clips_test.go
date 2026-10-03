package app_test

import (
	"bytes"
	"net/http"
	"testing"
)

// A Split cuts Clips in two at a time on the Timeline, the playhead: the
// left half is the Clip, ending at the cut, and the right half a new Clip
// from the cut on, so playing across the cut is as before.

// splitClips sends a request to split Clips at a time.
func (ts *testServer) splitClips(songID int64, at float64, clipIDs ...int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/clips/split", map[string]any{"clipIds": clipIDs, "at": at})
}

func TestSplittingAClipCutsItInTwoAtTheTimeGiven(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	timelineChange(t, ts.renameClip(p.song.ID, p.second, "Hook"))
	timelineChange(t, ts.setClipGain(p.song.ID, p.second, -3))
	timelineChange(t, ts.trimClip(p.song.ID, p.second, 2, 16))
	// Long now plays 0:32 to 0:48, from 2 s into its Beat.
	timelineChange(t, ts.setClipFades(p.song.ID, p.second, 4, 3))

	got := timelineChange(t, ts.splitClips(p.song.ID, 40, p.second))

	clips := got.Tracks[0].Clips
	if len(clips) != 3 {
		t.Fatalf("clips = %+v, want the first, and the second in two", clips)
	}
	left, right := clips[1], clips[2]
	if left.ID != p.second {
		t.Errorf("left half = %+v, want the Clip split", left)
	}
	if at := clipAt(got, left.ID); at != "0:32+8@2" {
		t.Errorf("left half = %s, want 0:32 to the cut at 0:40, from 2 s in", at)
	}
	if at := clipAt(got, right.ID); at != "0:40+8@10" {
		t.Errorf("right half = %s, want the cut at 0:40 to 0:48, from 10 s in", at)
	}
	for _, half := range []clip{left, right} {
		if half.BeatID != p.long.ID || nameOf(half) != "Hook" || half.Gain != -3 {
			t.Errorf("half = %+v, want the Clip's Beat, name and Gain", half)
		}
	}
	if f := fadesOf(left); f != [2]float64{4, 0} {
		t.Errorf("left half's fades = %v, want the fade in and none at the cut", f)
	}
	if f := fadesOf(right); f != [2]float64{0, 3} {
		t.Errorf("right half's fades = %v, want none at the cut and the fade out", f)
	}
}

func TestASplitShortensAFadeThatRunsPastTheCutToEndThere(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	// The first Clip plays 0:00 to 0:10.
	timelineChange(t, ts.setClipFades(p.song.ID, p.first, 6, 3))

	got := timelineChange(t, ts.splitClips(p.song.ID, 2, p.first))

	clips := got.Tracks[0].Clips
	if f := fadesOf(clips[0]); f != [2]float64{2, 0} {
		t.Errorf("left half's fades = %v, want the fade in shortened to the cut, [2 0]", f)
	}
	if f := fadesOf(clips[1]); f != [2]float64{0, 3} {
		t.Errorf("right half's fades = %v, want [0 3]", f)
	}
	got = timelineChange(t, ts.splitClips(p.song.ID, 9, clips[1].ID))
	if f := fadesOf(got.Tracks[0].Clips[2]); f != [2]float64{0, 1} {
		t.Errorf("last half's fades = %v, want the fade out shortened to the cut, [0 1]", f)
	}
}

func TestSplittingSeveralClipsSplitsEachAsOneChange(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	// One on each Track across 0:05.
	tl := timelineChange(t, ts.addBeatToTrack(p.song.ID, p.tl.Tracks[1].ID, p.short.ID))
	other := tl.Tracks[1].Clips[0].ID
	version := tl.Version

	got := timelineChange(t, ts.splitClips(p.song.ID, 5, p.first, other))

	if got.Version != version+1 {
		t.Errorf("version = %d, want one change after %d", got.Version, version)
	}
	for i, tr := range got.Tracks {
		if len(tr.Clips) < 2 || clipAt(got, tr.Clips[0].ID)[2:] != "0+5@0" || clipAt(got, tr.Clips[1].ID)[2:] != "5+5@5" {
			t.Errorf("track %d clips = %+v, want its Clip cut at 0:05", i, tr.Clips)
		}
	}
}

func TestOnlyAClipThePlayheadCrossesCanBeSplit(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	// The first Clip plays 0:00 to 0:10, and the second 0:30 to 0:50.
	for _, at := range []float64{0, 10, 20, -1} {
		expectError(t, ts.splitClips(p.song.ID, at, p.first), http.StatusBadRequest,
			"a Clip is only split where the playhead crosses it")
	}
	expectError(t, ts.splitClips(p.song.ID, 5, p.first, p.second), http.StatusBadRequest,
		"a Clip is only split where the playhead crosses it")
	expectError(t, ts.splitClips(p.song.ID, 5, p.first, p.first), http.StatusBadRequest,
		"each Clip can only be split once")
	expectError(t, ts.splitClips(p.song.ID, 5), http.StatusBadRequest, "clipIds are required")
	expectStatus(t, ts.splitClips(p.song.ID, 5, 9999), http.StatusNotFound)
	if got := ts.getTimeline(p.song.ID); len(got.Tracks[0].Clips) != 2 {
		t.Errorf("clips = %+v, want none split", got.Tracks[0].Clips)
	}
}

func TestASplitClipOfTakesGivesEachHalfTakesOfItsOwn(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	// Take 2 is active, so it isn't only the last that's kept.
	timelineChange(t, ts.chooseTake(r.song.ID, c.ID, c.Takes[1].ID))

	// The Clip plays 0:02 to 0:06.
	got := timelineChange(t, ts.splitClips(r.song.ID, 3.5, c.ID))

	clips := got.Tracks[1].Clips
	if len(clips) != 2 {
		t.Fatalf("clips = %+v, want the Clip in two", clips)
	}
	left, right := clips[0], clips[1]
	if numbers(left) != "1 2* 3 " || numbers(right) != "1 2* 3 " {
		t.Errorf("takes = %s and %s, want both 1 2* 3", numbers(left), numbers(right))
	}
	for i, tk := range right.Takes {
		was := left.Takes[i]
		if tk.ID == was.ID || tk.Position != was.Position || tk.Nudge != was.Nudge || tk.Size != was.Size {
			t.Errorf("right half's take = %+v, want a copy of %+v", tk, was)
		}
	}
	served := ts.Do(http.MethodGet, takePath(r.song.ID, right.Takes[0].ID)+"/audio", nil)
	if !bytes.Equal(served.Body, r.audio) {
		t.Errorf("the right half's Take 1 isn't the same audio")
	}
	if at := clipAt(got, left.ID); at != "1:2+1.5@2" {
		t.Errorf("left half = %s, want 0:02 to 0:03.5", at)
	}
	if at := clipAt(got, right.ID); at != "1:3.5+2.5@3.5" {
		t.Errorf("right half = %s, want 0:03.5 to 0:06", at)
	}
	// A Retake into one leaves the other's Takes be.
	after := timelineChange(t, ts.retake(r.song.ID, right.ID, retakeUpload(3, 0, 3)))
	if got := numbers(clipByID(t, after, left.ID)); got != "1 2* 3 " {
		t.Errorf("left half's takes after a Retake into the right = %s, want 1 2* 3", got)
	}
}

func TestASplitIsUndoneByReplacingTheHalvesWithTheClip(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	split := timelineChange(t, ts.splitClips(r.song.ID, 3.5, c.ID))
	left, right := split.Tracks[1].Clips[0], split.Tracks[1].Clips[1]

	takeIDs := []int64{}
	for _, tk := range c.Takes {
		takeIDs = append(takeIDs, tk.ID)
	}
	got := timelineChange(t, ts.replaceClips(r.song.ID, []int64{left.ID, right.ID}, map[string]any{
		"trackId": r.vox.ID, "takeIds": takeIDs, "activeTakeId": *c.ActiveTakeID,
		"start": c.Start, "offset": c.Offset, "length": c.Length,
	}))

	clips := got.Tracks[1].Clips
	if len(clips) != 1 || clipAt(got, clips[0].ID) != "1:2+4@2" {
		t.Fatalf("clips = %+v, want the Clip back whole", clips)
	}
	if numbers(clips[0]) != "1 2 3* " || clips[0].Takes[0].ID != c.Takes[0].ID {
		t.Errorf("takes = %+v, want the Clip's own back", clips[0].Takes)
	}
}
