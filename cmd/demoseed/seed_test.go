package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/xKirtle/bandmate/internal/app"
)

// seeded runs the seed against a fresh, empty Bandmate running in-process,
// and returns its address. It starts the real handler as
// internal/app/helpers_test.go does, whose helpers can't be imported here.
func seeded(t *testing.T) string {
	t.Helper()
	a, err := app.New(app.Config{DataDir: t.TempDir(), SPA: fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}}})
	if err != nil {
		t.Fatalf("starting app: %v", err)
	}
	srv := httptest.NewServer(a.Handler())
	t.Cleanup(func() {
		srv.Close()
		a.Close()
	})
	if err := seed(context.Background(), srv.URL, srv.Client()); err != nil {
		t.Fatalf("seeding: %v", err)
	}
	return srv.URL
}

// get decodes the JSON answer to GET path into v.
func get(t *testing.T, base, path string, v any) {
	t.Helper()
	res, err := http.Get(base + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status %d", path, res.StatusCode)
	}
	if err := json.NewDecoder(res.Body).Decode(v); err != nil {
		t.Fatalf("GET %s: decoding: %v", path, err)
	}
}

// songSummary is a Song as the Song list shows it.
type songSummary struct {
	ID     int64  `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

func TestSeedFillsTheSongListAcrossEveryStatus(t *testing.T) {
	base := seeded(t)
	var songs []songSummary
	get(t, base, "/api/songs", &songs)

	if len(songs) < 6 || len(songs) > 7 {
		t.Fatalf("seeded %d Songs, want the hero Song and 5 or 6 others", len(songs))
	}
	statuses := map[string]int{}
	for _, s := range songs {
		statuses[s.Status]++
	}
	for _, status := range []string{"idea", "drafting", "finished"} {
		if statuses[status] == 0 {
			t.Errorf("no %s Song seeded; statuses: %v", status, statuses)
		}
	}
	if _, ok := findSong(songs, heroTitle); !ok {
		t.Errorf("no Song titled %q", heroTitle)
	}
}

func TestSeedLeavesABandmateWithSongsAsItIs(t *testing.T) {
	base := seeded(t)
	var before []songSummary
	get(t, base, "/api/songs", &before)

	if err := seed(context.Background(), base, http.DefaultClient); err == nil {
		t.Error("seeding a Bandmate with Songs succeeded, want it refused")
	}
	var after []songSummary
	get(t, base, "/api/songs", &after)
	if len(after) != len(before) {
		t.Errorf("%d Songs after seeding again, want the %d there before", len(after), len(before))
	}
}

// findSong finds the Song titled title in the Song list.
func findSong(songs []songSummary, title string) (songSummary, bool) {
	for _, s := range songs {
		if s.Title == title {
			return s, true
		}
	}
	return songSummary{}, false
}

// heroSong is as much of the hero Song as the tests check.
type heroSong struct {
	Key         string  `json:"key"`
	BPM         *int    `json:"bpm"`
	Capo        *int    `json:"capo"`
	Status      string  `json:"status"`
	Arrangement []int64 `json:"arrangement"`
	Scrapbook   []int64 `json:"scrapbook"`
	Sections    []struct {
		ID         int64 `json:"id"`
		Alternates []struct {
			Active bool `json:"active"`
			Lines  []struct {
				Chords    []json.RawMessage `json:"chords"`
				ChordLine bool              `json:"chordLine"`
				Cue       *float64          `json:"cue"`
			} `json:"lines"`
		} `json:"alternates"`
	} `json:"sections"`
}

func TestHeroSongHasABeatAndTakesOnItsTimeline(t *testing.T) {
	base, id := hero(t)
	var tl struct {
		Tracks []struct {
			Name  string `json:"name"`
			Clips []struct {
				BeatID *int64            `json:"beatId"`
				Takes  []json.RawMessage `json:"takes"`
			} `json:"clips"`
		} `json:"tracks"`
	}
	get(t, base, fmt.Sprintf("/api/songs/%d/timeline", id), &tl)

	if len(tl.Tracks) < 2 {
		t.Fatalf("%d Tracks, want a Beat's and a Takes'", len(tl.Tracks))
	}
	beatTrack, takesTrack := -1, -1
	for i, tr := range tl.Tracks {
		for _, c := range tr.Clips {
			if c.BeatID != nil && beatTrack < 0 {
				beatTrack = i
			}
			if len(c.Takes) >= 2 && takesTrack < 0 {
				takesTrack = i
			}
		}
	}
	if beatTrack < 0 {
		t.Error("no Clip plays a Beat")
	}
	if takesTrack < 0 {
		t.Error("no Clip has a couple of Takes")
	}
	if beatTrack >= 0 && beatTrack == takesTrack {
		t.Errorf("the Beat and the Takes are both on Track %q, want the Takes on a second Track", tl.Tracks[beatTrack].Name)
	}

	var beats []json.RawMessage
	get(t, base, "/api/beats", &beats)
	if len(beats) != 1 {
		t.Errorf("%d Beats in the Beat Library, want the click track", len(beats))
	}
}

// hero seeds a Bandmate and returns its address with its hero Song's id.
func hero(t *testing.T) (base string, id int64) {
	t.Helper()
	base = seeded(t)
	var songs []songSummary
	get(t, base, "/api/songs", &songs)
	s, ok := findSong(songs, heroTitle)
	if !ok {
		t.Fatalf("no Song titled %q", heroTitle)
	}
	return base, s.ID
}

func TestHeroSongShowsOffTheLyricSheet(t *testing.T) {
	base, id := hero(t)
	var s heroSong
	get(t, base, fmt.Sprintf("/api/songs/%d", id), &s)

	if s.Status != "drafting" {
		t.Errorf("status = %q, want drafting, so it opens in Write mode", s.Status)
	}
	if s.Key == "" || s.BPM == nil || s.Capo == nil {
		t.Errorf("Details key %q, BPM %v, capo %v: want all three set", s.Key, s.BPM, s.Capo)
	}

	inArrangement := map[int64]bool{}
	for _, id := range s.Arrangement {
		inArrangement[id] = true
	}
	var lines, cued, chorded, chordLines, withAlternates int
	for _, sec := range s.Sections {
		if !inArrangement[sec.ID] {
			continue
		}
		if len(sec.Alternates) > 1 {
			withAlternates++
		}
		for _, alt := range sec.Alternates {
			if !alt.Active {
				continue
			}
			for _, l := range alt.Lines {
				lines++
				if l.Cue != nil {
					cued++
				}
				if len(l.Chords) > 0 {
					chorded++
				}
				if l.ChordLine {
					chordLines++
				}
			}
		}
	}
	if chorded == 0 || chordLines == 0 {
		t.Errorf("%d Lines with Chords and %d Chord Lines: want some of each", chorded, chordLines)
	}
	if withAlternates == 0 {
		t.Error("no Section in the Arrangement has a second Alternate")
	}
	if cued*2 <= lines || cued == lines {
		t.Errorf("%d of %d Lines cued: want most, but not all, left for Sync mode", cued, lines)
	}
	if len(s.Scrapbook) == 0 {
		t.Error("the Scrapbook is empty")
	}
}
