package app_test

import (
	"bytes"
	"fmt"
	"net/http"
	"reflect"
	"testing"
)

// A paste makes new Clips from the Clipboard, which holds Clips as they
// were when copied: the browser keeps it, and sends each Clip as it was,
// with where it's to go.

// pasteClips sends a request to paste Clips, each a Track id and the Clip
// as it was copied.
func (ts *testServer) pasteClips(songID int64, clips ...map[string]any) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/clips/paste", map[string]any{"clips": clips})
}

func TestAPastedClipOfTakesGetsCopiesOfTheTakesAsTheyWereCopied(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	// The Clip as copied, before its Take is nudged since.
	copied := map[string]any{"trackId": r.vox.ID, "name": "Hook",
		"takes":        []map[string]any{{"id": r.take.ID, "position": r.take.Position, "nudge": 0.25}},
		"activeTakeId": r.take.ID, "start": 10, "offset": 0.5, "length": 3}
	timelineChange(t, ts.nudgeTake(r.song.ID, r.clip.ID, r.take.ID, -0.1))
	before := ts.getTimeline(r.song.ID)

	got := timelineChange(t, ts.pasteClips(r.song.ID, copied))

	clips := got.Tracks[1].Clips
	if len(clips) != 2 || clips[1].Start != 10 || clips[1].Offset != 0.5 || clips[1].Length != 3 ||
		nameOf(clips[1]) != "Hook" {
		t.Fatalf("clips = %+v, want a new Clip named Hook at 0:10", clips)
	}
	takes := clips[1].Takes
	if len(takes) != 1 || takes[0].ID == r.take.ID || *clips[1].ActiveTakeID != takes[0].ID {
		t.Fatalf("takes = %+v, want a copy of the Take, active", takes)
	}
	if want := (take{ID: takes[0].ID, Number: 1, Size: r.take.Size, Duration: 4, SampleRate: wavRate,
		Position: r.take.Position, Nudge: 0.25, RecordedAt: r.take.RecordedAt}); !reflect.DeepEqual(takes[0], want) {
		t.Errorf("copy = %+v, want %+v", takes[0], want)
	}
	if !reflect.DeepEqual(got.Tracks[1].Clips[0], before.Tracks[1].Clips[0]) {
		t.Errorf("original = %+v, want it unchanged: %+v", got.Tracks[1].Clips[0], before.Tracks[1].Clips[0])
	}
	served := ts.Do(http.MethodGet, takePath(r.song.ID, takes[0].ID)+"/audio", nil)
	if !bytes.Equal(served.Body, r.audio) {
		t.Errorf("the copy's audio differs from the recording")
	}
	if got.Version != before.Version+1 {
		t.Errorf("version = %d, want one more than %d", got.Version, before.Version)
	}
}

func TestAClipOfTakesStillPastesOnceItsClipIsDeleted(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	timelineChange(t, ts.deleteClip(r.song.ID, r.clip.ID))

	got := timelineChange(t, ts.pasteClips(r.song.ID, map[string]any{"trackId": r.vox.ID,
		"takes":        []map[string]any{{"id": r.take.ID, "position": r.take.Position, "nudge": 0}},
		"activeTakeId": r.take.ID, "start": 2, "offset": 0.5, "length": 3}))

	clips := got.Tracks[1].Clips
	if len(clips) != 1 || len(clips[0].Takes) != 1 || clips[0].Takes[0].ID == r.take.ID {
		t.Fatalf("clips = %+v, want one Clip with a copy of the Take", clips)
	}
	// The Take copied stays detached, so undoing the delete still works.
	back := timelineChange(t, ts.placeTakes(r.song.ID, r.vox.ID, []int64{r.take.ID}, r.take.ID, 10, 0.5, 3))
	if len(back.Tracks[1].Clips) != 2 {
		t.Errorf("clips = %+v, want the deleted Clip back beside the paste", back.Tracks[1].Clips)
	}
}

// A cut copies the Selection to the Clipboard, then deletes it, as Clips
// deleted together, so a cut Clip of Takes pastes from Takes detached.
func TestACutClipOfTakesPastesAgainAndAgainWithItsAudio(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	cut := map[string]any{"trackId": r.vox.ID, "name": "Hook",
		"takes":        []map[string]any{{"id": r.take.ID, "position": r.take.Position, "nudge": 0.25}},
		"activeTakeId": r.take.ID, "start": 2, "offset": 0.5, "length": 3}
	timelineChange(t, ts.Do(http.MethodPost, timelinePath(r.song.ID)+"/clips/delete",
		map[string]any{"clipIds": []int64{r.clip.ID}}))

	first := timelineChange(t, ts.pasteClips(r.song.ID, cut))
	cut["start"] = 5
	got := timelineChange(t, ts.pasteClips(r.song.ID, cut))

	clips := got.Tracks[1].Clips
	if len(clips) != 2 || clips[0].ID != first.Tracks[1].Clips[0].ID || clips[1].Start != 5 {
		t.Fatalf("clips = %+v, want two pasted Clips, at 0:02 and 0:05", clips)
	}
	for _, c := range clips {
		if len(c.Takes) != 1 || c.Takes[0].ID == r.take.ID || c.Takes[0].Nudge != 0.25 || nameOf(c) != "Hook" {
			t.Fatalf("clip = %+v, want Hook with its own copy of the Take, nudged as cut", c)
		}
		served := ts.Do(http.MethodGet, takePath(r.song.ID, c.Takes[0].ID)+"/audio", nil)
		if !bytes.Equal(served.Body, r.audio) {
			t.Errorf("Take %d's audio differs from the recording", c.Takes[0].ID)
		}
	}
	if clips[0].Takes[0].ID == clips[1].Takes[0].ID {
		t.Errorf("both pastes play Take %d, want a Take each", clips[0].Takes[0].ID)
	}
	// With the pastes undone, undoing the cut still brings the Clip back,
	// from its Take, detached.
	timelineChange(t, ts.Do(http.MethodPost, timelinePath(r.song.ID)+"/clips/delete",
		map[string]any{"clipIds": []int64{clips[0].ID, clips[1].ID}}))
	back := timelineChange(t, ts.placeTakes(r.song.ID, r.vox.ID, []int64{r.take.ID}, r.take.ID, 2, 0.5, 3))
	if c := back.Tracks[1].Clips; len(c) != 1 || c[0].Takes[0].ID != r.take.ID {
		t.Errorf("clips = %+v, want the cut Clip back, with its Take", c)
	}
}

func TestClipsOfBeatsAndSoundsPasteAsCopied(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	tl := timelineChange(t, ts.importSound(p.song.ID, soundFile("hum.m4a", "Hum", p.tl.Tracks[0].ID, 8)))
	hum := tl.Tracks[0].Clips[2]
	adlibs := tl.Tracks[1].ID

	got := timelineChange(t, ts.pasteClips(p.song.ID,
		map[string]any{"trackId": adlibs, "beatId": p.short.ID, "name": "Intro", "start": 0, "offset": 2, "length": 5},
		map[string]any{"trackId": adlibs, "soundId": *hum.SoundID, "start": 5, "offset": 0, "length": 8}))

	clips := got.Tracks[1].Clips
	if len(clips) != 2 || clips[0].BeatID != p.short.ID || nameOf(clips[0]) != "Intro" || clips[0].Offset != 2 ||
		clips[0].Length != 5 || clips[1].SoundID == nil || *clips[1].SoundID != *hum.SoundID || clips[1].Start != 5 {
		t.Errorf("adlibs clips = %+v, want the Beat's Clip named Intro, then the Sound's", clips)
	}
}

func TestAPasteIsRefusedWhole(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	other := recordATake(t, ts)
	before := ts.getTimeline(r.song.ID)
	takes := func(id int64, start float64) map[string]any {
		return map[string]any{"trackId": r.vox.ID, "takes": []map[string]any{{"id": id, "position": 0, "nudge": 0}},
			"activeTakeId": id, "start": start, "offset": 0.5, "length": 3}
	}

	for name, c := range map[string]struct {
		clips  []map[string]any
		status int
		msg    string
	}{
		"onto a Clip there": {[]map[string]any{takes(r.take.ID, 20), takes(r.take.ID, 3)},
			http.StatusConflict, "Clips can't overlap on a Track"},
		"onto each other": {[]map[string]any{takes(r.take.ID, 20), takes(r.take.ID, 21)},
			http.StatusConflict, "Clips can't overlap on a Track"},
		"a Take of another Song": {[]map[string]any{takes(other.take.ID, 20)},
			http.StatusBadRequest, "there's no such Take in this Song"},
		"playing none of its Takes": {[]map[string]any{{"trackId": r.vox.ID,
			"takes": []map[string]any{{"id": r.take.ID, "position": 0, "nudge": 0}}, "activeTakeId": 999,
			"start": 20, "offset": 0, "length": 1}}, http.StatusBadRequest, "a Clip of Takes plays one of them"},
		"without a Track": {[]map[string]any{{"beatId": r.tl.Beats[0].ID, "start": 20, "offset": 0, "length": 1}},
			http.StatusBadRequest, "trackId or newTrack, start, offset and length are required"},
		"no Clips": {[]map[string]any{}, http.StatusBadRequest, "clips are required"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.pasteClips(r.song.ID, c.clips...), c.status, c.msg)
			if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
	if files := takeFiles(t, ts); len(files) != 2 {
		t.Errorf("take files on disk = %q, want only the two recorded", files)
	}
}

// pasteOntoNewTracks sends a request to paste Clips, adding Tracks named
// names at the bottom first, for Clips to go on by "newTrack", their index.
func (ts *testServer) pasteOntoNewTracks(songID int64, names []string, clips ...map[string]any) response {
	ts.t.Helper()
	return ts.Do(http.MethodPost, timelinePath(songID)+"/clips/paste",
		map[string]any{"newTracks": newTracks(names), "clips": clips})
}

// newTracks is Tracks to add at the bottom, by name, as a request gives them.
func newTracks(names []string) []map[string]any {
	tracks := make([]map[string]any, len(names))
	for i, n := range names {
		tracks[i] = map[string]any{"name": n}
	}
	return tracks
}

func TestAPasteCanAddTracksAtTheBottomForItsClips(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	adlibs := p.tl.Tracks[1].ID

	got := timelineChange(t, ts.pasteOntoNewTracks(p.song.ID, []string{"Beat", "Adlibs"},
		map[string]any{"trackId": adlibs, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10},
		map[string]any{"newTrack": 1, "beatId": p.long.ID, "start": 5, "offset": 0, "length": 20},
		map[string]any{"newTrack": 0, "beatId": p.short.ID, "start": 2, "offset": 0, "length": 10}))

	if len(got.Tracks) != 4 {
		t.Fatalf("tracks = %+v, want two new ones", got.Tracks)
	}
	if n := []string{got.Tracks[2].Name, got.Tracks[3].Name}; !reflect.DeepEqual(n, []string{"Beat", "Adlibs"}) {
		t.Errorf("new Tracks = %q, want Beat then Adlibs at the bottom", n)
	}
	for i, want := range [][]string{
		{fmt.Sprintf("%d@0+10", p.short.ID)},
		{fmt.Sprintf("%d@2+10", p.short.ID)},
		{fmt.Sprintf("%d@5+20", p.long.ID)},
	} {
		if c := clipsOf(got, i+1); !reflect.DeepEqual(c, want) {
			t.Errorf("track %d clips = %q, want %q", i+1, c, want)
		}
	}
	if tr := got.Tracks[2]; tr.Volume != 0 || tr.Muted || tr.Soloed {
		t.Errorf("new Track = %+v, want it at 0 dB, neither muted nor soloed", tr)
	}
}

func TestAPasteOntoNewTracksIsUndoneAndRedoneAsOneStep(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	adlibs := p.tl.Tracks[1].ID
	pasted := timelineChange(t, ts.pasteOntoNewTracks(p.song.ID, []string{"Beat"},
		map[string]any{"trackId": adlibs, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10},
		map[string]any{"newTrack": 0, "beatId": p.long.ID, "start": 5, "offset": 0, "length": 20}))
	added := pasted.Tracks[2]

	// Undone: its Clips deleted, with the Track it added.
	undone := timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/delete",
		map[string]any{"clipIds": []int64{pasted.Tracks[1].Clips[0].ID, added.Clips[0].ID},
			"trackIds": []int64{added.ID}}))
	if !reflect.DeepEqual(undone.Tracks, p.tl.Tracks) {
		t.Errorf("tracks = %+v, want them as before the paste: %+v", undone.Tracks, p.tl.Tracks)
	}
	if undone.Version != pasted.Version+1 {
		t.Errorf("version = %d, want one more than %d", undone.Version, pasted.Version)
	}

	// Redone: the Clips placed back, on a Track added again.
	redone := timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/place",
		map[string]any{"newTracks": newTracks([]string{"Beat"}), "clips": []map[string]any{
			{"trackId": adlibs, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10},
			{"newTrack": 0, "beatId": p.long.ID, "start": 5, "offset": 0, "length": 20},
		}}))
	if len(redone.Tracks) != 3 || redone.Tracks[2].Name != "Beat" ||
		!reflect.DeepEqual(clipsOf(redone, 2), []string{fmt.Sprintf("%d@5+20", p.long.ID)}) ||
		!reflect.DeepEqual(clipsOf(redone, 1), []string{fmt.Sprintf("%d@0+10", p.short.ID)}) {
		t.Errorf("tracks = %+v, want the paste back, with its Track", redone.Tracks)
	}
}

func TestDeletingClipsWithTracksIsRefusedWhole(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	other := ts.createSong("Other")
	theirs := timelineChange(t, ts.addBeatToSong(other.ID, p.short.ID))
	before := ts.getTimeline(p.song.ID)
	del := func(clipIDs, trackIDs []int64) response {
		return ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/delete",
			map[string]any{"clipIds": clipIDs, "trackIds": trackIDs})
	}

	expectError(t, del([]int64{p.first}, []int64{p.tl.Tracks[0].ID, p.tl.Tracks[1].ID}), http.StatusConflict,
		"a Song always has a Track, so its last one can't be deleted")
	expectStatus(t, del([]int64{p.first}, []int64{theirs.Tracks[0].ID}), http.StatusNotFound)
	if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
	}
}

func TestAPasteOntoNewTracksIsRefusedWhole(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	before := ts.getTimeline(p.song.ID)
	short := func(on string, at any, start float64) map[string]any {
		return map[string]any{on: at, "beatId": p.short.ID, "start": start, "offset": 0, "length": 10}
	}

	for name, c := range map[string]struct {
		names  []string
		clips  []map[string]any
		status int
		msg    string
	}{
		"onto each other on a new Track": {[]string{"Beat"},
			[]map[string]any{short("newTrack", 0, 0), short("newTrack", 0, 5)},
			http.StatusConflict, "Clips can't overlap on a Track"},
		"onto a new Track not added": {[]string{"Beat"}, []map[string]any{short("newTrack", 1, 0)},
			http.StatusBadRequest, "there's no such new Track"},
		"a new Track without a name": {[]string{" "}, []map[string]any{short("newTrack", 0, 0)},
			http.StatusBadRequest, "a Track's name is required"},
		"onto a Track and a new Track at once": {[]string{"Beat"},
			[]map[string]any{{"trackId": p.tl.Tracks[1].ID, "newTrack": 0, "beatId": p.short.ID,
				"start": 0, "offset": 0, "length": 10}},
			http.StatusBadRequest, "a Clip goes on a Track or a new Track, not both"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.pasteOntoNewTracks(p.song.ID, c.names, c.clips...), c.status, c.msg)
			if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, before) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
			}
		})
	}
}
