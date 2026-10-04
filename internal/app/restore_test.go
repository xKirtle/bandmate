package app_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/xKirtle/bandmate/internal/db"
)

// restoredSong is a Song a Restore brought back, as it answers.
type restoredSong struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// backupSongs lists the Songs a Backup holds, by their ids in it.
func (ts *testServer) backupSongs(id int64) []restoredSong {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, backupPath(id)+"/songs", nil)
	expectStatus(ts.t, res, http.StatusOK)
	var list []restoredSong
	res.JSON(ts.t, &list)
	return list
}

// restore restores the Songs with ids, as the Backup holds them, and
// returns the Songs restored.
func (ts *testServer) restore(id int64, songs ...int64) []restoredSong {
	ts.t.Helper()
	return ts.restoreReplacing(id, songs, nil, nil)
}

// songCopy is all of a Song a test can read through the API: its Lyric
// Sheet and Details, its Timeline, the Beats its Clips use, and every audio
// file and picture it plays or shows, with each id renumbered by where it
// first appears, so a copy with fresh ids reads the same.
type songCopy struct {
	Song, Timeline, Beats any
	Files                 map[string][]byte
}

// readSongCopy reads the Song with id as a songCopy.
func (ts *testServer) readSongCopy(id int64) songCopy {
	ts.t.Helper()
	get := func(path string) []byte {
		ts.t.Helper()
		res := ts.Do(http.MethodGet, path, nil)
		expectStatus(ts.t, res, http.StatusOK)
		return res.Body
	}
	c := songCopy{Files: map[string][]byte{}}
	c.Song = idsRenumbered(ts.t, get(songPath(id)))
	c.Timeline = idsRenumbered(ts.t, get(timelinePath(id)))
	s, tl := ts.getSong(id), ts.getTimeline(id)
	for i, m := range s.Masters {
		c.Files[fmt.Sprintf("master %d", i)] = get(masterPath(id, m.ID) + "/audio")
	}
	if s.Cover != nil {
		for _, p := range []string{"original", "list", "header"} {
			c.Files["cover "+p] = get(songPath(id) + "/cover/" + p)
		}
	}
	var beats []json.RawMessage
	for i, tr := range tl.Tracks {
		for j, cl := range tr.Clips {
			at := fmt.Sprintf("track %d clip %d", i, j)
			if cl.BeatID != 0 {
				beats = append(beats, get(beatPath(cl.BeatID)))
				c.Files[at+" beat"] = get(beatPath(cl.BeatID) + "/audio")
			}
			if cl.SoundID != nil {
				c.Files[at+" sound"] = get(soundPath(id, *cl.SoundID) + "/audio")
			}
			for k, tk := range cl.Takes {
				c.Files[fmt.Sprintf("%s take %d", at, k)] = get(takePath(id, tk.ID) + "/audio")
			}
		}
	}
	all, _ := json.Marshal(beats)
	c.Beats = idsRenumbered(ts.t, all)
	return c
}

// expectSameSong fails the test unless got is want, ids aside.
func expectSameSong(t *testing.T, want, got songCopy) {
	t.Helper()
	for _, part := range []struct {
		name      string
		want, got any
	}{{"song", want.Song, got.Song}, {"timeline", want.Timeline, got.Timeline}, {"beats", want.Beats, got.Beats}} {
		if !reflect.DeepEqual(part.want, part.got) {
			w, _ := json.Marshal(part.want)
			g, _ := json.Marshal(part.got)
			t.Errorf("restored %s = %.800s\nwant %.800s", part.name, g, w)
		}
	}
	if len(got.Files) != len(want.Files) {
		t.Errorf("restored Song plays or shows %d files, want %d", len(got.Files), len(want.Files))
	}
	for name, w := range want.Files {
		if !bytes.Equal(got.Files[name], w) {
			t.Errorf("restored %s = %q, want %q", name, got.Files[name], w)
		}
	}
}

// idFamilies says which ids each field ending in "Id" refers to: those of
// the rows listed under that name, or of the Song itself ("").
var idFamilies = map[string]string{
	"songId": "", "beatId": "beats", "soundId": "sounds", "activeTakeId": "takes", "coverId": "cover",
}

// idsRenumbered decodes a JSON body, renumbering each id by the order in which
// ids of its kind first appear, so two copies of a Song with different ids
// read the same where they refer to the same things.
func idsRenumbered(t *testing.T, body []byte) any {
	t.Helper()
	var v any
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decoding %s: %v", body, err)
	}
	seen := map[string]map[float64]string{}
	renumber := func(family string, id any) any {
		n, ok := id.(float64)
		if !ok {
			return id
		}
		if seen[family] == nil {
			seen[family] = map[float64]string{}
		}
		if _, ok := seen[family][n]; !ok {
			seen[family][n] = fmt.Sprintf("%s#%d", family, len(seen[family]))
		}
		return seen[family][n]
	}
	var walk func(family string, v any) any
	walk = func(family string, v any) any {
		switch v := v.(type) {
		case map[string]any:
			keys := make([]string, 0, len(v))
			for k := range v {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				switch {
				case k == "id":
					v[k] = renumber(family, v[k])
				case strings.HasSuffix(k, "Id"):
					v[k] = renumber(idFamilies[k], v[k])
				case k == "arrangement" || k == "scrapbook":
					for i, id := range v[k].([]any) {
						v[k].([]any)[i] = renumber("sections", id)
					}
				default:
					v[k] = walk(k, v[k])
				}
			}
		case []any:
			for i := range v {
				v[i] = walk(family, v[i])
			}
		}
		return v
	}
	return walk("", v)
}

func TestRestoringSongsBringsThemBackWithTheirBeatsIntoAnInstallWithoutThem(t *testing.T) {
	ts := newTestServer(t)
	used := ts.uploadBeat(fakeAudio("used.mp3").with(map[string]any{"title": "Used", "producer": "Kai"}))
	s := ts.fullSong(t, used.ID)
	other := ts.createSong("Midnight")
	timelineChange(t, ts.addBeatToSong(other.ID, used.ID))
	ts.createSong("Left Out")
	made := ts.backUp(map[string]any{"allSongs": true})
	wantSong, wantOther := ts.readSongCopy(s.ID), ts.readSongCopy(other.ID)
	for _, id := range []int64{s.ID, other.ID} {
		expectStatus(t, ts.Do(http.MethodDelete, songPath(id), nil), http.StatusNoContent)
	}
	expectStatus(t, ts.Do(http.MethodDelete, beatPath(used.ID), nil), http.StatusNoContent)

	if got := restoredTitles(ts.backupSongs(made.ID)); !reflect.DeepEqual(got, []string{"Left Out", "Midnight", "Night Drive"}) {
		t.Errorf("songs in the backup = %q, want all three", got)
	}
	restored := ts.restore(made.ID, s.ID, other.ID)

	if got := restoredTitles(restored); !reflect.DeepEqual(got, []string{"Midnight", "Night Drive"}) {
		t.Fatalf("restored = %+v, want the two Songs picked", restored)
	}
	if got := titles(ts.listSongs()); len(got) != 3 {
		t.Errorf("songs = %q, want the two restored beside the one left", got)
	}
	if got := ts.listBeats(); len(got) != 1 || got[0].Title != "Used" || len(got[0].Songs) != 2 {
		t.Errorf("beats = %+v, want the one Beat back once, used by both Songs", got)
	}
	for _, r := range restored {
		want := wantSong
		if r.Title == "Midnight" {
			want = wantOther
		}
		expectSameSong(t, want, ts.readSongCopy(r.ID))
	}
}

func TestASongOrBeatAlreadyInBandmateIsKeptBothWithTheRestoredOneAddedAlongside(t *testing.T) {
	ts := newTestServer(t)
	used := ts.uploadBeat(fakeAudio("used.mp3").with(map[string]any{"title": "Used", "producer": "Kai"}))
	s := ts.fullSong(t, used.ID)
	made := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	want := ts.readSongCopy(s.ID)
	// Edited since: the ones in Bandmate are left as they are now.
	ts.updateSong(s.ID, map[string]any{"title": "Night Drive II"})
	expectStatus(t, ts.Do(http.MethodPatch, beatPath(used.ID), map[string]any{"title": "Used Again"}), http.StatusOK)
	now := ts.readSongCopy(s.ID)

	restored := ts.restore(made.ID, s.ID)

	if len(restored) != 1 || restored[0].Title != "Night Drive (restored)" || restored[0].ID == s.ID {
		t.Fatalf("restored = %+v, want a new Song, Night Drive (restored)", restored)
	}
	if got := sorted(titles(ts.listSongs())); !reflect.DeepEqual(got, []string{"Night Drive (restored)", "Night Drive II"}) {
		t.Errorf("songs = %q, want the one in Bandmate and the one restored", got)
	}
	expectSameSong(t, now, ts.readSongCopy(s.ID))
	if got := sorted(beatTitles(ts.listBeats())); !reflect.DeepEqual(got, []string{"Used (restored)", "Used Again"}) {
		t.Errorf("beats = %q, want the one in Bandmate and the one restored", got)
	}
	// The restored one is the Song as backed up, but for its title and its
	// Beat's.
	want.Song.(map[string]any)["title"] = "Night Drive (restored)"
	for _, b := range want.Beats.([]any) {
		b.(map[string]any)["title"] = "Used (restored)"
		for _, user := range b.(map[string]any)["songs"].([]any) {
			user.(map[string]any)["title"] = "Night Drive (restored)"
		}
	}
	for _, b := range want.Timeline.(map[string]any)["beats"].([]any) {
		b.(map[string]any)["title"] = "Used (restored)"
	}
	expectSameSong(t, want, ts.readSongCopy(restored[0].ID))
}

func TestASongOrBeatKeptBothHasAnIdentityOfItsOwn(t *testing.T) {
	ts := newTestServer(t)
	used := ts.beatOfLength("Used", 20)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, used.ID))
	made := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	kept := ts.restore(made.ID, s.ID)[0]

	// With the originals gone, the Song kept both isn't the same Song, nor
	// its Beat the same Beat, so the Song comes back as it was.
	expectStatus(t, ts.Do(http.MethodDelete, songPath(s.ID), nil), http.StatusNoContent)
	expectStatus(t, ts.Do(http.MethodDelete, beatPath(used.ID), nil), http.StatusNoContent)
	again := ts.restore(made.ID, s.ID)

	if len(again) != 1 || again[0].Title != "Night Drive" {
		t.Errorf("restored again = %+v, want Night Drive, as it was", again)
	}
	if got := sorted(titles(ts.listSongs())); !reflect.DeepEqual(got, []string{"Night Drive", "Night Drive (restored)"}) {
		t.Errorf("songs = %q, want the one kept both and the one restored again", got)
	}
	if got := sorted(beatTitles(ts.listBeats())); !reflect.DeepEqual(got, []string{"Used", "Used (restored)"}) {
		t.Errorf("beats = %q, want the one kept both and the one restored again", got)
	}
	if tl := ts.getTimeline(kept.ID); len(tl.Beats) != 1 || tl.Beats[0].Title != "Used (restored)" {
		t.Errorf("beats of the Song kept both = %+v, want still its own", tl.Beats)
	}
}

// replaceBackupFile puts file in place of a Backup's own, as if it had been
// made elsewhere: on another install, or by an older Bandmate.
func (ts *testServer) replaceBackupFile(id int64, file []byte) {
	ts.t.Helper()
	if err := os.WriteFile(filepath.Join(ts.DataDir, "backups", strconv.FormatInt(id, 10)), file, 0o644); err != nil {
		ts.t.Fatal(err)
	}
}

// packBackup packs a data directory as a Backup's file.
func packBackup(t *testing.T, dir string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		w, err := zw.Create(filepath.ToSlash(rel))
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	})
	if err == nil {
		err = zw.Close()
	}
	if err != nil {
		t.Fatalf("packing backup: %v", err)
	}
	return buf.Bytes()
}

// olderBackupDir is a Backup's database and files, unpacked, as made by an
// older Bandmate: at the schema before Clips had gain, fades, and Songs and
// Beats identities, holding Night Drive (id 4) with a cued Line and Dark
// Trap on its Timeline.
func olderBackupDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old, err := db.OpenBefore(context.Background(), dir, "0029_clip_gain")
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`INSERT INTO songs (id, title, status, song_key, bpm, version, created_at, updated_at)
			VALUES (4, 'Night Drive', 'drafting', 'Am', 92, 7, '2025-01-02T03:04:05.000000000Z', '2025-01-02T03:04:05.000000000Z')`,
		`INSERT INTO sections (id, song_id, label, position) VALUES (9, 4, 'Chorus', 0)`,
		`INSERT INTO alternates (id, section_id, name, active) VALUES (11, 9, '', 1)`,
		`INSERT INTO lines (id, alternate_id, position, text, cue_ms) VALUES (13, 11, 0, 'Drive, [Am]drive', 4000)`,
		`INSERT INTO tracks (id, song_id, name, position, volume) VALUES (5, 4, 'Beat', 0, -3)`,
		`INSERT INTO beats (id, title, producer, file_name, content_type, size, duration, peaks, created_at, updated_at)
			VALUES (6, 'Dark Trap', 'Kai', 'dark_trap.mp3', 'audio/mpeg', 10, 95.5, '[0.5,1]',
			'2025-01-01T00:00:00.000000000Z', '2025-01-01T00:00:00.000000000Z')`,
		`INSERT INTO clips (id, track_id, beat_id, start, source_offset, length) VALUES (8, 5, 6, 2, 0, 90)`,
	} {
		if _, err := old.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "audio", "beats"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "audio", "beats", "6"), []byte("dark trap"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestABackupMadeByAnOlderBandmateRestores(t *testing.T) {
	dir := olderBackupDir(t)
	ts := newTestServer(t)
	ts.createSong("Placeholder")
	made := ts.backUp(map[string]any{"allSongs": true})
	ts.replaceBackupFile(made.ID, packBackup(t, dir))

	if got := ts.backupSongs(made.ID); !reflect.DeepEqual(got, []restoredSong{{4, "Night Drive"}}) {
		t.Errorf("songs in the backup = %+v, want Night Drive", got)
	}
	restored := ts.restore(made.ID, 4)

	if len(restored) != 1 || restored[0].Title != "Night Drive" {
		t.Fatalf("restored = %+v, want Night Drive", restored)
	}
	s := ts.getSong(restored[0].ID)
	if s.Status != "drafting" || s.Key != "Am" || s.Version != 7 || len(s.Sections) != 1 {
		t.Errorf("song = %+v, want it as backed up", s)
	}
	if got := s.Sections[0].Alternates[0].Lines; len(got) != 1 || got[0].Text != "Drive, [Am]drive" || got[0].Cue == nil || *got[0].Cue != 4 {
		t.Errorf("lines = %+v, want the cued Line", got)
	}
	tl := ts.getTimeline(s.ID)
	if len(tl.Tracks) != 1 || tl.Tracks[0].Volume != -3 || len(tl.Tracks[0].Clips) != 1 {
		t.Fatalf("timeline = %+v, want one Track with the Beat's Clip", tl)
	}
	c := tl.Tracks[0].Clips[0]
	if c.Start != 2 || c.Length != 90 || c.Gain != 0 || c.FadeIn != 0 || c.FadeOut != 0 {
		t.Errorf("clip = %+v, want it as backed up, with no gain or fades", c)
	}
	b := ts.getBeat(c.BeatID)
	if b.Title != "Dark Trap" || b.Producer != "Kai" || len(b.Songs) != 1 {
		t.Errorf("beat = %+v, want Dark Trap, used by the Song", b)
	}
	expectBody(t, ts.Do(http.MethodGet, beatPath(b.ID)+"/audio", nil), "dark trap")
}

// expectBody fails the test unless res succeeded with body.
func expectBody(t *testing.T, res response, body string) {
	t.Helper()
	expectStatus(t, res, http.StatusOK)
	if string(res.Body) != body {
		t.Errorf("body = %q, want %q", res.Body, body)
	}
}

func TestASongFromAnotherInstallNeverCountsAsAlreadyThere(t *testing.T) {
	elsewhere := newTestServer(t)
	theirs := elsewhere.createSong("Midnight")
	elsewhere.updateSong(theirs.ID, map[string]any{"notes": "theirs"})
	file := elsewhere.downloadBackup(elsewhere.backUp(map[string]any{"allSongs": true}).ID).Body
	ts := newTestServer(t)
	ours := ts.createSong("Midnight")
	made := ts.backUp(map[string]any{"allSongs": true})
	ts.replaceBackupFile(made.ID, file)

	restored := ts.restore(made.ID, theirs.ID)

	if len(restored) != 1 || restored[0].Title != "Midnight" {
		t.Fatalf("restored = %+v, want Midnight, added as it is", restored)
	}
	if got := ts.getSong(restored[0].ID); got.Notes != "theirs" {
		t.Errorf("restored = %+v, want theirs", got)
	}
	if got := ts.getSong(ours.ID); got.Notes != "" || got.Title != "Midnight" {
		t.Errorf("ours = %+v, want it untouched", got)
	}
}

func TestARestoreMustPickWhatTheBackupHolds(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, ts.beatOfLength("Used", 20).ID))
	made := ts.backUp(map[string]any{"allSongs": true})
	path := backupPath(made.ID) + "/restore"

	expectError(t, ts.Do(http.MethodPost, path, map[string]any{"songs": []int64{}}),
		http.StatusBadRequest, "pick at least one Song or Beat to restore")
	expectError(t, ts.Do(http.MethodPost, path, map[string]any{"songs": []int64{s.ID, s.ID + 1}}),
		http.StatusBadRequest, "a Song picked isn't in the Backup")
	expectError(t, ts.Do(http.MethodPost, backupPath(made.ID+1)+"/restore", map[string]any{"songs": []int64{s.ID}}),
		http.StatusNotFound, "not found")
	expectError(t, ts.Do(http.MethodGet, backupPath(made.ID+1)+"/songs", nil), http.StatusNotFound, "not found")

	if got := titles(ts.listSongs()); !reflect.DeepEqual(got, []string{"Night Drive"}) {
		t.Errorf("songs = %q, want nothing restored", got)
	}
	if got := beatTitles(ts.listBeats()); !reflect.DeepEqual(got, []string{"Used"}) {
		t.Errorf("beats = %q, want nothing restored", got)
	}
}

func TestARestoreThatFailsRestoresNothing(t *testing.T) {
	ts := newTestServer(t)
	a, b := ts.createSong("Night Drive"), ts.createSong("Midnight")
	timelineChange(t, ts.addBeatToSong(b.ID, ts.beatOfLength("Used", 20).ID))
	made := ts.backUp(map[string]any{"allSongs": true})
	// Damaged: Midnight's Beat's audio is missing from the file.
	held := openBackupDir(t, ts.downloadBackup(made.ID).Body)
	if err := os.RemoveAll(filepath.Join(held, "audio")); err != nil {
		t.Fatal(err)
	}
	ts.replaceBackupFile(made.ID, packBackup(t, held))
	before := titles(ts.listSongs())

	res := ts.Do(http.MethodPost, backupPath(made.ID)+"/restore", map[string]any{"songs": []int64{a.ID, b.ID}})

	expectError(t, res, http.StatusBadRequest, "the Backup is damaged")
	if got := titles(ts.listSongs()); !reflect.DeepEqual(got, before) {
		t.Errorf("songs = %q, want them as they were, %q", got, before)
	}
	if got := ts.listBeats(); len(got) != 1 {
		t.Errorf("beats = %+v, want only the one there was", got)
	}
}

func sorted(list []string) []string {
	list = append([]string{}, list...)
	sort.Strings(list)
	return list
}

// restoredTitles lists the titles of restored Songs, sorted.
func restoredTitles(list []restoredSong) []string {
	got := []string{}
	for _, s := range list {
		got = append(got, s.Title)
	}
	sort.Strings(got)
	return got
}
