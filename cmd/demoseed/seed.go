package main

import (
	"context"
	"fmt"
	"net/http"
)

// song is as much of a Song as the API answers with as the seed needs.
type song struct {
	ID       int64     `json:"id"`
	Sections []section `json:"sections"`
	// Scrapbook lists the ids of the Sections not in the Arrangement.
	Scrapbook []int64 `json:"scrapbook"`
}

type section struct {
	ID         int64       `json:"id"`
	Label      string      `json:"label"`
	Alternates []alternate `json:"alternates"`
}

type alternate struct {
	ID     int64 `json:"id"`
	Active bool  `json:"active"`
}

// seed fills the empty Bandmate at base with the demo content: the hero
// Song, then the other Songs, so the hero Song is the oldest.
func seed(ctx context.Context, base string, httpClient *http.Client) error {
	c := client{base: base, http: httpClient}
	var songs, beats []struct{}
	if err := c.call(ctx, http.MethodGet, "/api/songs", nil, &songs); err != nil {
		return err
	}
	if err := c.call(ctx, http.MethodGet, "/api/beats", nil, &beats); err != nil {
		return err
	}
	if len(songs) > 0 || len(beats) > 0 {
		return fmt.Errorf("%s already has %d Songs and %d Beats: the seed expects an empty Bandmate", base, len(songs), len(beats))
	}
	if err := seedHero(ctx, c); err != nil {
		return fmt.Errorf("the hero Song: %w", err)
	}
	for _, s := range otherSongs {
		if _, err := importSong(ctx, c, s.chordPro, s.status); err != nil {
			return fmt.Errorf("a Song: %w", err)
		}
	}
	return nil
}

// seedHero makes the hero Song: imported with its Chords, Details and
// Cues, then given a second Alternate of its Chorus and a Section in its
// Scrapbook.
func seedHero(ctx context.Context, c client) error {
	s, err := importSong(ctx, c, heroChordPro, "drafting")
	if err != nil {
		return err
	}
	songPath := fmt.Sprintf("/api/songs/%d", s.ID)

	// A new Alternate is an active copy of the active one: rewrite it, then
	// make the first active again, as the Cues were imported for it.
	chorus, ok := s.section("Chorus")
	if !ok {
		return fmt.Errorf("the import made no Chorus")
	}
	first := chorus.Alternates[0].ID
	if err := c.call(ctx, http.MethodPost, fmt.Sprintf("%s/sections/%d/alternates", songPath, chorus.ID),
		map[string]string{"name": "Softer"}, &s); err != nil {
		return err
	}
	chorus, _ = s.section("Chorus")
	second := chorus.Alternates[len(chorus.Alternates)-1].ID
	if err := c.call(ctx, http.MethodPut, fmt.Sprintf("%s/alternates/%d/text", songPath, second),
		map[string]string{"text": heroChorusAlternate}, nil); err != nil {
		return err
	}
	if err := c.call(ctx, http.MethodPost, fmt.Sprintf("%s/alternates/%d/activate", songPath, first), nil, nil); err != nil {
		return err
	}

	if err := c.call(ctx, http.MethodPost, songPath+"/scrapbook", map[string]string{"label": heroScrapbookLabel}, &s); err != nil {
		return err
	}
	idea, ok := s.section(heroScrapbookLabel)
	if !ok {
		return fmt.Errorf("the Scrapbook Section wasn't made")
	}
	if err := c.call(ctx, http.MethodPut, fmt.Sprintf("%s/alternates/%d/text", songPath, idea.Alternates[0].ID),
		map[string]string{"text": heroScrapbookText}, nil); err != nil {
		return err
	}
	return seedTimeline(ctx, c, songPath)
}

// timeline is as much of a Timeline as the API answers with as the seed
// needs.
type timeline struct {
	Tracks []struct {
		ID    int64 `json:"id"`
		Clips []struct {
			ID int64 `json:"id"`
		} `json:"clips"`
	} `json:"tracks"`
}

// Verse 1's Takes: capture starts a second before its first Line, and
// each of its Lines is hummed where it's cued, two bars apart.
const (
	takeCaptureStart = 4.0
	takeLength       = 21.0
)

// Notes in Hz, to hum Verse 1 to.
const (
	noteA3 = 220.0
	noteC4 = 261.63
	noteD4 = 293.66
	noteE4 = 329.63
	noteG4 = 392.0
	noteA4 = 440.0
)

// verseTakes are two Takes of Verse 1, hummed a little differently.
var verseTakes = [][]phrase{
	{
		{1, []float64{noteE4, noteE4, noteD4, noteC4, noteD4, noteE4, noteA3}},
		{6, []float64{noteC4, noteD4, noteE4, noteG4, noteE4, noteD4, noteC4}},
		{11, []float64{noteE4, noteE4, noteD4, noteC4, noteD4, noteE4, noteA3}},
		{16, []float64{noteC4, noteD4, noteE4, noteG4, noteA4, noteG4, noteE4}},
	},
	{
		{1, []float64{noteE4, noteD4, noteC4, noteC4, noteD4, noteE4, noteE4}},
		{6, []float64{noteC4, noteE4, noteG4, noteG4, noteE4, noteD4, noteD4}},
		{11, []float64{noteE4, noteD4, noteC4, noteC4, noteD4, noteE4, noteA3}},
		{16, []float64{noteD4, noteE4, noteG4, noteA4, noteA4, noteG4, noteE4}},
	},
}

// seedTimeline puts the click track Beat on the first Track, from the Beat
// Library, and two Takes of Verse 1 in a Clip on a second Track.
func seedTimeline(ctx context.Context, c client, songPath string) error {
	var tl timeline
	if err := c.call(ctx, http.MethodGet, songPath+"/timeline", nil, &tl); err != nil {
		return err
	}
	beatTrack := tl.Tracks[0].ID
	if err := c.call(ctx, http.MethodPatch, fmt.Sprintf("%s/timeline/tracks/%d", songPath, beatTrack),
		map[string]string{"name": "Beat"}, nil); err != nil {
		return err
	}

	click := clickTrack(heroBPM, 90)
	var beat struct {
		ID int64 `json:"id"`
	}
	beatDetails := map[string]any{
		"title": "Lorem Click", "producer": "Bandmate demo", "bpm": heroBPM,
		"duration": duration(click), "peaks": peaks(click),
	}
	if err := c.upload(ctx, "/api/beats", "lorem-click.wav", wav(click, 16), beatDetails, &beat); err != nil {
		return err
	}
	if err := c.call(ctx, http.MethodPost, songPath+"/timeline/beats",
		map[string]int64{"trackId": beatTrack, "beatId": beat.ID}, nil); err != nil {
		return err
	}

	if err := c.call(ctx, http.MethodPost, songPath+"/timeline/tracks", map[string]string{"name": "Lead vox"}, &tl); err != nil {
		return err
	}
	vox := tl.Tracks[len(tl.Tracks)-1].ID
	for i, phrases := range verseTakes {
		take := hum(takeLength, phrases, 0.7)
		captured := map[string]any{"captureStart": takeCaptureStart, "latencyOffset": 0, "peaks": peaks(take)}
		path := songPath + "/timeline/takes"
		if i == 0 {
			captured["trackId"], captured["start"] = vox, takeCaptureStart
		} else {
			path = fmt.Sprintf("%s/timeline/clips/%d/takes", songPath, tl.Tracks[len(tl.Tracks)-1].Clips[0].ID)
		}
		if err := c.upload(ctx, path, "take.wav", wav(take, 24), captured, &tl); err != nil {
			return err
		}
	}
	return nil
}

// section finds the Song's Section labelled label.
func (s song) section(label string) (section, bool) {
	for _, sec := range s.Sections {
		if sec.Label == label {
			return sec, true
		}
	}
	return section{}, false
}

// importSong imports a Song from ChordPro and gives it status.
func importSong(ctx context.Context, c client, chordPro, status string) (song, error) {
	var s song
	if err := c.call(ctx, http.MethodPost, "/api/songs/import", map[string]string{"text": chordPro}, &s); err != nil {
		return song{}, err
	}
	err := c.call(ctx, http.MethodPatch, fmt.Sprintf("/api/songs/%d", s.ID), map[string]string{"status": status}, &s)
	return s, err
}
