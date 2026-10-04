package app_test

import (
	"database/sql"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/xKirtle/bandmate/internal/db"
)

// presentItem is a Song or Beat a Backup holds, by its id and title there,
// that's already in Bandmate, as the one in Bandmate is now.
type presentItem struct {
	ID         int64        `json:"id"`
	Title      string       `json:"title"`
	InBandmate restoredSong `json:"inBandmate"`
}

// present lists the Songs with ids, as the Backup holds them, and the
// Beats their Clips use, that are already in Bandmate.
func (ts *testServer) present(id int64, songs ...int64) (presentSongs, presentBeats []presentItem) {
	ts.t.Helper()
	res := ts.Do(http.MethodPost, backupPath(id)+"/present", map[string]any{"songs": songs})
	expectStatus(ts.t, res, http.StatusOK)
	var got struct {
		Songs []presentItem `json:"songs"`
		Beats []presentItem `json:"beats"`
	}
	res.JSON(ts.t, &got)
	return got.Songs, got.Beats
}

func TestARestoreListsTheSongsAndBeatsAlreadyInBandmate(t *testing.T) {
	ts := newTestServer(t)
	used := ts.beatOfLength("Used", 20)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	gone := ts.createSong("Midnight")
	made := ts.backUp(map[string]any{"allSongs": true})
	ts.updateSong(s.ID, map[string]any{"title": "Night Drive II"})
	expectStatus(t, ts.Do(http.MethodPatch, beatPath(used.ID), map[string]any{"title": "Used Again"}), http.StatusOK)
	expectStatus(t, ts.Do(http.MethodDelete, songPath(gone.ID), nil), http.StatusNoContent)
	// The same title is never the same Song.
	ts.createSong("Midnight")

	songs, beats := ts.present(made.ID, s.ID, gone.ID)

	if want := []presentItem{{s.ID, "Night Drive", restoredSong{s.ID, "Night Drive II"}}}; !reflect.DeepEqual(songs, want) {
		t.Errorf("songs already in Bandmate = %+v, want %+v", songs, want)
	}
	if want := []presentItem{{used.ID, "Used", restoredSong{used.ID, "Used Again"}}}; !reflect.DeepEqual(beats, want) {
		t.Errorf("beats already in Bandmate = %+v, want %+v", beats, want)
	}
	if songs, beats := ts.present(made.ID, gone.ID); len(songs) != 0 || len(beats) != 0 {
		t.Errorf("already in Bandmate = %+v, %+v, want nothing for a Song that isn't", songs, beats)
	}
}

func TestAReplacedBeatTakesTheBackupsDetailsForEverySongUsingIt(t *testing.T) {
	ts := newTestServer(t)
	used := ts.uploadBeat(fakeAudio("used.mp3").with(map[string]any{
		"title": "Used", "producer": "Kai", "sourceLink": "https://example.com/used",
		"bpm": 92, "key": "Am", "notes": "as backed up",
	}))
	s, other := ts.createSong("Night Drive"), ts.createSong("Midnight")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	timelineChange(t, ts.addBeatToSong(other.ID, used.ID))
	made := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	audio := ts.Do(http.MethodGet, beatPath(used.ID)+"/audio", nil).Body
	expectStatus(t, ts.Do(http.MethodPatch, beatPath(used.ID), map[string]any{
		"title": "Used Again", "producer": "Someone", "sourceLink": "", "bpm": nil, "key": "C", "notes": "newer",
	}), http.StatusOK)

	restored := ts.restoreReplacing(made.ID, []int64{s.ID}, nil, []int64{used.ID})

	if len(restored) != 1 || restored[0].Title != "Night Drive (restored)" {
		t.Fatalf("restored = %+v, want Night Drive kept both", restored)
	}
	beats := ts.listBeats()
	if len(beats) != 1 || beats[0].ID != used.ID {
		t.Fatalf("beats = %+v, want only the one replaced, in its place", beats)
	}
	b := ts.getBeat(used.ID)
	if b.Title != "Used" || b.Producer != "Kai" || b.SourceLink != "https://example.com/used" ||
		b.BPM == nil || *b.BPM != 92 || b.Key != "Am" || b.Notes != "as backed up" {
		t.Errorf("beat = %+v, want the Backup's Details: title, credit, BPM, Key and Notes", b)
	}
	if got := sorted(beatSongTitles(b)); !reflect.DeepEqual(got, []string{"Midnight", "Night Drive", "Night Drive (restored)"}) {
		t.Errorf("songs using the beat = %q, want both it had and the one restored", got)
	}
	for _, id := range []int64{s.ID, other.ID, restored[0].ID} {
		if tl := ts.getTimeline(id); len(tl.Beats) != 1 || tl.Beats[0].ID != used.ID || tl.Beats[0].Title != "Used" {
			t.Errorf("beats of song %d = %+v, want the one replaced", id, tl.Beats)
		}
	}
	expectBody(t, ts.Do(http.MethodGet, beatPath(used.ID)+"/audio", nil), string(audio))
}

func TestAReplacedSongPlaysTheBeatReplacedWithIt(t *testing.T) {
	ts := newTestServer(t)
	used := ts.beatOfLength("Used", 20)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	gone := ts.createSong("Midnight")
	made := ts.backUp(map[string]any{"allSongs": true})
	ts.updateSong(s.ID, map[string]any{"title": "Night Drive II"})
	expectStatus(t, ts.Do(http.MethodDelete, songPath(gone.ID), nil), http.StatusNoContent)

	// Midnight, no longer in Bandmate, has nothing to replace, so it's added.
	restored := ts.restoreReplacing(made.ID, []int64{s.ID, gone.ID}, []int64{s.ID, gone.ID}, []int64{used.ID})

	if got := restoredTitles(restored); !reflect.DeepEqual(got, []string{"Midnight", "Night Drive"}) {
		t.Fatalf("restored = %+v, want Night Drive in its place and Midnight added", restored)
	}
	if got := sorted(titles(ts.listSongs())); !reflect.DeepEqual(got, []string{"Midnight", "Night Drive"}) {
		t.Errorf("songs = %q, want the two restored, and nothing kept both", got)
	}
	if beats := ts.listBeats(); len(beats) != 1 || beats[0].ID != used.ID {
		t.Errorf("beats = %+v, want only the one replaced", beats)
	}
	if tl := ts.getTimeline(s.ID); len(tl.Beats) != 1 || tl.Beats[0].ID != used.ID {
		t.Errorf("beats of the Song replaced = %+v, want the Beat replaced with it", tl.Beats)
	}
}

func TestARestoreThatFailsReplacesNothing(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, ts.beatOfLength("Used", 20).ID))
	made := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	// Damaged: the Song's row breaks a rule of the database, so copying it
	// in fails once the Song it replaces is already cleared.
	held := openBackupDir(t, ts.downloadBackup(made.ID).Body)
	damage(t, held, `UPDATE songs SET status = 'lost'`)
	ts.replaceBackupFile(made.ID, packBackup(t, held))
	ts.uploadMaster(s.ID, fakeAudio("studio.wav").with(map[string]any{"name": "Studio"}))
	before := ts.readSongCopy(s.ID)

	res := ts.Do(http.MethodPost, backupPath(made.ID)+"/restore", map[string]any{
		"songs": []int64{s.ID}, "replace": map[string]any{"songs": []int64{s.ID}},
	})

	expectStatus(t, res, http.StatusInternalServerError)
	expectSameSong(t, before, ts.readSongCopy(s.ID))
	if got := ts.getSong(s.ID).Version; float64(got) != before.Song.(map[string]any)["version"] {
		t.Errorf("version = %d, want it as it was", got)
	}
}

// damage runs stmt on the database in a Backup unpacked in dir, ignoring
// the rules it would break.
func damage(t *testing.T, dir, stmt string) {
	t.Helper()
	conn, err := sql.Open("sqlite", filepath.Join(dir, db.FileName))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	for _, s := range []string{`PRAGMA ignore_check_constraints = ON`, stmt} {
		if _, err := conn.Exec(s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

// beatSongTitles lists the titles of the Songs using a Beat.
func beatSongTitles(b beat) []string {
	list := []string{}
	for _, s := range b.Songs {
		list = append(list, s.Title)
	}
	return list
}

// restoreReplacing restores the Songs with ids, as the Backup holds them,
// replacing those of them, and of the Beats their Clips use, given by their
// ids in the Backup, and returns the Songs restored.
func (ts *testServer) restoreReplacing(id int64, songs, replaceSongs, replaceBeats []int64) []restoredSong {
	ts.t.Helper()
	res := ts.Do(http.MethodPost, backupPath(id)+"/restore", map[string]any{
		"songs": songs, "replace": map[string]any{"songs": replaceSongs, "beats": replaceBeats},
	})
	expectStatus(ts.t, res, http.StatusOK)
	var restored struct {
		Songs []restoredSong `json:"songs"`
	}
	res.JSON(ts.t, &restored)
	return restored.Songs
}

// songFilesKept lists the files kept in the data directory for Masters,
// Covers, Takes and Sounds, by directory.
func songFilesKept(t *testing.T, ts *testServer) map[string][]string {
	t.Helper()
	kept := map[string][]string{}
	for _, dir := range []string{"audio/masters", "audio/takes", "audio/sounds", "covers/original", "covers/list", "covers/header"} {
		entries, err := os.ReadDir(filepath.Join(ts.DataDir, filepath.FromSlash(dir)))
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("reading %s: %v", dir, err)
		}
		for _, e := range entries {
			kept[dir] = append(kept[dir], e.Name())
		}
	}
	return kept
}

func TestAReplacedSongIsTheBackupsVersionEntirely(t *testing.T) {
	ts := newTestServer(t)
	used := ts.beatOfLength("Used", 20)
	s := ts.createSong("Night Drive")
	ts.updateSong(s.ID, map[string]any{"key": "Am", "notes": "as backed up"})
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	made := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	want := ts.readSongCopy(s.ID)
	// Since backed up: a new title and Details, a Master, a Cover, a Take and
	// a Sound, none of which the Backup holds.
	ts.updateSong(s.ID, map[string]any{"title": "Night Drive II", "notes": "newer"})
	ts.uploadMaster(s.ID, fakeAudio("studio.wav").with(map[string]any{"name": "Studio"}))
	ts.addCover(s.ID, fakeCover())
	vox := timelineChange(t, ts.addTrack(s.ID, "Lead vox")).Tracks[1].ID
	timelineChange(t, ts.recordTake(s.ID, takeRecording(vox, 1, 1, 0.01, 3)))
	timelineChange(t, ts.importSound(s.ID, soundFile("hum.m4a", "Hum", vox, 2)))
	stale := ts.getSong(s.ID).Version

	restored := ts.restoreReplacing(made.ID, []int64{s.ID}, []int64{s.ID}, nil)

	if want := []restoredSong{{s.ID, "Night Drive"}}; !reflect.DeepEqual(restored, want) {
		t.Fatalf("restored = %+v, want %+v, in its place", restored, want)
	}
	if got := titles(ts.listSongs()); !reflect.DeepEqual(got, []string{"Night Drive"}) {
		t.Errorf("songs = %q, want only the one replaced", got)
	}
	got := ts.getSong(s.ID)
	if got.Version <= stale {
		t.Errorf("version = %d, want past %d, the one a stale tab has", got.Version, stale)
	}
	want.Song.(map[string]any)["version"] = float64(got.Version)
	want.Timeline.(map[string]any)["version"] = float64(got.Version)
	// Its Beat, kept both, is the one restored with it.
	for _, b := range want.Beats.([]any) {
		b.(map[string]any)["title"] = "Used (restored)"
	}
	for _, b := range want.Timeline.(map[string]any)["beats"].([]any) {
		b.(map[string]any)["title"] = "Used (restored)"
	}
	expectSameSong(t, want, ts.readSongCopy(s.ID))
	if kept := songFilesKept(t, ts); len(kept) != 0 {
		t.Errorf("files kept = %q, want those of the Song before it was replaced gone", kept)
	}
	// A tab that had the Song before it was replaced has its next write
	// rejected, as based on an old version.
	expectStale(t, ts.DoAt(stale, http.MethodPatch, songPath(s.ID), map[string]any{"notes": "from a stale tab"}))
}
