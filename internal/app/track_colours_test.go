package app_test

import (
	"context"
	"fmt"
	"net/http"
	"reflect"
	"testing"

	"github.com/xKirtle/bandmate/internal/db"
)

// A Track's Track Colour is which of the set of six it has. Bandmate gives
// it one when it's made, the one least used on the Song's Tracks, and it
// keeps that one.

// trackColours lists a Timeline's Tracks' colours, top to bottom.
func trackColours(tl timeline) []int {
	out := []int{}
	for _, tr := range tl.Tracks {
		out = append(out, tr.Colour)
	}
	return out
}

func expectColours(t *testing.T, tl timeline, want ...int) {
	t.Helper()
	if got := trackColours(tl); !reflect.DeepEqual(got, want) {
		t.Errorf("Track Colours = %v, want %v", got, want)
	}
}

func TestASongsFirstTrackHasTheFirstColour(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	expectColours(t, ts.getTimeline(s.ID), 1)
}

func TestEachNewTrackTakesTheNextColourThenTheyRepeat(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	var tl timeline
	for range 7 {
		tl = timelineChange(t, ts.addTrack(s.ID, "Adlibs"))
	}

	expectColours(t, tl, 1, 2, 3, 4, 5, 6, 1, 2)
}

func TestANewTrackTakesTheEarliestOfTheLeastUsedColours(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addTrack(s.ID, "Second"))
	timelineChange(t, ts.addTrack(s.ID, "Third"))
	tl := timelineChange(t, ts.addTrack(s.ID, "Fourth"))

	// Colours 2 and 3 go free, and 5 and 6 never were used, so 2 is next,
	// then 3, then 5.
	tl = timelineChange(t, ts.deleteTrack(s.ID, tl.Tracks[1].ID))
	tl = timelineChange(t, ts.deleteTrack(s.ID, tl.Tracks[1].ID))
	expectColours(t, tl, 1, 4)

	timelineChange(t, ts.addTrack(s.ID, "Fifth"))
	timelineChange(t, ts.addTrack(s.ID, "Sixth"))
	expectColours(t, timelineChange(t, ts.addTrack(s.ID, "Seventh")), 1, 4, 2, 3, 5)
}

func TestANewTrackPicksAmongTheColoursOnItsOwnSongsTracks(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	other := ts.createSong("Other")
	timelineChange(t, ts.addTrack(other.ID, "Second"))
	timelineChange(t, ts.addTrack(other.ID, "Third"))

	expectColours(t, timelineChange(t, ts.addTrack(s.ID, "Adlibs")), 1, 2)
}

func TestATrackMadeByAMergeGetsTheLeastUsedColour(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.mergeClips(p.song.ID, mergedAudio(50, onNewTrack("Track 3", 1), p.first, p.second)))

	expectColours(t, got, 1, 3, 2)
}

func TestUndoingAndRedoingAMergeLeavesItsTracksColour(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	merged := timelineChange(t, ts.mergeClips(p.song.ID, mergedAudio(50, onNewTrack("Track 3", 1), p.first, p.second)))
	added := merged.Tracks[1]

	// Undone and redone as the web app does, by replacing Clips.
	undone := timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/replace", map[string]any{
		"clipIds": []int64{added.Clips[0].ID}, "trackIds": []int64{added.ID},
		"clips": []map[string]any{
			{"trackId": p.tl.Tracks[0].ID, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10},
			{"trackId": p.tl.Tracks[0].ID, "beatId": p.long.ID, "start": 30, "offset": 0, "length": 20},
		},
	}))
	expectColours(t, undone, 1, 2)

	redone := timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/replace", map[string]any{
		"clipIds":   []int64{undone.Tracks[0].Clips[0].ID, undone.Tracks[0].Clips[1].ID},
		"newTracks": []map[string]any{{"name": "Track 3", "position": 1}},
		"clips":     []map[string]any{{"newTrack": 0, "soundId": added.Clips[0].SoundID, "start": 0, "offset": 0, "length": 50}},
	}))
	expectColours(t, redone, 1, 3, 2)
}

func TestATrackKeepsItsColourWhenOthersAreAddedDeletedOrReordered(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addTrack(s.ID, "Second"))
	tl := timelineChange(t, ts.addTrack(s.ID, "Third"))

	tl = timelineChange(t, ts.reorderTracks(s.ID, []int64{tl.Tracks[2].ID, tl.Tracks[0].ID, tl.Tracks[1].ID}))
	expectColours(t, tl, 3, 1, 2)

	tl = timelineChange(t, ts.deleteTrack(s.ID, tl.Tracks[1].ID))
	expectColours(t, tl, 3, 2)

	expectColours(t, timelineChange(t, ts.addTrack(s.ID, "Fourth")), 3, 2, 1)
	expectColours(t, ts.getTimeline(s.ID), 3, 2, 1)
}

func TestChangingATracksLevelsLeavesItsColour(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	tl := timelineChange(t, ts.addTrack(s.ID, "Second"))

	got := timelineChange(t, ts.Do(http.MethodPatch, trackPath(s.ID, tl.Tracks[1].ID), map[string]any{"volume": -3}))

	expectColours(t, got, 1, 2)
}

func TestABackupKeepsEachTracksColour(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addTrack(s.ID, "Second"))
	tl := timelineChange(t, ts.addTrack(s.ID, "Third"))
	timelineChange(t, ts.reorderTracks(s.ID, []int64{tl.Tracks[2].ID, tl.Tracks[0].ID, tl.Tracks[1].ID}))
	made := ts.backUp(map[string]any{"allSongs": true})

	restored := ts.restore(made.ID, s.ID)

	expectColours(t, ts.getTimeline(restored[0].ID), 3, 1, 2)
}

// colourlessTracksBefore is a data directory at the schema before Tracks had
// a Track Colour, holding a Song (id 7) of seven Tracks, their rows not in
// the order they're shown, and another (id 8) of one.
func colourlessTracksBefore(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old, err := db.OpenBefore(context.Background(), dir, "0051_track_colours")
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`INSERT INTO songs (id, title, status, version, created_at, updated_at) VALUES
			(7, 'Night Drive', 'drafting', 1, '2025-01-02T03:04:05.000000000Z', '2025-01-02T03:04:05.000000000Z'),
			(8, 'Paper Boats', 'drafting', 1, '2025-01-02T03:04:05.000000000Z', '2025-01-02T03:04:05.000000000Z')`,
		`INSERT INTO tracks (id, song_id, name, position) VALUES
			(1, 7, 'Sixth', 5), (2, 7, 'Seventh', 6), (3, 7, 'First', 0), (4, 7, 'Third', 2),
			(5, 7, 'Second', 1), (6, 7, 'Fourth', 3), (9, 7, 'Fifth', 4), (10, 8, 'Beat', 0)`,
	} {
		if _, err := old.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestAnUpgradeGivesEachSongsTracksTheColoursInOrderFromTheTop(t *testing.T) {
	ts := startTestServer(t, colourlessTracksBefore(t))

	tl := ts.getTimeline(7)
	if want := []string{"First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"}; !reflect.DeepEqual(trackNames(tl), want) {
		t.Fatalf("Tracks = %v, want %v", trackNames(tl), want)
	}
	expectColours(t, tl, 1, 2, 3, 4, 5, 6, 1)
	expectColours(t, ts.getTimeline(8), 1)
}

func TestAnOlderBackupGetsColoursTheSameWayOnRestore(t *testing.T) {
	ts := newTestServer(t)
	ts.createSong("Placeholder")
	made := ts.backUp(map[string]any{"allSongs": true})
	ts.replaceBackupFile(made.ID, packBackup(t, colourlessTracksBefore(t)))

	restored := ts.restore(made.ID, 7)

	expectColours(t, ts.getTimeline(restored[0].ID), 1, 2, 3, 4, 5, 6, 1)
}

func TestTheDemoSongsTracksHaveColours(t *testing.T) {
	ts := newTestServer(t)
	demoSong := ts.putDemoBack()

	tl := ts.getTimeline(demoSong.ID)

	if len(tl.Tracks) == 0 {
		t.Fatal("the Demo Song has no Tracks")
	}
	want := []int{}
	for i := range tl.Tracks {
		want = append(want, i%6+1)
	}
	expectColours(t, tl, want...)
}

// A Track that carries on another Track's Clips takes that Track's colour,
// rather than one of its own.

// clipsCloseTogether is placeTwoClips, the second Clip near enough the first
// that slowing the first to half speed runs it into the second.
func clipsCloseTogether(t *testing.T, ts *testServer) twoClips {
	t.Helper()
	p := placeTwoClips(t, ts)
	p.tl = timelineChange(t, ts.moveClip(p.song.ID, p.second, p.tl.Tracks[0].ID, 15))
	return p
}

func TestTheTrackASlowedClipMovesToTakesTheColourOfTheTrackItLeft(t *testing.T) {
	ts := newTestServer(t)
	p := clipsCloseTogether(t, ts)

	slowed := timelineChange(t, ts.setClipTempo(p.song.ID, p.first, 0.5))

	expectColours(t, slowed, 1, 1, 2)
	expectColours(t, ts.getTimeline(p.song.ID), 1, 1, 2)
}

func TestATrackAPasteAddsTakesTheColourItCarriesOn(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/paste", map[string]any{
		"newTracks": []map[string]any{{"name": "Beat", "colour": 5}, {"name": "Adlibs", "colour": 1}},
		"clips":     []map[string]any{{"newTrack": 0, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10}},
	}))

	expectColours(t, got, 1, 2, 5, 1)
	expectColours(t, ts.getTimeline(p.song.ID), 1, 2, 5, 1)
}

func TestATrackAPasteAddsGetsItsOwnColourIfItCarriesOnNone(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.pasteOntoNewTracks(p.song.ID, []string{"Beat"},
		map[string]any{"newTrack": 0, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10}))

	expectColours(t, got, 1, 2, 3)
}

func TestRedoingAPasteBringsItsTracksBackInTheirColours(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)

	got := timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/place", map[string]any{
		"newTracks": []map[string]any{{"name": "Beat", "colour": 4}},
		"clips":     []map[string]any{{"newTrack": 0, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10}},
	}))

	expectColours(t, got, 1, 2, 4)
}

func TestUndoingATracksDeletionBringsItsColourBack(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addTrack(s.ID, "Second"))
	timelineChange(t, ts.addTrack(s.ID, "Third"))
	tl := timelineChange(t, ts.addTrack(s.ID, "Fourth"))
	timelineChange(t, ts.deleteTrack(s.ID, tl.Tracks[1].ID))
	tl = timelineChange(t, ts.deleteTrack(s.ID, tl.Tracks[2].ID))
	expectColours(t, tl, 1, 4)

	// The newest deletion undone first. Colour 2 is the least used by now,
	// so the Track only comes back in its own if it's given that.
	got := timelineChange(t, ts.Do(http.MethodPost, timelinePath(s.ID)+"/tracks",
		map[string]any{"name": "Third", "position": 1, "colour": 3}))
	expectColours(t, got, 1, 3, 4)

	got = timelineChange(t, ts.Do(http.MethodPost, timelinePath(s.ID)+"/tracks",
		map[string]any{"name": "Second", "position": 1, "colour": 2}))
	expectColours(t, got, 1, 2, 3, 4)
}

func TestATrackIsRefusedAColourOutsideTheSet(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	clips := []map[string]any{{"newTrack": 0, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10}}

	for _, colour := range []int{-1, 7} {
		tracks := []map[string]any{{"name": "Beat", "colour": colour}}
		for path, body := range map[string]map[string]any{
			"/tracks":      {"name": "Beat", "colour": colour},
			"/clips/paste": {"newTracks": tracks, "clips": clips},
			"/clips/place": {"newTracks": tracks, "clips": clips},
		} {
			t.Run(fmt.Sprintf("%s %d", path, colour), func(t *testing.T) {
				expectError(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+path, body),
					http.StatusBadRequest, "a Track's colour goes from 1 to 6")
				if read := ts.getTimeline(p.song.ID); !reflect.DeepEqual(read, p.tl) {
					t.Errorf("timeline = %+v, want it unchanged: %+v", read, p.tl)
				}
			})
		}
	}
}

func TestATracksColourCantBeSetAnyOtherWay(t *testing.T) {
	ts := newTestServer(t)
	p := placeTwoClips(t, ts)
	unknown := `unknown field "colour"`

	expectError(t, ts.Do(http.MethodPatch, trackPath(p.song.ID, p.tl.Tracks[1].ID), map[string]any{"colour": 5}),
		http.StatusBadRequest, unknown)
	expectError(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/replace", map[string]any{
		"clipIds":   []int64{p.first},
		"newTracks": []map[string]any{{"name": "Track 3", "position": 2, "colour": 5}},
		"clips":     []map[string]any{{"newTrack": 0, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10}},
	}), http.StatusBadRequest, unknown)
	expectError(t, ts.mergeClips(p.song.ID, mergedAudio(50,
		onto{"newTrack": map[string]any{"name": "Track 3", "position": 1, "colour": 5}}, p.first, p.second)),
		http.StatusBadRequest, "details must be valid JSON with known fields")
}

func TestUndoingAndRedoingATempoChangeLeavesTheSameColours(t *testing.T) {
	ts := newTestServer(t)
	p := clipsCloseTogether(t, ts)
	slowed := timelineChange(t, ts.setClipTempo(p.song.ID, p.first, 0.5))
	added := slowed.Tracks[1]

	// Undone as the web app does, by replacing the Clip, its new Track deleted.
	undone := timelineChange(t, ts.Do(http.MethodPost, timelinePath(p.song.ID)+"/clips/replace", map[string]any{
		"clipIds": []int64{added.Clips[0].ID}, "trackIds": []int64{added.ID},
		"clips": []map[string]any{{"trackId": p.tl.Tracks[0].ID, "beatId": p.short.ID, "start": 0, "offset": 0, "length": 10}},
	}))
	expectColours(t, undone, 1, 2)

	expectColours(t, timelineChange(t, ts.setClipTempo(p.song.ID, undone.Tracks[0].Clips[0].ID, 0.5)), 1, 1, 2)
}
