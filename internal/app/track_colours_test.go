package app_test

import (
	"context"
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
	old, err := db.OpenBefore(context.Background(), dir, "0050_track_colours")
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
