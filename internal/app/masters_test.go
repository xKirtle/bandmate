package app_test

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/xKirtle/bandmate/internal/app"
)

func TestUploadedMasterIsPartOfTheSong(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	upload := fakeAudio("night_drive_final.wav").with(map[string]any{"notes": "Mixed at Studio 2"})
	upload.ContentType = "audio/wav"

	got := ts.uploadMaster(s.ID, upload)

	if len(got.Masters) != 1 {
		t.Fatalf("masters = %+v, want one", got.Masters)
	}
	m := got.Masters[0]
	want := master{
		ID:          m.ID,
		Name:        "night_drive_final",
		Main:        true,
		Notes:       "Mixed at Studio 2",
		FileName:    "night_drive_final.wav",
		ContentType: "audio/wav",
		Size:        int64(len(upload.Data)),
		Duration:    2.5,
		AddedAt:     m.AddedAt,
	}
	// The Song leaves out the peaks, which only the player needs.
	if !reflect.DeepEqual(m, want) {
		t.Errorf("master = %+v, want %+v", m, want)
	}
	if m.AddedAt == "" {
		t.Error("addedAt is empty")
	}
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read.Masters, got.Masters) {
		t.Errorf("masters read back = %+v, want %+v", read.Masters, got.Masters)
	}

	res := ts.Do(http.MethodGet, masterPath(s.ID, m.ID), nil)
	expectStatus(t, res, http.StatusOK)
	var one master
	res.JSON(t, &one)
	want.Peaks = []float64{0.1, 0.5, 1, 0.25}
	if !reflect.DeepEqual(one, want) {
		t.Errorf("master on its own = %+v, want %+v", one, want)
	}
}

func TestAMasterWhoseFileNameIsAllExtensionIsNamedAfterItWhole(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	got := ts.uploadMaster(s.ID, fakeAudio(".m4a"))

	if len(got.Masters) != 1 || got.Masters[0].Name != ".m4a" {
		t.Errorf("masters = %+v, want one named \".m4a\", as a Sound is", got.Masters)
	}
}

func TestTheFirstMasterIsMainAndTheMainOneCanBeChanged(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	ts.uploadMaster(s.ID, fakeAudio("album.wav"))
	s = ts.uploadMaster(s.ID, fakeAudio("radio.wav").with(map[string]any{"name": " Radio edit "}))

	if got, want := masterNames(s), []string{"album*", "Radio edit"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("masters = %q, want %q", got, want)
	}

	s = ts.lyricSheetChange(http.MethodPost, masterPath(s.ID, s.Masters[1].ID)+"/main", nil)

	if got, want := masterNames(s), []string{"album", "Radio edit*"}; !reflect.DeepEqual(got, want) {
		t.Errorf("masters = %q, want %q", got, want)
	}
	if got := masterNames(ts.getSong(s.ID)); !reflect.DeepEqual(got, []string{"album", "Radio edit*"}) {
		t.Errorf("masters read back = %q", got)
	}
}

func TestDeletingTheMainMasterMakesAnotherOneMain(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	ts.uploadMaster(s.ID, fakeAudio("album.wav"))
	ts.uploadMaster(s.ID, fakeAudio("radio.wav"))
	s = ts.uploadMaster(s.ID, fakeAudio("acoustic.wav"))
	s = ts.lyricSheetChange(http.MethodPost, masterPath(s.ID, s.Masters[1].ID)+"/main", nil)

	s = ts.lyricSheetChange(http.MethodDelete, masterPath(s.ID, s.Masters[1].ID), nil)

	if got, want := masterNames(s), []string{"album*", "acoustic"}; !reflect.DeepEqual(got, want) {
		t.Errorf("masters = %q, want %q", got, want)
	}

	s = ts.lyricSheetChange(http.MethodDelete, masterPath(s.ID, s.Masters[1].ID), nil)
	s = ts.lyricSheetChange(http.MethodDelete, masterPath(s.ID, s.Masters[0].ID), nil)

	if len(s.Masters) != 0 {
		t.Errorf("masters = %q, want none", masterNames(s))
	}
	// With none left, the next one is main again.
	s = ts.uploadMaster(s.ID, fakeAudio("remaster.wav"))
	if got, want := masterNames(s), []string{"remaster*"}; !reflect.DeepEqual(got, want) {
		t.Errorf("masters = %q, want %q", got, want)
	}
}

func TestDeletingANonMainMasterKeepsTheMainOne(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")
	ts.uploadMaster(s.ID, fakeAudio("album.wav"))
	s = ts.uploadMaster(s.ID, fakeAudio("radio.wav"))

	s = ts.lyricSheetChange(http.MethodDelete, masterPath(s.ID, s.Masters[1].ID), nil)

	if got, want := masterNames(s), []string{"album*"}; !reflect.DeepEqual(got, want) {
		t.Errorf("masters = %q, want %q", got, want)
	}
}

// Deleting the main Master that fails partway, once it's deleted and while
// another is made main, changes nothing and removes no file.
func TestDeletingAMasterThatFailsPartwayDeletesNothing(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithMasters()
	files := masterFiles(t, ts)
	ts.failStatements(updates, "masters")

	expectStatus(t, ts.Do(http.MethodDelete, masterPath(s.ID, mainMaster(t, s).ID), nil),
		http.StatusInternalServerError)

	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, s)
	}
	if got := masterFiles(t, ts); !reflect.DeepEqual(got, files) {
		t.Errorf("master files on disk = %q, want all of %q", got, files)
	}
}

// mainMaster returns a Song's main Master.
func mainMaster(t *testing.T, s song) master {
	t.Helper()
	for _, m := range s.Masters {
		if m.Main {
			return m
		}
	}
	t.Fatalf("masters = %+v, want a main one", s.Masters)
	return master{}
}

func TestAMastersNameAndNotesCanBeEdited(t *testing.T) {
	ts := newTestServer(t)
	s := ts.uploadMaster(ts.createSong("Night Drive").ID, fakeAudio("mix3.wav"))
	before := s.Masters[0]

	s = ts.lyricSheetChange(http.MethodPatch, masterPath(s.ID, before.ID), map[string]any{
		"name": "  Album version ", "notes": "Mastered by J.",
	})

	want := before
	want.Name, want.Notes = "Album version", "Mastered by J."
	if !reflect.DeepEqual(s.Masters, []master{want}) {
		t.Errorf("masters = %+v, want %+v", s.Masters, []master{want})
	}

	s = ts.lyricSheetChange(http.MethodPatch, masterPath(s.ID, before.ID), map[string]any{"notes": ""})

	want.Notes = ""
	if !reflect.DeepEqual(s.Masters, []master{want}) {
		t.Errorf("masters = %+v, want %+v", s.Masters, []master{want})
	}
}

func TestAMasterNeedsAName(t *testing.T) {
	ts := newTestServer(t)
	s := ts.uploadMaster(ts.createSong("Night Drive").ID, fakeAudio("mix3.wav"))

	res := ts.Do(http.MethodPatch, masterPath(s.ID, s.Masters[0].ID), map[string]any{"name": "  ", "notes": "x"})

	expectError(t, res, http.StatusBadRequest, "a Master's name is required")
	if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
		t.Errorf("song = %+v, want it unchanged: %+v", read, s)
	}
}

func TestUploadingAMasterNeedsAFileTheBrowserDecoded(t *testing.T) {
	cases := map[string]struct {
		upload audioUpload
		msg    string
	}{
		"no duration":    {fakeAudio("a.wav").with(map[string]any{"duration": 0}), "duration must be more than 0 seconds"},
		"no peaks":       {fakeAudio("a.wav").with(map[string]any{"peaks": []float64{}}), "peaks are required"},
		"unknown detail": {fakeAudio("a.wav").with(map[string]any{"title": "A"}), "details must be valid JSON with known fields"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)
			s := ts.createSong("Night Drive")

			expectError(t, ts.SendUpload(http.MethodPost, songPath(s.ID)+"/masters", c.upload), http.StatusBadRequest, c.msg)

			if read := ts.getSong(s.ID); !reflect.DeepEqual(read, s) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, s)
			}
			if files := masterFiles(t, ts); len(files) != 0 {
				t.Errorf("master files on disk = %q, want none", files)
			}
		})
	}
}

func TestMasterUploadsOverTheSizeCapAreRejected(t *testing.T) {
	ts := newTestServerWith(t, func(c *app.Config) { c.MaxUploadBytes = 1 << 20 })
	s := ts.createSong("Night Drive")
	big := fakeAudio("big.wav")
	big.Data = bytes.Repeat([]byte{1}, 1<<20+1)

	expectError(t, ts.SendUpload(http.MethodPost, songPath(s.ID)+"/masters", big),
		http.StatusRequestEntityTooLarge, "the file is larger than the upload limit of 1 MB")

	if read := ts.getSong(s.ID); len(read.Masters) != 0 {
		t.Errorf("masters = %+v, want none", read.Masters)
	}
}

func TestAddingAMasterNeverChangesTheStatus(t *testing.T) {
	ts := newTestServer(t)
	s := ts.updateSong(ts.createSong("Night Drive").ID, map[string]any{"status": "drafting"})

	s = ts.uploadMaster(s.ID, fakeAudio("final.wav"))

	if s.Status != "drafting" {
		t.Errorf("status = %q, want it left at drafting", s.Status)
	}
}

// masterChange is one kind of change to a Song's Masters, sent based on a
// version of the Song.
type masterChange struct {
	name string
	send func(ts *testServer, s song, version int64) response
}

// masterChanges covers adding, editing, making main and deleting, each on a
// Song that already has two Masters.
var masterChanges = []masterChange{
	{"add", func(ts *testServer, s song, v int64) response {
		return ts.SendUploadAt(v, http.MethodPost, songPath(s.ID)+"/masters", fakeAudio("third.wav"))
	}},
	{"edit", func(ts *testServer, s song, v int64) response {
		return ts.DoAt(v, http.MethodPatch, masterPath(s.ID, s.Masters[0].ID), map[string]any{"notes": "Louder"})
	}},
	{"make main", func(ts *testServer, s song, v int64) response {
		return ts.DoAt(v, http.MethodPost, masterPath(s.ID, s.Masters[1].ID)+"/main", nil)
	}},
	{"delete", func(ts *testServer, s song, v int64) response {
		return ts.DoAt(v, http.MethodDelete, masterPath(s.ID, s.Masters[1].ID), nil)
	}},
}

// songWithMasters creates a Song with two Masters.
func (ts *testServer) songWithMasters() song {
	ts.t.Helper()
	s := ts.createSong("Night Drive")
	ts.uploadMaster(s.ID, fakeAudio("album.wav"))
	return ts.uploadMaster(s.ID, fakeAudio("radio.wav"))
}

func TestChangingMastersCountsAsEditingTheSong(t *testing.T) {
	for _, c := range masterChanges {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			before := ts.songWithMasters()
			ts.createSong("Edited Since")

			res := c.send(ts, before, before.Version)

			expectStatus(t, res, http.StatusOK)
			var got song
			res.JSON(t, &got)
			if got.Version == before.Version {
				t.Errorf("version = %d, want it changed", got.Version)
			}
			if !parseTime(t, got.UpdatedAt).After(parseTime(t, before.UpdatedAt)) {
				t.Errorf("updatedAt = %s, want it after %s", got.UpdatedAt, before.UpdatedAt)
			}
			if first := ts.listSongs()[0]; first.ID != before.ID {
				t.Errorf("top of the Song list = %q, want the Song whose Masters changed", first.Title)
			}
		})
	}
}

func TestAMasterChangeBasedOnAnOldVersionIsRejectedAndChangesNothing(t *testing.T) {
	for _, c := range masterChanges {
		t.Run(c.name, func(t *testing.T) {
			ts := newTestServer(t)
			old := ts.songWithMasters()
			current := ts.updateSong(old.ID, map[string]any{"notes": "Edited in another tab"})

			expectStale(t, c.send(ts, old, old.Version))

			if read := ts.getSong(old.ID); !reflect.DeepEqual(read, current) {
				t.Errorf("song = %+v, want it unchanged: %+v", read, current)
			}
			if files := masterFiles(t, ts); len(files) != 2 {
				t.Errorf("master files on disk = %q, want the two Masters'", files)
			}
		})
	}
}

func TestMasterAudioIsServedAsUploadedWithRangeSupport(t *testing.T) {
	ts := newTestServer(t)
	upload := fakeAudio("final mix.mp3")
	s := ts.uploadMaster(ts.createSong("Night Drive").ID, upload)
	path := masterPath(s.ID, s.Masters[0].ID) + "/audio"

	whole := ts.Do(http.MethodGet, path, nil)
	expectStatus(t, whole, http.StatusOK)
	if !bytes.Equal(whole.Body, upload.Data) {
		t.Errorf("audio = %q, want the file as uploaded: %q", whole.Body, upload.Data)
	}
	if got := whole.Header.Get("Content-Type"); got != "audio/mpeg" {
		t.Errorf("Content-Type = %q, want audio/mpeg", got)
	}
	if got := whole.Header.Get("Content-Disposition"); got != "" {
		t.Errorf("Content-Disposition = %q, want none so it plays", got)
	}

	part := ts.DoRaw(http.MethodGet, path, http.Header{"Range": {"bytes=4-9"}}, nil)
	expectStatus(t, part, http.StatusPartialContent)
	if want := upload.Data[4:10]; !bytes.Equal(part.Body, want) {
		t.Errorf("range = %q, want %q", part.Body, want)
	}

	download := ts.Do(http.MethodGet, path+"?download", nil)
	expectStatus(t, download, http.StatusOK)
	if !bytes.Equal(download.Body, upload.Data) {
		t.Errorf("download = %q, want the file as uploaded", download.Body)
	}
	if got, want := download.Header.Get("Content-Disposition"), `attachment; filename="final mix.mp3"`; got != want {
		t.Errorf("Content-Disposition = %q, want %q", got, want)
	}
}

func TestUnknownMasterIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	other := ts.uploadMaster(ts.createSong("Other").ID, fakeAudio("other.wav"))
	s := ts.createSong("Night Drive")
	// A Master is only found through its own Song.
	foreign := other.Masters[0].ID

	for _, r := range []response{
		ts.Do(http.MethodGet, masterPath(s.ID, foreign), nil),
		ts.Do(http.MethodGet, masterPath(s.ID, foreign)+"/audio", nil),
		ts.Do(http.MethodPatch, masterPath(s.ID, foreign), map[string]any{"name": "Mine"}),
		ts.Do(http.MethodPost, masterPath(s.ID, foreign)+"/main", nil),
		ts.Do(http.MethodDelete, masterPath(s.ID, foreign), nil),
		ts.SendUpload(http.MethodPost, songPath(999)+"/masters", fakeAudio("a.wav")),
	} {
		expectStatus(t, r, http.StatusNotFound)
	}
	if read := ts.getSong(other.ID); !reflect.DeepEqual(read, other) {
		t.Errorf("other song = %+v, want it unchanged: %+v", read, other)
	}
	if files := masterFiles(t, ts); len(files) != 1 {
		t.Errorf("master files on disk = %q, want only the other Song's", files)
	}
}

func TestDeletingAMasterDeletesItsFile(t *testing.T) {
	ts := newTestServer(t)
	s := ts.songWithMasters()
	gone, kept := s.Masters[0], s.Masters[1]

	ts.lyricSheetChange(http.MethodDelete, masterPath(s.ID, gone.ID), nil)

	expectStatus(t, ts.Do(http.MethodGet, masterPath(s.ID, gone.ID)+"/audio", nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodGet, masterPath(s.ID, kept.ID)+"/audio", nil), http.StatusOK)
	// The API can't tell a file left behind on disk, so look there.
	if files := masterFiles(t, ts); !reflect.DeepEqual(files, []string{fmt.Sprint(kept.ID)}) {
		t.Errorf("master files on disk = %q, want only the kept Master's", files)
	}
}

func TestDeletingASongDeletesItsMastersAndTheirFilesButNotBeats(t *testing.T) {
	ts := newTestServer(t)
	gone := ts.songWithMasters()
	kept := ts.uploadMaster(ts.createSong("Kept").ID, fakeAudio("kept.wav"))
	b := ts.uploadBeat(fakeAudio("beat.mp3").with(map[string]any{"title": "Beat"}))

	expectStatus(t, ts.Do(http.MethodDelete, songPath(gone.ID), nil), http.StatusNoContent)

	for _, m := range gone.Masters {
		expectStatus(t, ts.Do(http.MethodGet, masterPath(gone.ID, m.ID)+"/audio", nil), http.StatusNotFound)
	}
	if files := masterFiles(t, ts); !reflect.DeepEqual(files, []string{fmt.Sprint(kept.Masters[0].ID)}) {
		t.Errorf("master files on disk = %q, want only the kept Song's", files)
	}
	expectStatus(t, ts.Do(http.MethodGet, beatPath(b.ID)+"/audio", nil), http.StatusOK)
}

func TestMastersSurviveARestart(t *testing.T) {
	ts := newTestServer(t)
	upload := fakeAudio("final.wav")
	s := ts.uploadMaster(ts.createSong("Night Drive").ID, upload)
	ts.Stop()

	restarted := startTestServer(t, ts.DataDir)

	if read := restarted.getSong(s.ID); !reflect.DeepEqual(read.Masters, s.Masters) {
		t.Errorf("masters after restart = %+v, want %+v", read.Masters, s.Masters)
	}
	served := restarted.Do(http.MethodGet, masterPath(s.ID, s.Masters[0].ID)+"/audio", nil)
	if !bytes.Equal(served.Body, upload.Data) {
		t.Errorf("audio after restart = %q, want %q", served.Body, upload.Data)
	}
}

// masterFiles lists the files stored for Masters in the data directory.
func masterFiles(t *testing.T, ts *testServer) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(ts.DataDir, "audio", "masters"))
	if err != nil {
		t.Fatalf("reading audio directory: %v", err)
	}
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}
