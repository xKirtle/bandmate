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

// section is as much of a Section as the seed needs.
type section struct {
	ID         int64       `json:"id"`
	Label      string      `json:"label"`
	Alternates []alternate `json:"alternates"`
}

// alternate is as much of an Alternate as the seed needs.
type alternate struct {
	ID     int64 `json:"id"`
	Active bool  `json:"active"`
}

// seed fills the empty Bandmate at base with the demo content: the other
// Songs, then the hero Song, so it's the latest edited and tops the Song
// list.
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
	for _, s := range otherSongs {
		if _, err := importSong(ctx, c, s.chordPro, s.status); err != nil {
			return fmt.Errorf("a Song: %w", err)
		}
	}
	if err := seedHero(ctx, c); err != nil {
		return fmt.Errorf("the hero Song: %w", err)
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
	firstAlternate := chorus.Alternates[0].ID
	if err := c.call(ctx, http.MethodPost, fmt.Sprintf("%s/sections/%d/alternates", songPath, chorus.ID),
		map[string]string{"name": "Softer"}, &s); err != nil {
		return err
	}
	chorus, _ = s.section("Chorus")
	secondAlternate := chorus.Alternates[len(chorus.Alternates)-1].ID
	if err := setAlternateText(ctx, c, songPath, secondAlternate, heroChorusAlternate); err != nil {
		return err
	}
	if err := c.call(ctx, http.MethodPost, fmt.Sprintf("%s/alternates/%d/activate", songPath, firstAlternate), nil, nil); err != nil {
		return err
	}

	if err := c.call(ctx, http.MethodPost, songPath+"/scrapbook", map[string]string{"label": heroScrapbookLabel}, &s); err != nil {
		return err
	}
	scrapbookSection, ok := s.section(heroScrapbookLabel)
	if !ok {
		return fmt.Errorf("the Scrapbook Section wasn't made")
	}
	if err := setAlternateText(ctx, c, songPath, scrapbookSection.Alternates[0].ID, heroScrapbookText); err != nil {
		return err
	}
	return seedTimeline(ctx, c, songPath)
}

// setAlternateText replaces the Lines of the Song's Alternate with text,
// one Line per line, Chords inline.
func setAlternateText(ctx context.Context, c client, songPath string, alternateID int64, text string) error {
	return c.call(ctx, http.MethodPut, fmt.Sprintf("%s/alternates/%d/text", songPath, alternateID),
		map[string]string{"text": text}, nil)
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
	// takeLevel is how loud the Takes are at their loudest, from 0 to 1.
	takeLevel = 0.7
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
	voxTrack := len(tl.Tracks) - 1
	for i, phrases := range verseTakes {
		take := hum(takeLength, phrases, takeLevel)
		takeDetails := map[string]any{"captureStart": takeCaptureStart, "latencyOffset": 0, "peaks": peaks(take)}
		// The first Take makes the Clip; the next is retaken into it.
		path := songPath + "/timeline/takes"
		if i == 0 {
			takeDetails["trackId"], takeDetails["start"] = tl.Tracks[voxTrack].ID, takeCaptureStart
		} else {
			path = fmt.Sprintf("%s/timeline/clips/%d/takes", songPath, tl.Tracks[voxTrack].Clips[0].ID)
		}
		// Takes are mono 24-bit WAV files (ADR 0003).
		if err := c.upload(ctx, path, "take.wav", wav(take, 24), takeDetails, &tl); err != nil {
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
