package app_test

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
)

// The web app's unit tests run against a fake of this server, one Song and
// its Timeline in memory (web/src/lib/songServerFake.ts), which makes some
// changes with maths of its own, such as where a Split cuts. The cases here
// keep the two in step: each sets a Song up on the real server and makes
// one change, and the Song or Timeline before and after it are recorded to
// contractFile. web/src/lib/songServerContract.test.ts makes the same change
// on the fake, from the recorded before, and compares what it leaves with
// the recorded after.
//
// Each change is recorded both as the web app's song server is given it and
// as the request it sends, which the web app's test checks it still sends.
// Cases are successes only: the fake isn't asked to refuse.
//
// When the server changes what a change does, this test fails until the
// file is recorded again, with
//
//	go test ./internal/app -run TestSongServerContract -update
//
// so the change shows in review as a diff of the file.

var updateContract = flag.Bool("update", false, "record "+contractFile+" again from the real server")

const contractFile = "testdata/song_server_contract.json"

// obj is a JSON object, as a change or a request body.
type obj = map[string]any

// contractChange is a change as the web app's song server makes it: the
// change as SongServer.apply is given it, and the request that sends it.
type contractChange struct {
	change obj
	method string
	path   string // under the Song's, e.g. "/timeline/clips/split"
	body   any    // nil for none
	songID int64
}

// sends gives a change of the kind and fields given to a Song, sent as a
// request to path, under the Song's, with body, or nil for none.
func sends(songID int64, kind string, fields obj, method, path string, body any) contractChange {
	change := obj{"kind": kind}
	for k, v := range fields {
		change[k] = v
	}
	return contractChange{change: change, method: method, path: path, body: body, songID: songID}
}

// contractCase sets up a Song on the real server, giving a change to make.
type contractCase struct {
	name  string
	setup func(ts *testServer) contractChange
}

// recordedCase is a case as contractFile records it.
type recordedCase struct {
	Name string `json:"name"`
	// Of says what the change changes, and so what Before and After are: a
	// "song" or a "timeline".
	Of      string          `json:"of"`
	Change  obj             `json:"change"`
	Request recordedRequest `json:"request"`
	Before  json.RawMessage `json:"before"`
	After   json.RawMessage `json:"after"`
}

// recordedRequest is a request the web app sends, its path under /api.
type recordedRequest struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Body   any    `json:"body,omitempty"`
}

func TestSongServerContract(t *testing.T) {
	var recorded []recordedCase
	cases := contractCases()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			ch := c.setup(ts)
			of := "song"
			if strings.HasPrefix(ch.path, "/timeline") {
				of = "timeline"
			}
			// Read as the change found it, which may be a version on from
			// the Song setup last returned, e.g. after a Timeline change.
			path := fmt.Sprintf("/songs/%d%s", ch.songID, ch.path)
			readPath := fmt.Sprintf("/api/songs/%d", ch.songID)
			if of == "timeline" {
				readPath = timelinePath(ch.songID)
			}
			read := ts.Do(http.MethodGet, readPath, nil)
			expectStatus(t, read, http.StatusOK)
			var at struct {
				Version int64 `json:"version"`
			}
			read.JSON(t, &at)
			res := ts.DoAt(at.Version, ch.method, "/api"+path, ch.body)
			expectStatus(t, res, http.StatusOK)
			recorded = append(recorded, recordedCase{
				Name:    c.name,
				Of:      of,
				Change:  ch.change,
				Request: recordedRequest{Method: ch.method, Path: path, Body: ch.body},
				Before:  steady(t, read.Body),
				After:   steady(t, res.Body),
			})
		})
	}
	if t.Failed() {
		return
	}
	// Run for some cases only, e.g. with -run naming one, it can't say
	// whether the file is up to date, nor record it whole.
	if len(recorded) < len(cases) {
		if *updateContract {
			t.Fatalf("recording %s needs every case: run it without naming any", contractFile)
		}
		return
	}

	got, err := json.MarshalIndent(recorded, "", "  ")
	if err != nil {
		t.Fatalf("encoding the cases: %v", err)
	}
	got = append(got, '\n')
	if *updateContract {
		if err := os.WriteFile(contractFile, got, 0o644); err != nil {
			t.Fatalf("writing %s: %v", contractFile, err)
		}
		return
	}
	want, err := os.ReadFile(contractFile)
	if err != nil {
		t.Fatalf("reading %s: %v; record it with -update", contractFile, err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("%s is out of date: %s. Record it again with\n"+
			"\tgo test ./internal/app -run TestSongServerContract -update\n"+
			"and check the fake in web/src/lib/songServerFake.ts still matches",
			contractFile, changedCases(t, recorded, want))
	}
}

// changedCases names the cases that differ from those recorded in want.
func changedCases(t *testing.T, got []recordedCase, want []byte) string {
	t.Helper()
	var was []recordedCase
	if err := json.Unmarshal(want, &was); err != nil {
		return "it can't be read"
	}
	old := map[string]string{}
	for _, c := range was {
		b, _ := json.Marshal(c)
		old[c.Name] = string(b)
	}
	var changed []string
	for _, c := range got {
		b, _ := json.Marshal(c)
		if prev, ok := old[c.Name]; !ok {
			changed = append(changed, fmt.Sprintf("%q is new", c.Name))
		} else if prev != string(b) {
			changed = append(changed, fmt.Sprintf("%q changed", c.Name))
		}
		delete(old, c.Name)
	}
	for name := range old {
		changed = append(changed, fmt.Sprintf("%q is gone", name))
	}
	if len(changed) == 0 {
		return "its layout differs"
	}
	return strings.Join(changed, ", ")
}

// timestamps are the fields that tell the time something happened, which
// differ every run.
var timestamps = map[string]bool{"createdAt": true, "updatedAt": true, "addedAt": true, "recordedAt": true, "takenAt": true}

// steady is a Song or Timeline as JSON with every timestamp set to the
// same time, so it records the same every run.
func steady(t *testing.T, body []byte) json.RawMessage {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatalf("decoding %s: %v", body, err)
	}
	var walk func(v any)
	walk = func(v any) {
		switch v := v.(type) {
		case map[string]any:
			for k, x := range v {
				if timestamps[k] {
					v[k] = "2026-01-01T00:00:00Z"
				} else {
					walk(x)
				}
			}
		case []any:
			for _, x := range v {
				walk(x)
			}
		}
	}
	walk(v)
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("encoding: %v", err)
	}
	return b
}

// sheetCopyOf is a Song's Lyric Sheet and Scrapbook as the web app copies
// them to put back: only what's written, with every id.
func sheetCopyOf(s song) obj {
	sections := []obj{}
	for _, sec := range s.Sections {
		alternates := []obj{}
		for _, a := range sec.Alternates {
			lines := []obj{}
			for _, l := range a.Lines {
				lines = append(lines, obj{"id": l.ID, "text": l.Text, "cue": l.Cue})
			}
			alternates = append(alternates, obj{"id": a.ID, "name": a.Name, "active": a.Active, "lines": lines})
		}
		sections = append(sections, obj{"id": sec.ID, "label": sec.Label, "alternates": alternates})
	}
	return obj{"arrangement": s.Arrangement, "scrapbook": s.Scrapbook, "sections": sections}
}

// contractCases are the changes recorded: at least one of every kind the
// fake makes, and more where its maths could go wrong.
func contractCases() []contractCase {
	clipPath := func(id int64, rest string) string { return fmt.Sprintf("/timeline/clips/%d%s", id, rest) }
	trackPath := func(id int64) string { return fmt.Sprintf("/timeline/tracks/%d", id) }
	beatClip := func(beatID int64, start, offset, length float64) obj {
		return obj{"beatId": beatID, "start": start, "offset": offset, "length": length}
	}
	// onTrack is a Clip placed or pasted at once, as the change gives it
	// and as the request sends it.
	onTrack := func(on obj, clip obj) (change, sent obj) {
		change, sent = obj{"clip": clip}, obj{}
		for k, v := range on {
			change[k], sent[k] = v, v
		}
		for k, v := range clip {
			sent[k] = v
		}
		return change, sent
	}
	twoClipsOf := func(ts *testServer) twoClips { return placeTwoClips(ts.t, ts) }
	// The ids of placeTwoClips's Tracks: the first, with both Clips, and "Adlibs", empty.
	adlibs := func(p twoClips) int64 { return p.tl.Tracks[1].ID }
	verse := func(p twoClips) int64 { return p.tl.Tracks[0].ID }

	sectionPath := func(id int64, rest string) string { return fmt.Sprintf("/sections/%d%s", id, rest) }
	alternatePath := func(id int64, rest string) string { return fmt.Sprintf("/alternates/%d%s", id, rest) }
	linePath := func(id int64) string { return fmt.Sprintf("/lines/%d/cue", id) }

	return []contractCase{
		// The Loop.
		{"set the Loop", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			loop := obj{"start": 4, "end": 12.5, "on": true}
			return sends(p.song.ID, "setLoop", obj{"loop": loop}, http.MethodPut, "/timeline/loop", loop)
		}},
		{"switch the Loop off", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.setLoop(p.song.ID, obj{"start": 4, "end": 12.5, "on": true}))
			return sends(p.song.ID, "switchLoop", obj{"on": false}, http.MethodPatch, "/timeline/loop", obj{"on": false})
		}},
		{"clear the Loop", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.setLoop(p.song.ID, obj{"start": 4, "end": 12.5, "on": true}))
			return sends(p.song.ID, "clearLoop", nil, http.MethodDelete, "/timeline/loop", nil)
		}},

		// Tracks.
		{"add a Track at the bottom", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			track := obj{"name": " Keys  "}
			return sends(p.song.ID, "addTrack", obj{"track": track}, http.MethodPost, "/timeline/tracks", track)
		}},
		{"rename a Track and set its levels", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			changes := obj{"name": "  Vocals ", "volume": -6.5, "muted": true, "soloed": true}
			return sends(p.song.ID, "updateTrack", obj{"trackId": adlibs(p), "changes": changes},
				http.MethodPatch, trackPath(adlibs(p)), changes)
		}},
		{"delete a Track with its Clips", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			return sends(p.song.ID, "deleteTrack", obj{"trackId": verse(p)}, http.MethodDelete, trackPath(verse(p)), nil)
		}},

		// Placing Clips.
		{"place a Clip with its own name, Gain, Tempo, Pitch and Fades", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			clip := beatClip(p.short.ID, 5, 1, 4)
			for k, v := range (obj{"name": "Hook", "gain": -2, "tempo": 0.5, "pitch": 2, "fadeIn": 1, "fadeOut": 0.5}) {
				clip[k] = v
			}
			change, sent := onTrack(obj{"trackId": adlibs(p)}, clip)
			return sends(p.song.ID, "placeClip", change, http.MethodPost, "/timeline/clips", sent)
		}},
		{"place several Clips at once", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			a, sentA := onTrack(obj{"trackId": adlibs(p)}, beatClip(p.short.ID, 0, 0, 10))
			b, sentB := onTrack(obj{"trackId": verse(p)}, beatClip(p.long.ID, 12, 0, 5))
			return sends(p.song.ID, "placeClips", obj{"clips": []obj{a, b}},
				http.MethodPost, "/timeline/clips/place", obj{"newTracks": []obj{}, "clips": []obj{sentA, sentB}})
		}},
		{"replace a Clip with others", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			a, sentA := onTrack(obj{"trackId": adlibs(p)}, beatClip(p.short.ID, 2, 0, 8))
			b, sentB := onTrack(obj{"trackId": verse(p)}, beatClip(p.short.ID, 1, 1, 9))
			ids := []int64{p.first}
			return sends(p.song.ID, "replaceClips", obj{"clipIds": ids, "clips": []obj{a, b}},
				http.MethodPost, "/timeline/clips/replace",
				obj{"clipIds": ids, "trackIds": []int64{}, "newTracks": []obj{}, "clips": []obj{sentA, sentB}})
		}},
		{"paste Clips", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			clip := beatClip(p.long.ID, 0, 2, 6)
			clip["gain"] = -1
			a, sentA := onTrack(obj{"trackId": adlibs(p)}, clip)
			return sends(p.song.ID, "pasteClips", obj{"clips": []obj{a}, "newTracks": []obj{}},
				http.MethodPost, "/timeline/clips/paste", obj{"newTracks": []obj{}, "clips": []obj{sentA}})
		}},
		{"paste Clips onto Tracks added at the bottom", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			a, sentA := onTrack(obj{"newTrack": 1}, beatClip(p.short.ID, 3, 0, 10))
			b, sentB := onTrack(obj{"trackId": adlibs(p)}, beatClip(p.long.ID, 3, 4, 6))
			c, sentC := onTrack(obj{"newTrack": 0}, beatClip(p.long.ID, 0, 0, 20))
			newTracks := []obj{{"name": "Adlibs 2"}, {"name": " Adlibs 3 "}}
			return sends(p.song.ID, "pasteClips", obj{"clips": []obj{a, b, c}, "newTracks": newTracks},
				http.MethodPost, "/timeline/clips/paste", obj{"newTracks": newTracks, "clips": []obj{sentA, sentB, sentC}})
		}},
		{"duplicate a Clip, right after it", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.setClipFades(p.song.ID, p.first, 2, 1))
			timelineChange(ts.t, ts.renameClip(p.song.ID, p.first, "Intro"))
			return sends(p.song.ID, "duplicateClip", obj{"clipId": p.first},
				http.MethodPost, clipPath(p.first, "/duplicate"), nil)
		}},
		{"duplicate a Clip after its Track's last when one is in the way", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			// The long Beat's Clip plays 0:12 to 0:32, where the copy would go.
			timelineChange(ts.t, ts.moveClip(p.song.ID, p.second, verse(p), 12))
			return sends(p.song.ID, "duplicateClip", obj{"clipId": p.first},
				http.MethodPost, clipPath(p.first, "/duplicate"), nil)
		}},

		// Splitting.
		{"split a Clip, keeping its name, Gain and the Fades away from the cut", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.renameClip(p.song.ID, p.second, "Hook"))
			timelineChange(ts.t, ts.setClipGain(p.song.ID, p.second, -3))
			timelineChange(ts.t, ts.trimClip(p.song.ID, p.second, 2, 16))
			timelineChange(ts.t, ts.setClipFades(p.song.ID, p.second, 4, 3))
			ids := []int64{p.second}
			return sends(p.song.ID, "splitClips", obj{"clipIds": ids, "at": 40},
				http.MethodPost, "/timeline/clips/split", obj{"clipIds": ids, "at": 40})
		}},
		{"split a Clip, shortening a Fade that runs past the cut", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.setClipFades(p.song.ID, p.first, 6, 3))
			ids := []int64{p.first}
			return sends(p.song.ID, "splitClips", obj{"clipIds": ids, "at": 2},
				http.MethodPost, "/timeline/clips/split", obj{"clipIds": ids, "at": 2})
		}},
		{"split a Clip near its end, shortening its Fade out", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.setClipFades(p.song.ID, p.first, 1, 4))
			ids := []int64{p.first}
			return sends(p.song.ID, "splitClips", obj{"clipIds": ids, "at": 8.5},
				http.MethodPost, "/timeline/clips/split", obj{"clipIds": ids, "at": 8.5})
		}},
		{"split a Clip at another Tempo, its right half starting where the cut is in its source", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			// Slowed to half speed, it plays its 10 s over 0:00 to 0:20.
			timelineChange(ts.t, ts.moveClip(p.song.ID, p.second, verse(p), 40))
			timelineChange(ts.t, ts.setClipTempo(p.song.ID, p.first, 0.5))
			ids := []int64{p.first}
			return sends(p.song.ID, "splitClips", obj{"clipIds": ids, "at": 6},
				http.MethodPost, "/timeline/clips/split", obj{"clipIds": ids, "at": 6})
		}},
		{"split several Clips at once", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.placeClip(p.song.ID, obj{"trackId": adlibs(p), "beatId": p.long.ID, "start": 1, "offset": 3, "length": 12}))
			tl := ts.getTimeline(p.song.ID)
			ids := []int64{p.first, tl.Tracks[1].Clips[0].ID}
			return sends(p.song.ID, "splitClips", obj{"clipIds": ids, "at": 5},
				http.MethodPost, "/timeline/clips/split", obj{"clipIds": ids, "at": 5})
		}},

		// Moving Clips.
		{"move a Clip onto another Track", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			return sends(p.song.ID, "moveClip", obj{"clipId": p.second, "trackId": adlibs(p), "start": 5},
				http.MethodPost, clipPath(p.second, "/move"), obj{"trackId": adlibs(p), "start": 5})
		}},
		{"move several Clips at once", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			moves := []obj{
				{"clipId": p.first, "trackId": adlibs(p), "start": 3},
				{"clipId": p.second, "trackId": verse(p), "start": 0},
			}
			return sends(p.song.ID, "moveClips", obj{"moves": moves},
				http.MethodPost, "/timeline/clips/move", obj{"clips": moves})
		}},

		// A Clip's own name, Gain, Nudge, Fades, Tempo and Pitch.
		{"set a Clip's Gain", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			return sends(p.song.ID, "setClipGain", obj{"clipId": p.first, "gain": -4.5},
				http.MethodPut, clipPath(p.first, "/gain"), obj{"gain": -4.5})
		}},
		{"set a Clip's Nudge", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			return sends(p.song.ID, "setClipNudge", obj{"clipId": p.first, "nudge": -0.25},
				http.MethodPut, clipPath(p.first, "/nudge"), obj{"nudge": -0.25})
		}},
		{"set a Clip's Fades", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			return sends(p.song.ID, "setClipFades", obj{"clipId": p.first, "fadeIn": 2, "fadeOut": 1.5},
				http.MethodPut, clipPath(p.first, "/fades"), obj{"fadeIn": 2, "fadeOut": 1.5})
		}},
		{"set Clips' Tempo, their lengths and Fades scaling", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.setClipFades(p.song.ID, p.first, 2, 1))
			timelineChange(ts.t, ts.setClipFades(p.song.ID, p.second, 3, 5))
			tempos := []obj{{"clipId": p.first, "tempo": 0.8}, {"clipId": p.second, "tempo": 1.25}}
			return sends(p.song.ID, "setClipTempos", obj{"tempos": tempos},
				http.MethodPost, "/timeline/clips/tempo", obj{"clips": tempos})
		}},
		{"set a Clip's Tempo again, from one already set", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.setClipTempo(p.song.ID, p.second, 0.75))
			timelineChange(ts.t, ts.setClipFades(p.song.ID, p.second, 2, 4))
			tempos := []obj{{"clipId": p.second, "tempo": 1.5}}
			return sends(p.song.ID, "setClipTempos", obj{"tempos": tempos},
				http.MethodPost, "/timeline/clips/tempo", obj{"clips": tempos})
		}},
		{"set Clips' Pitch", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			pitches := []obj{{"clipId": p.first, "pitch": 3}, {"clipId": p.second, "pitch": -2}}
			return sends(p.song.ID, "setClipPitches", obj{"pitches": pitches},
				http.MethodPost, "/timeline/clips/pitch", obj{"clips": pitches})
		}},
		{"rename a Clip", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			return sends(p.song.ID, "renameClip", obj{"clipId": p.first, "name": "  Intro "},
				http.MethodPut, clipPath(p.first, "/name"), obj{"name": "  Intro "})
		}},
		{"clear a Clip's name", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.renameClip(p.song.ID, p.first, "Intro"))
			return sends(p.song.ID, "renameClip", obj{"clipId": p.first, "name": " "},
				http.MethodPut, clipPath(p.first, "/name"), obj{"name": " "})
		}},

		// Deleting Clips.
		{"delete a Clip", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			return sends(p.song.ID, "deleteClip", obj{"clipId": p.first}, http.MethodDelete, clipPath(p.first, ""), nil)
		}},
		{"delete several Clips at once", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			ids := []int64{p.first, p.second}
			return sends(p.song.ID, "deleteClips", obj{"clipIds": ids},
				http.MethodPost, "/timeline/clips/delete", obj{"clipIds": ids, "trackIds": []int64{}})
		}},
		{"delete Clips and Tracks with them", func(ts *testServer) contractChange {
			p := twoClipsOf(ts)
			timelineChange(ts.t, ts.moveClip(p.song.ID, p.second, adlibs(p), 0))
			ids, tracks := []int64{p.second}, []int64{adlibs(p)}
			return sends(p.song.ID, "deleteClips", obj{"clipIds": ids, "trackIds": tracks},
				http.MethodPost, "/timeline/clips/delete", obj{"clipIds": ids, "trackIds": tracks})
		}},

		// Cues, on cuedChorus's Song: the first Chorus's first two Lines
		// cued at 0:01 and 0:03, and its third copy's at 0:20 and 0:22,
		// with 0:23 on the Line of its inactive Alternate, dormant.
		{"set a Line's Cue, to the millisecond", func(ts *testServer) contractChange {
			s := ts.cuedChorus()
			_, _, _, chords := chorusLines(s)
			return sends(s.ID, "setLineCue", obj{"lineId": chords, "cue": 4.1236},
				http.MethodPut, linePath(chords), obj{"cue": 4.1236})
		}},
		{"clear a Line's Cue", func(ts *testServer) contractChange {
			s := ts.cuedChorus()
			drive, _, _, _ := chorusLines(s)
			return sends(s.ID, "setLineCue", obj{"lineId": drive, "cue": nil}, http.MethodDelete, linePath(drive), nil)
		}},
		{"clear a Section's Cues, dormant ones too", func(ts *testServer) contractChange {
			s := ts.cuedChorus()
			third := s.Arrangement[len(s.Arrangement)-1]
			return sends(s.ID, "clearSectionCues", obj{"sectionId": third}, http.MethodDelete, sectionPath(third, "/cues"), nil)
		}},
		{"clear every Cue", func(ts *testServer) contractChange {
			s := ts.cuedChorus()
			return sends(s.ID, "clearCues", nil, http.MethodDelete, "/cues", nil)
		}},
		{"shift the Cues from a start up to an end, dormant ones too", func(ts *testServer) contractChange {
			s := ts.cuedChorus()
			shift := obj{"start": 0, "end": 22.5, "by": 1.5}
			return sends(s.ID, "shiftCues", shift, http.MethodPost, "/cues/shift", shift)
		}},
		{"shift the Cues back, from one cued at the start to one cued at the end, which stays", func(ts *testServer) contractChange {
			s := ts.cuedChorus()
			shift := obj{"start": 3, "end": 22, "by": -0.25}
			return sends(s.ID, "shiftCues", shift, http.MethodPost, "/cues/shift", shift)
		}},
		{"shift the Cues by a step of less than a millisecond", func(ts *testServer) contractChange {
			s := ts.cuedChorus()
			shift := obj{"start": 0.0004, "end": 20.0006, "by": 0.0337}
			return sends(s.ID, "shiftCues", shift, http.MethodPost, "/cues/shift", shift)
		}},
		{"restore Cues", func(ts *testServer) contractChange {
			s := ts.cuedChorus()
			drive, night, _, chords := chorusLines(s)
			cues := []obj{{"lineId": drive, "cue": nil}, {"lineId": night, "cue": 7.5}, {"lineId": chords, "cue": 9.0004}}
			return sends(s.ID, "restoreCues", obj{"cues": cues}, http.MethodPatch, "/cues", obj{"cues": cues})
		}},

		// The Lyric Sheet.
		{"add a Section at the end of the Arrangement", func(ts *testServer) contractChange {
			s := ts.songWithSections("Verse", "Chorus")
			return sends(s.ID, "addSection", nil, http.MethodPost, "/sections", obj{})
		}},
		{"add a Section into the Arrangement", func(ts *testServer) contractChange {
			s := ts.songWithSections("Verse", "Chorus")
			return sends(s.ID, "addSection", obj{"position": 1}, http.MethodPost, "/sections", obj{"position": 1})
		}},
		{"add a Section to the Scrapbook", func(ts *testServer) contractChange {
			s := ts.songWithSections("Verse")
			s = ts.addToScrapbook(s.ID, "Idea")
			return sends(s.ID, "addToScrapbook", nil, http.MethodPost, "/scrapbook", obj{"label": ""})
		}},
		{"take a Section out of the Arrangement, to the Scrapbook", func(ts *testServer) contractChange {
			s := ts.songWithSections("Verse", "Chorus")
			s = ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "City lights")
			id := s.Arrangement[0]
			return sends(s.ID, "removeFromArrangement", obj{"sectionId": id}, http.MethodDelete, fmt.Sprintf("/arrangement/%d", id), nil)
		}},
		{"take a Section with nothing written in it out of the Arrangement, deleting it", func(ts *testServer) contractChange {
			s := ts.songWithSections("Verse", "Chorus")
			id := s.Arrangement[1]
			return sends(s.ID, "removeFromArrangement", obj{"sectionId": id}, http.MethodDelete, fmt.Sprintf("/arrangement/%d", id), nil)
		}},
		{"delete a Section in the Scrapbook", func(ts *testServer) contractChange {
			s := ts.songWithSections("Verse")
			s = ts.addToScrapbook(s.ID, "Idea")
			s = ts.addToScrapbook(s.ID, "Other")
			id := s.Scrapbook[0]
			return sends(s.ID, "deleteSection", obj{"sectionId": id}, http.MethodDelete, sectionPath(id, ""), nil)
		}},
		{"add a Section's Alternates to another Section", func(ts *testServer) contractChange {
			s := ts.songWithSections("Chorus")
			s = ts.setText(s.ID, s.Sections[0].Alternates[0].ID, "Drive, [Am]drive")
			// Its first Alternate has no name, so takes its Label; its second keeps "Darker".
			s, scrap := ts.scrapWithTwoAlternates(s.ID, "Idea")
			target := s.Arrangement[0]
			return sends(s.ID, "addToSection", obj{"sectionId": scrap.ID, "targetId": target},
				http.MethodPost, sectionPath(scrap.ID, "/add-to-section"), obj{"sectionId": target})
		}},
		{"set a Section's Label", func(ts *testServer) contractChange {
			s := ts.songWithSections("Verse")
			id := s.Arrangement[0]
			return sends(s.ID, "setSectionLabel", obj{"sectionId": id, "label": "  Pre-Chorus "},
				http.MethodPatch, sectionPath(id, ""), obj{"label": "  Pre-Chorus "})
		}},
		{"remove a Section's Label", func(ts *testServer) contractChange {
			s := ts.songWithSections("Verse")
			id := s.Arrangement[0]
			return sends(s.ID, "setSectionLabel", obj{"sectionId": id, "label": ""},
				http.MethodPatch, sectionPath(id, ""), obj{"label": ""})
		}},
		{"rename an Alternate", func(ts *testServer) contractChange {
			s, chorus := ts.chorusWithTwoAlternates()
			id := chorus.Alternates[1].ID
			return sends(s.ID, "renameAlternate", obj{"alternateId": id, "name": " Softer  "},
				http.MethodPatch, alternatePath(id, ""), obj{"name": " Softer  "})
		}},
		{"replace an Alternate's text, unchanged and edited Lines keeping their ids and Cues", func(ts *testServer) contractChange {
			s, a := ts.verseWithLines("City lights\nare calling\nme home\n\nagain")
			ts.setLineCue(s.ID, a.Lines[1].ID, 4)
			ts.setLineCue(s.ID, a.Lines[2].ID, 6)
			s = ts.getSong(s.ID)
			// Blank lines at the end are dropped.
			text := "Neon lights\nare [Am]calling\n\nme home tonight\nagain\n \n"
			return sends(s.ID, "replaceAlternateText", obj{"alternateId": a.ID, "text": text},
				http.MethodPut, alternatePath(a.ID, "/text"), obj{"text": text})
		}},
		{"reorder the Arrangement", func(ts *testServer) contractChange {
			s := ts.songWithSections("Verse", "Chorus", "Bridge")
			order := []int64{s.Arrangement[2], s.Arrangement[0], s.Arrangement[1]}
			return sends(s.ID, "reorderArrangement", obj{"order": order}, http.MethodPut, "/arrangement", obj{"sections": order})
		}},
		{"put the Lyric Sheet back, a Line still there keeping its Cue", func(ts *testServer) contractChange {
			s, a := ts.verseWithLines("City lights\nare calling\nme home")
			ts.setLineCue(s.ID, a.Lines[0].ID, 1)
			s = ts.addToScrapbook(s.ID, "Idea")
			s = ts.setText(s.ID, sectionsByID(s)[s.Scrapbook[0]].Alternates[0].ID, "Neon rain")
			copied := sheetCopyOf(s)
			ts.setLineCue(s.ID, a.Lines[0].ID, 2)
			ts.setText(s.ID, a.ID, "City lights\nme home")
			ts.lyricSheetChange(http.MethodDelete, fmt.Sprintf("/api/songs/%d/sections/%d", s.ID, s.Scrapbook[0]), nil)
			s = ts.setLabel(s.ID, s.Arrangement[0], "Chorus")
			return sends(s.ID, "putSheetBack", obj{"sheet": copied}, http.MethodPut, "/sheet", copied)
		}},
	}
}
