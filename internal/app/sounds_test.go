package app_test

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
)

// sound is a Sound as the API returns it, in a Timeline or on its own.
type sound struct {
	ID       int64     `json:"id"`
	Name     string    `json:"name"`
	FileName string    `json:"fileName"`
	Size     int64     `json:"size"`
	Duration float64   `json:"duration"`
	Peaks    []float64 `json:"peaks"`
}

// soundFile is an audio file to import as a Sound onto a Track, lasting
// duration seconds, named as the browser read it from the file.
func soundFile(fileName, name string, trackID int64, duration float64) audioUpload {
	u := fakeAudio(fileName)
	u.ContentType = "audio/mp4"
	return u.with(map[string]any{"trackId": trackID, "name": name, "duration": duration})
}

// importSound sends an audio file to import as a Sound.
func (ts *testServer) importSound(songID int64, u audioUpload) response {
	ts.t.Helper()
	return ts.SendUpload(http.MethodPost, timelinePath(songID)+"/sounds", u)
}

func soundPath(songID, soundID int64) string {
	return fmt.Sprintf("/api/songs/%d/sounds/%d", songID, soundID)
}

func TestAnImportedSoundLandsInANewClipAtTheEndOfItsTrack(t *testing.T) {
	ts := newTestServer(t)
	s, tl := songWithVocalTrack(t, ts)

	got := timelineChange(t, ts.importSound(s.ID, soundFile("hum idea.m4a", "Hum idea", tl.Tracks[0].ID, 12.5)))

	clips := got.Tracks[0].Clips
	if len(clips) != 2 || clips[1].SoundID == nil {
		t.Fatalf("clips = %+v, want the Beat's and the Sound's", clips)
	}
	c := clips[1]
	if c.Start != 30 || c.Offset != 0 || c.Length != 12.5 || c.Name != nil {
		t.Errorf("clip = %+v, want the whole Sound, unnamed, after the Beat at 30", c)
	}
	want := []sound{{ID: *c.SoundID, Name: "Hum idea", FileName: "hum idea.m4a", Size: int64(len(fakeAudio("hum idea.m4a").Data)), Duration: 12.5}}
	if !reflect.DeepEqual(got.Sounds, want) {
		t.Errorf("sounds = %+v, want %+v", got.Sounds, want)
	}
	if len(got.Beats) != 1 {
		t.Errorf("beats = %+v, want only the Beat", got.Beats)
	}

	empty := timelineChange(t, ts.importSound(s.ID, soundFile("riff.wav", "Riff", tl.Tracks[1].ID, 3)))
	if c := empty.Tracks[1].Clips; len(c) != 1 || c[0].Start != 0 || c[0].Length != 3 {
		t.Errorf("clips on the empty Track = %+v, want the Sound at 0:00", c)
	}
	if read := ts.getTimeline(s.ID); !reflect.DeepEqual(read, empty) {
		t.Errorf("read timeline = %+v, want %+v", read, empty)
	}
}

// songWithSound is a Song with a 30-second Beat on Track 1, then an
// 8-second Sound after it, and an empty "Lead vox" Track below.
func songWithSound(t *testing.T, ts *testServer) (song, timeline, clip) {
	t.Helper()
	s, tl := songWithVocalTrack(t, ts)
	tl = timelineChange(t, ts.importSound(s.ID, soundFile("hum.m4a", "Hum", tl.Tracks[0].ID, 8)))
	return s, tl, tl.Tracks[0].Clips[1]
}

func TestASoundWithoutANameIsNamedAfterItsFile(t *testing.T) {
	ts := newTestServer(t)
	s, tl := songWithVocalTrack(t, ts)

	got := timelineChange(t, ts.importSound(s.ID, soundFile("guitar line.take2.wav", "  ", tl.Tracks[1].ID, 3)))

	if len(got.Sounds) != 1 || got.Sounds[0].Name != "guitar line.take2" {
		t.Errorf("sounds = %+v, want one named after its file, without its extension", got.Sounds)
	}
}

func TestASoundsFileIsKeptExactlyAsUploaded(t *testing.T) {
	ts := newTestServer(t)
	s, _, c := songWithSound(t, ts)
	upload := soundFile("hum.m4a", "Hum", 0, 8)
	path := soundPath(s.ID, *c.SoundID)

	played := ts.Do(http.MethodGet, path+"/audio", nil)
	expectStatus(t, played, http.StatusOK)
	if !bytes.Equal(played.Body, upload.Data) {
		t.Errorf("audio = %q, want the file as uploaded", played.Body)
	}
	if got := played.Header.Get("Content-Type"); got != "audio/mp4" {
		t.Errorf("Content-Type = %q, want the type it was uploaded as", got)
	}
	if got := played.Header.Get("Content-Disposition"); got != "" {
		t.Errorf("Content-Disposition = %q, want none so it plays", got)
	}

	download := ts.Do(http.MethodGet, path+"/audio?download", nil)
	expectStatus(t, download, http.StatusOK)
	if !bytes.Equal(download.Body, upload.Data) {
		t.Errorf("download = %q, want the file as uploaded", download.Body)
	}
	if got, want := download.Header.Get("Content-Disposition"), `attachment; filename=hum.m4a`; got != want {
		t.Errorf("Content-Disposition = %q, want its original name: %q", got, want)
	}

	var read sound
	res := ts.Do(http.MethodGet, path, nil)
	expectStatus(t, res, http.StatusOK)
	res.JSON(t, &read)
	want := sound{ID: *c.SoundID, Name: "Hum", FileName: "hum.m4a", Size: int64(len(upload.Data)), Duration: 8,
		Peaks: []float64{0.1, 0.5, 1, 0.25}}
	if !reflect.DeepEqual(read, want) {
		t.Errorf("sound = %+v, want %+v", read, want)
	}
}

func TestASoundIsOnlyFoundInItsOwnSong(t *testing.T) {
	ts := newTestServer(t)
	_, _, c := songWithSound(t, ts)
	other := ts.createSong("Other")

	expectStatus(t, ts.Do(http.MethodGet, soundPath(other.ID, *c.SoundID), nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodGet, soundPath(other.ID, *c.SoundID)+"/audio", nil), http.StatusNotFound)
}

func TestAnImportThatCantBeUsedIsRefusedAndKeepsNothing(t *testing.T) {
	ts := newTestServerWith(t, func(c *app.Config) { c.MaxUploadBytes = 1 << 20 })
	s, tl := songWithVocalTrack(t, ts)
	track := tl.Tracks[1].ID

	tooBig := soundFile("big.wav", "Big", track, 3)
	tooBig.Data = bytes.Repeat([]byte{1}, 1<<20+1)
	expectError(t, ts.importSound(s.ID, tooBig),
		http.StatusRequestEntityTooLarge, "the file is larger than the upload limit of 1 MB")
	expectError(t, ts.importSound(s.ID, soundFile("hum.m4a", "Hum", track, 3).with(map[string]any{"peaks": []float64{}})),
		http.StatusBadRequest, "peaks are required")
	expectError(t, ts.importSound(s.ID, soundFile("hum.m4a", "Hum", 9999, 3)),
		http.StatusBadRequest, "there's no such Track on this Timeline")

	if read := ts.getTimeline(s.ID); !reflect.DeepEqual(read, tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, tl)
	}
	if files := soundFiles(t, ts); len(files) != 0 {
		t.Errorf("sound files = %q, want none kept", files)
	}
}

// An import that fails partway, once its Sound is added and its file set to
// be kept, changes nothing and keeps no file.
func TestAnImportThatFailsPartwayKeepsNothing(t *testing.T) {
	ts := newTestServer(t)
	s, tl := songWithVocalTrack(t, ts)
	ts.failStatements(inserts, "clips")

	expectStatus(t, ts.importSound(s.ID, soundFile("hum.m4a", "Hum", tl.Tracks[1].ID, 3)),
		http.StatusInternalServerError)

	if read := ts.getTimeline(s.ID); !reflect.DeepEqual(read, tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, tl)
	}
	if files := soundFiles(t, ts); len(files) != 0 {
		t.Errorf("sound files = %q, want none kept", files)
	}
}

// soundFiles lists the files stored for Sounds in the data directory.
func soundFiles(t *testing.T, ts *testServer) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(ts.DataDir, "audio", "sounds"))
	if err != nil {
		t.Fatalf("reading audio directory: %v", err)
	}
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestASoundClipMovesAndTrimsLikeABeatClip(t *testing.T) {
	ts := newTestServer(t)
	s, tl, c := songWithSound(t, ts)
	vox := tl.Tracks[1].ID

	got := timelineChange(t, ts.moveClip(s.ID, c.ID, vox, 4))
	if moved := clipByID(t, got, c.ID); moved.Start != 4 || got.Tracks[1].Clips[0].ID != c.ID {
		t.Errorf("clip = %+v, want it moved onto Lead vox at 4", moved)
	}
	got = timelineChange(t, ts.trimClip(s.ID, c.ID, 1, 5))
	if trimmed := clipByID(t, got, c.ID); trimmed.Start != 5 || trimmed.Offset != 1 || trimmed.Length != 5 {
		t.Errorf("clip = %+v, want it trimmed to 5 seconds from 1, starting at 5", trimmed)
	}
	expectError(t, ts.trimClip(s.ID, c.ID, 1, 7.5), http.StatusBadRequest, "a Clip can't play past the end of its source")
	expectError(t, ts.moveClip(s.ID, c.ID, tl.Tracks[0].ID, 20), http.StatusConflict, "Clips can't overlap on a Track")
}

func TestDuplicatingASoundClipUsesTheSameSound(t *testing.T) {
	ts := newTestServer(t)
	s, _, c := songWithSound(t, ts)

	got := timelineChange(t, ts.duplicateClip(s.ID, c.ID))

	clips := got.Tracks[0].Clips
	if len(clips) != 3 || clips[2].SoundID == nil || *clips[2].SoundID != *c.SoundID || clips[2].Start != 38 {
		t.Fatalf("clips = %+v, want a copy of the Sound's Clip after it, at 38", clips)
	}
	if len(got.Sounds) != 1 {
		t.Errorf("sounds = %+v, want only the one, used twice", got.Sounds)
	}
	if files := soundFiles(t, ts); len(files) != 1 {
		t.Errorf("sound files = %q, want the one file, not copied", files)
	}
}

func TestADeletedSoundClipCanBePlacedBackPlayingTheSameSound(t *testing.T) {
	ts := newTestServer(t)
	s, tl, c := songWithSound(t, ts)
	timelineChange(t, ts.renameClip(s.ID, c.ID, "Hook"))
	timelineChange(t, ts.deleteClip(s.ID, c.ID))

	got := timelineChange(t, ts.placeClip(s.ID, map[string]any{
		"trackId": tl.Tracks[0].ID, "soundId": *c.SoundID, "name": "Hook", "start": 30, "offset": 0, "length": 8,
	}))

	back := got.Tracks[0].Clips[1]
	if back.SoundID == nil || *back.SoundID != *c.SoundID || nameOf(back) != "Hook" || back.Start != 30 || back.Length != 8 {
		t.Errorf("clip = %+v, want the Sound's Clip back as it was", back)
	}
	if len(got.Sounds) != 1 || got.Sounds[0].Name != "Hum" {
		t.Errorf("sounds = %+v, want the Sound it played", got.Sounds)
	}
	expectStatus(t, ts.Do(http.MethodGet, soundPath(s.ID, *c.SoundID)+"/audio", nil), http.StatusOK)
}

func TestASoundCantBePlacedInAnotherSongsClips(t *testing.T) {
	ts := newTestServer(t)
	_, _, c := songWithSound(t, ts)
	other := ts.createSong("Other")
	track := ts.getTimeline(other.ID).Tracks[0].ID

	expectError(t, ts.placeClip(other.ID, map[string]any{
		"trackId": track, "soundId": *c.SoundID, "start": 0, "offset": 0, "length": 8,
	}), http.StatusBadRequest, "there's no such Sound in this Song")
}

func TestDeletingASongDeletesItsSoundsAndTheirFiles(t *testing.T) {
	ts := newTestServer(t)
	s, tl, c := songWithSound(t, ts)
	// One of its Sounds is unused, and still goes.
	unused := timelineChange(t, ts.importSound(s.ID, soundFile("riff.wav", "Riff", tl.Tracks[1].ID, 3))).Tracks[1].Clips[0]
	timelineChange(t, ts.deleteClip(s.ID, unused.ID))
	_, _, kept := songWithSound(t, ts)

	expectStatus(t, ts.Do(http.MethodDelete, songPath(s.ID), nil), http.StatusNoContent)

	expectStatus(t, ts.Do(http.MethodGet, soundPath(s.ID, *c.SoundID), nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodGet, soundPath(s.ID, *unused.SoundID), nil), http.StatusNotFound)
	if files := soundFiles(t, ts); !reflect.DeepEqual(files, []string{fmt.Sprint(*kept.SoundID)}) {
		t.Errorf("sound files on disk = %q, want only the kept Song's", files)
	}
}

func TestAClipPlaysOnlyOneSource(t *testing.T) {
	ts := newTestServer(t)
	s, tl, c := songWithSound(t, ts)

	expectError(t, ts.placeClip(s.ID, map[string]any{
		"trackId": tl.Tracks[1].ID, "soundId": *c.SoundID, "beatId": tl.Beats[0].ID, "start": 0, "offset": 0, "length": 8,
	}), http.StatusBadRequest, "a Clip plays one of a Beat, a Sound or Takes")
}

// placeBack places a deleted Sound Clip on a Track again as it was, as undo
// does.
func (ts *testServer) placeBack(songID, trackID int64, c clip) response {
	ts.t.Helper()
	return ts.placeClip(songID, map[string]any{
		"trackId": trackID, "soundId": *c.SoundID, "start": c.Start, "offset": c.Offset, "length": c.Length,
	})
}

func TestStartupSweepsSoundsUnusedForMoreThanADay(t *testing.T) {
	ts := newTestServer(t)
	s, tl, c := songWithSound(t, ts)
	timelineChange(t, ts.deleteClip(s.ID, c.ID))
	// A Sound left unused with its Track.
	other, otherTL, otherClip := songWithSound(t, ts)
	timelineChange(t, ts.deleteTrack(other.ID, otherTL.Tracks[0].ID))

	ts = ts.startAt(23 * time.Hour)
	expectStatus(t, ts.Do(http.MethodGet, soundPath(s.ID, *c.SoundID), nil), http.StatusOK)
	expectStatus(t, ts.Do(http.MethodGet, soundPath(other.ID, *otherClip.SoundID), nil), http.StatusOK)
	if files := soundFiles(t, ts); len(files) != 2 {
		t.Errorf("sound files = %q, want both Sounds' kept within a day", files)
	}

	ts = ts.startAt(25 * time.Hour)
	expectStatus(t, ts.Do(http.MethodGet, soundPath(s.ID, *c.SoundID), nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodGet, soundPath(other.ID, *otherClip.SoundID), nil), http.StatusNotFound)
	if files := soundFiles(t, ts); len(files) != 0 {
		t.Errorf("sound files = %q, want none once unused for over a day", files)
	}
	expectError(t, ts.placeBack(s.ID, tl.Tracks[0].ID, c), http.StatusBadRequest, "there's no such Sound in this Song")
}

// jamSoundFile puts a directory with something in it where a Sound's file
// is, so removing it fails.
func jamSoundFile(t *testing.T, ts *testServer, soundID int64) {
	t.Helper()
	path := filepath.Join(ts.DataDir, "audio", "sounds", fmt.Sprint(soundID))
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(path, "stuck"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestAFileThatCantBeRemovedStopsNeitherASweepNorASongsDeletion(t *testing.T) {
	ts := newTestServer(t)
	swept, _, sweptClip := songWithSound(t, ts)
	timelineChange(t, ts.deleteClip(swept.ID, sweptClip.ID))
	jamSoundFile(t, ts, *sweptClip.SoundID)
	deleted, _, deletedClip := songWithSound(t, ts)
	jamSoundFile(t, ts, *deletedClip.SoundID)

	ts = ts.startAt(25 * time.Hour)
	expectStatus(t, ts.Do(http.MethodGet, soundPath(swept.ID, *sweptClip.SoundID), nil), http.StatusNotFound)

	expectStatus(t, ts.Do(http.MethodDelete, songPath(deleted.ID), nil), http.StatusNoContent)
	expectStatus(t, ts.Do(http.MethodGet, songPath(deleted.ID), nil), http.StatusNotFound)
}

func TestASoundUnusedForLessThanADaySurvivesARestartAndCanBePlacedBack(t *testing.T) {
	ts := newTestServer(t)
	s, tl, c := songWithSound(t, ts)
	timelineChange(t, ts.deleteClip(s.ID, c.ID))

	ts = ts.startAt(23 * time.Hour)
	got := timelineChange(t, ts.placeBack(s.ID, tl.Tracks[0].ID, c))

	if back := got.Tracks[0].Clips[1]; back.SoundID == nil || *back.SoundID != *c.SoundID {
		t.Errorf("clip = %+v, want the Sound's Clip back", back)
	}
	played := ts.Do(http.MethodGet, soundPath(s.ID, *c.SoundID)+"/audio", nil)
	expectStatus(t, played, http.StatusOK)
	if !bytes.Equal(played.Body, soundFile("hum.m4a", "Hum", 0, 8).Data) {
		t.Errorf("audio = %q, want the Sound's file as uploaded", played.Body)
	}
}

func TestASoundAClipUsesIsNeverSwept(t *testing.T) {
	ts := newTestServer(t)
	s, _, c := songWithSound(t, ts)
	// A copy of its Clip is deleted, but the Clip still uses it.
	dup := timelineChange(t, ts.duplicateClip(s.ID, c.ID))
	timelineChange(t, ts.deleteClip(s.ID, dup.Tracks[0].Clips[2].ID))
	// Another Sound's Clip is deleted, then placed back, as undo does.
	other, otherTL, otherClip := songWithSound(t, ts)
	timelineChange(t, ts.deleteClip(other.ID, otherClip.ID))
	timelineChange(t, ts.placeBack(other.ID, otherTL.Tracks[0].ID, otherClip))

	ts = ts.startAt(365 * 24 * time.Hour)

	expectStatus(t, ts.Do(http.MethodGet, soundPath(s.ID, *c.SoundID)+"/audio", nil), http.StatusOK)
	expectStatus(t, ts.Do(http.MethodGet, soundPath(other.ID, *otherClip.SoundID)+"/audio", nil), http.StatusOK)
	if files := soundFiles(t, ts); len(files) != 2 {
		t.Errorf("sound files = %q, want both Sounds', still in use", files)
	}
}
