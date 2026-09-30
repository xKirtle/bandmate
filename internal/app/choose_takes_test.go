package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// A Clip of Takes plays the Take chosen from them. Deleting a Take, or
// clearing the inactive ones, detaches them, and deleting the active Take
// makes the most recent one left active, while deleting the last deletes
// the Clip. Setting the Clip's Takes, or placing it, as it was brings them
// back, which is how undo works.

func (ts *testServer) chooseTake(songID, clipID, takeID int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodPut, clipPath(songID, clipID)+"/active-take", map[string]any{"takeId": takeID})
}

func (ts *testServer) deleteTake(songID, clipID, takeID int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodDelete, fmt.Sprintf("%s/%d", clipTakesPath(songID, clipID), takeID), nil)
}

func (ts *testServer) clearInactiveTakes(songID, clipID int64) response {
	ts.t.Helper()
	return ts.Do(http.MethodDelete, clipPath(songID, clipID)+"/inactive-takes", nil)
}

// threeTakes is recordATake's Clip, at 0:02 to 0:05, retaken twice: Take 2
// runs to 0:03 and Take 3, active, to 0:06, where the Clip now ends.
func threeTakes(t *testing.T, ts *testServer) (recordedTake, clip) {
	t.Helper()
	r := recordATake(t, ts)
	timelineChange(t, ts.retake(r.song.ID, r.clip.ID, retakeUpload(0, 0, 3)))
	c := timelineChange(t, ts.retake(r.song.ID, r.clip.ID, retakeUpload(0, 0, 6))).Tracks[1].Clips[0]
	if got := numbers(c); got != "1 2 3* " || clipAt(ts.getTimeline(r.song.ID), c.ID) != "1:2+4@2" {
		t.Fatalf("takes = %s, clip %+v; want 1 2 3* at 0:02 to 0:06", got, c)
	}
	return r, c
}

func TestChoosingATakeMakesItTheOneTheClipPlays(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)

	got := timelineChange(t, ts.chooseTake(r.song.ID, c.ID, c.Takes[0].ID))

	chosen := got.Tracks[1].Clips[0]
	if n := numbers(chosen); n != "1* 2 3 " {
		t.Errorf("takes = %s, want Take 1 active", n)
	}
	want := c
	want.ActiveTakeID = &c.Takes[0].ID
	if !reflect.DeepEqual(chosen, want) {
		t.Errorf("clip = %+v, want only its active Take changed: %+v", chosen, want)
	}
	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}
}

func TestChoosingATakeIsUndoneByChoosingTheOneBefore(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	chosen := timelineChange(t, ts.chooseTake(r.song.ID, c.ID, c.Takes[0].ID)).Tracks[1].Clips[0]

	undone := timelineChange(t, ts.chooseTake(r.song.ID, c.ID, c.Takes[2].ID)).Tracks[1].Clips[0]
	if !reflect.DeepEqual(undone, c) {
		t.Errorf("clip = %+v, want it as it was: %+v", undone, c)
	}
	redone := timelineChange(t, ts.chooseTake(r.song.ID, c.ID, c.Takes[0].ID)).Tracks[1].Clips[0]
	if !reflect.DeepEqual(redone, chosen) {
		t.Errorf("clip = %+v, want it as chosen: %+v", redone, chosen)
	}
}

func TestChoosingATakeFollowsItsRules(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	other := timelineChange(t, ts.recordTake(r.song.ID, takeRecording(r.vox.ID, 10, 10, 0, 2))).Tracks[1].Clips[1]
	beatClip := r.tl.Tracks[0].Clips[0].ID
	before := ts.getTimeline(r.song.ID)

	expectError(t, ts.chooseTake(r.song.ID, c.ID, other.Takes[0].ID), http.StatusBadRequest,
		"a Clip of Takes plays one of them")
	expectError(t, ts.chooseTake(r.song.ID, beatClip, c.Takes[0].ID), http.StatusBadRequest,
		"only a Clip of Takes has Takes")
	expectStatus(t, ts.chooseTake(r.song.ID, 999, c.Takes[0].ID), http.StatusNotFound)
	expectStale(t, ts.DoAt(r.tl.Version, http.MethodPut, clipPath(r.song.ID, c.ID)+"/active-take",
		map[string]any{"takeId": c.Takes[0].ID}))

	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
	}
}

func TestDeletingAnInactiveTakeLeavesTheActiveOnePlaying(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)

	got := timelineChange(t, ts.deleteTake(r.song.ID, c.ID, c.Takes[1].ID))

	if n := numbers(got.Tracks[1].Clips[0]); n != "1 3* " {
		t.Errorf("takes = %s, want 1 3*", n)
	}
	if at := clipAt(got, c.ID); at != "1:2+4@2" {
		t.Errorf("clip = %s, want it where it was", at)
	}
	// Detached, not destroyed.
	expectStatus(t, ts.Do(http.MethodGet, takePath(r.song.ID, c.Takes[1].ID)+"/audio", nil), http.StatusOK)
}

func TestDeletingTheActiveTakeMakesTheMostRecentLeftActive(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)

	got := timelineChange(t, ts.deleteTake(r.song.ID, c.ID, c.Takes[2].ID))

	if n := numbers(got.Tracks[1].Clips[0]); n != "1 2* " {
		t.Errorf("takes = %s, want Take 2, the most recent left, active", n)
	}
	// Take 3 ran to 0:06, and Take 1, the longest left, to 0:05.5, so the
	// Clip ends there now.
	if at := clipAt(got, c.ID); at != "1:2+3.5@2" {
		t.Errorf("clip = %s, want it at 0:02 to 0:05.5, within the Takes left", at)
	}

	// The most recent, not the next: Take 1 goes, so Take 3 plays.
	ts = newTestServer(t)
	r, c = threeTakes(t, ts)
	timelineChange(t, ts.chooseTake(r.song.ID, c.ID, c.Takes[0].ID))
	got = timelineChange(t, ts.deleteTake(r.song.ID, c.ID, c.Takes[0].ID))
	if n := numbers(got.Tracks[1].Clips[0]); n != "2 3* " {
		t.Errorf("takes = %s, want Take 3, the most recent left, active", n)
	}
}

func TestDeletingTheLastTakeDeletesTheClip(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)

	got := timelineChange(t, ts.deleteTake(r.song.ID, r.clip.ID, r.take.ID))

	if len(got.Tracks[1].Clips) != 0 {
		t.Errorf("clips = %+v, want the Clip gone", got.Tracks[1].Clips)
	}
	// Placing it back as it was brings the Take back.
	back := timelineChange(t, ts.placeTakes(r.song.ID, r.vox.ID, []int64{r.take.ID}, r.take.ID, 2, 0.5, 3))
	want := r.clip
	want.ID = back.Tracks[1].Clips[0].ID
	if c := back.Tracks[1].Clips[0]; !reflect.DeepEqual(c, want) {
		t.Errorf("clip = %+v, want it back as it was: %+v", c, want)
	}
}

func TestClearingInactiveTakesLeavesOnlyTheActiveOne(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	timelineChange(t, ts.chooseTake(r.song.ID, c.ID, c.Takes[1].ID))

	got := timelineChange(t, ts.clearInactiveTakes(r.song.ID, c.ID))

	if n := numbers(got.Tracks[1].Clips[0]); n != "2* " {
		t.Errorf("takes = %s, want only Take 2", n)
	}
	// Take 2 ran from 0:00 to 0:03, and Takes 1 and 3 to later.
	if at := clipAt(got, c.ID); at != "1:2+1@2" {
		t.Errorf("clip = %s, want it at 0:02 to 0:03, within Take 2", at)
	}
	// The next Take follows the highest still in the Clip.
	retaken := timelineChange(t, ts.retake(r.song.ID, c.ID, retakeUpload(0, 0, 3))).Tracks[1].Clips[0]
	if n := numbers(retaken); n != "2 3* " {
		t.Errorf("takes = %s, want the next Take numbered 3", n)
	}
}

func TestDeletedAndClearedTakesComeBackBySettingTheClipsTakes(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	timelineChange(t, ts.chooseTake(r.song.ID, c.ID, c.Takes[1].ID))
	before := ts.getTimeline(r.song.ID).Tracks[1].Clips[0]

	for name, change := range map[string]func() response{
		"deleting the active Take":  func() response { return ts.deleteTake(r.song.ID, c.ID, c.Takes[1].ID) },
		"deleting an inactive Take": func() response { return ts.deleteTake(r.song.ID, c.ID, c.Takes[2].ID) },
		"clearing inactive Takes":   func() response { return ts.clearInactiveTakes(r.song.ID, c.ID) },
	} {
		t.Run(name, func(t *testing.T) {
			after := timelineChange(t, change()).Tracks[1].Clips[0]

			undone := timelineChange(t, ts.setTakes(r.song.ID, c.ID, takesAsIn(before))).Tracks[1].Clips[0]
			if !reflect.DeepEqual(undone, before) {
				t.Errorf("clip = %+v, want it as it was: %+v", undone, before)
			}
			redone := timelineChange(t, ts.setTakes(r.song.ID, c.ID, takesAsIn(after))).Tracks[1].Clips[0]
			if !reflect.DeepEqual(redone, after) {
				t.Errorf("clip = %+v, want it as after: %+v", redone, after)
			}
			timelineChange(t, ts.setTakes(r.song.ID, c.ID, takesAsIn(before)))
		})
	}
}

func TestDeletingTakesFollowsTheirRules(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	other := timelineChange(t, ts.recordTake(r.song.ID, takeRecording(r.vox.ID, 10, 10, 0, 2))).Tracks[1].Clips[1]
	beatClip := r.tl.Tracks[0].Clips[0].ID
	before := ts.getTimeline(r.song.ID)

	expectStatus(t, ts.deleteTake(r.song.ID, c.ID, other.Takes[0].ID), http.StatusNotFound)
	expectStatus(t, ts.deleteTake(r.song.ID, 999, c.Takes[0].ID), http.StatusNotFound)
	expectError(t, ts.deleteTake(r.song.ID, beatClip, c.Takes[0].ID), http.StatusBadRequest,
		"only a Clip of Takes has Takes")
	expectError(t, ts.clearInactiveTakes(r.song.ID, beatClip), http.StatusBadRequest, "only a Clip of Takes has Takes")
	expectStatus(t, ts.clearInactiveTakes(r.song.ID, 999), http.StatusNotFound)
	expectStale(t, ts.DoAt(r.tl.Version, http.MethodDelete,
		fmt.Sprintf("%s/%d", clipTakesPath(r.song.ID, c.ID), c.Takes[0].ID), nil))
	expectStale(t, ts.DoAt(r.tl.Version, http.MethodDelete, clipPath(r.song.ID, c.ID)+"/inactive-takes", nil))

	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
	}
}

func TestAClipWhoseTakesLeftEndBeforeItMovesBackToEndWithThem(t *testing.T) {
	ts := newTestServer(t)
	r, c := threeTakes(t, ts)
	// The Clip's start is trimmed to 0:05.75, past where Takes 1 and 2 end,
	// at 0:05.5 and 0:03.
	timelineChange(t, ts.trimClip(r.song.ID, c.ID, 5.75, 0.25))
	timelineChange(t, ts.chooseTake(r.song.ID, c.ID, c.Takes[0].ID))
	before := ts.getTimeline(r.song.ID).Tracks[1].Clips[0]

	for name, change := range map[string]func() response{
		"deleting a Take":         func() response { return ts.deleteTake(r.song.ID, c.ID, c.Takes[2].ID) },
		"clearing inactive Takes": func() response { return ts.clearInactiveTakes(r.song.ID, c.ID) },
	} {
		t.Run(name, func(t *testing.T) {
			got := timelineChange(t, change())

			// It ends at 0:05.5 with Take 1, as long as it was, and its
			// source span still starts at 0:00.
			if at := clipAt(got, c.ID); at != "1:5.25+0.25@5.25" {
				t.Errorf("clip = %s, want it at 0:05.25 to 0:05.5", at)
			}
			timelineChange(t, ts.setTakes(r.song.ID, c.ID, takesAsIn(before)))
		})
	}
}
