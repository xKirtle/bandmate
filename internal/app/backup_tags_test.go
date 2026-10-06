package app_test

import (
	"context"
	"net/http"
	"reflect"
	"testing"

	"github.com/xKirtle/bandmate/internal/db"
)

// songTags maps each Song's title to the names of the Tags it carries.
func (ts *testServer) songTags() map[string][]string {
	ts.t.Helper()
	carries := map[string][]string{}
	for _, s := range ts.listSongs() {
		carries[s.Title] = s.Tags
	}
	return carries
}

func TestARestoredSongCarriesItsTagsMatchedByNameOrMade(t *testing.T) {
	elsewhere := newTestServer(t)
	opener := elsewhere.createSong("Opener")
	closer := elsewhere.createSong("Closer")
	loose := elsewhere.createSong("Loose")
	elsewhere.tagSong(opener.ID, "LIVE", "Album 2023")
	elsewhere.tagSong(closer.ID, "Album 2023")
	made := elsewhere.backUp(map[string]any{"allSongs": true})
	ts := newTestServer(t)
	ts.tagSong(ts.createSong("Encore").ID, "Live")
	up := ts.uploadFrom(elsewhere, made)

	ts.restore(up.ID, opener.ID, closer.ID, loose.ID)

	want := map[string][]string{
		"Opener": {"Album 2023", "Live"}, "Closer": {"Album 2023"}, "Loose": {}, "Encore": {"Live"},
	}
	if got := ts.songTags(); !reflect.DeepEqual(got, want) {
		t.Errorf("songs' tags = %v, want %v", got, want)
	}
	wantTags := []tag{{Name: "Album 2023", Songs: 2}, {Name: "Live", Songs: 2}}
	if got := tagsWithoutIDs(ts.listTags()); !reflect.DeepEqual(got, wantTags) {
		t.Errorf("tags = %+v, want %+v: ours matched as named here, the missing one made once", got, wantTags)
	}
}

// songsRetaggedSinceBackedUp backs up Opener, tagged Live and Covers, and
// Closer, tagged Covers, then renames Covers to covers, and tags Opener
// Demos alone and Closer covers and Demos, returning the Backup and the
// Songs. Since, Live is carried by no Song, so it's gone.
func (ts *testServer) songsRetaggedSinceBackedUp() (made backup, opener, closer song) {
	ts.t.Helper()
	opener = ts.createSong("Opener")
	closer = ts.createSong("Closer")
	ts.tagSong(opener.ID, "Live", "Covers")
	ts.tagSong(closer.ID, "Covers")
	made = ts.backUp(map[string]any{"songs": []int64{opener.ID, closer.ID}})
	expectStatus(ts.t, ts.renameTag(ts.tagNamed("Covers").ID, "covers", false), http.StatusOK)
	ts.tagSong(opener.ID, "Demos")
	ts.tagSong(closer.ID, "covers", "Demos")
	return made, opener, closer
}

func TestASongReplacedTakesExactlyTheBackupsTags(t *testing.T) {
	ts := newTestServer(t)
	made, opener, closer := ts.songsRetaggedSinceBackedUp()

	both := []int64{opener.ID, closer.ID}
	ts.restoreReplacing(made.ID, both, both, nil)

	// covers went with the Songs replaced, the only ones carrying it, so it
	// comes back as the Backup names it, as Live does; Demos, off its last
	// Song, goes.
	want := map[string][]string{"Opener": {"Covers", "Live"}, "Closer": {"Covers"}}
	if got := ts.songTags(); !reflect.DeepEqual(got, want) {
		t.Errorf("songs' tags = %v, want %v", got, want)
	}
	wantTags := []tag{{Name: "Covers", Songs: 2}, {Name: "Live", Songs: 1}}
	if got := tagsWithoutIDs(ts.listTags()); !reflect.DeepEqual(got, wantTags) {
		t.Errorf("tags = %+v, want %+v", got, wantTags)
	}
}

func TestASongReplacedKeepsATagItWasTheLastToCarry(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Opener")
	ts.tagSong(s.ID, "Live")
	made := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	ts.tagSong(s.ID, "LIVE")

	ts.restoreReplacing(made.ID, []int64{s.ID}, []int64{s.ID}, nil)

	if got := ts.songTags(); !reflect.DeepEqual(got, map[string][]string{"Opener": {"Live"}}) {
		t.Errorf("songs' tags = %v, want Opener tagged Live", got)
	}
	if got := tagsWithoutIDs(ts.listTags()); !reflect.DeepEqual(got, []tag{{Name: "Live", Songs: 1}}) {
		t.Errorf("tags = %+v, want Live alone, on Opener", got)
	}
}

func TestABackupMadeBeforeTagsRestoresItsSongsWithNoTags(t *testing.T) {
	dir := t.TempDir()
	old, err := db.OpenBefore(context.Background(), dir, "0037_tags")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Exec(`INSERT INTO songs (id, title, status, version, created_at, updated_at)
		VALUES (4, 'Night Drive', 'drafting', 1, '2025-01-02T03:04:05.000000000Z', '2025-01-02T03:04:05.000000000Z')`); err != nil {
		t.Fatal(err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	ts := newTestServer(t)
	placeholder := ts.createSong("Placeholder")
	ts.tagSong(placeholder.ID, "Live")
	made := ts.backUp(map[string]any{"songs": []int64{placeholder.ID}})
	ts.replaceBackupFile(made.ID, packBackup(t, dir))

	restored := ts.restore(made.ID, 4)

	if len(restored) != 1 || restored[0].Title != "Night Drive" {
		t.Fatalf("restored = %+v, want Night Drive", restored)
	}
	want := map[string][]string{"Placeholder": {"Live"}, "Night Drive": {}}
	if got := ts.songTags(); !reflect.DeepEqual(got, want) {
		t.Errorf("songs' tags = %v, want %v", got, want)
	}
	if got := tagsWithoutIDs(ts.listTags()); !reflect.DeepEqual(got, []tag{{Name: "Live", Songs: 1}}) {
		t.Errorf("tags = %+v, want only ours", got)
	}
}

func TestASongKeptBothCarriesTheBackupsTags(t *testing.T) {
	ts := newTestServer(t)
	made, opener, closer := ts.songsRetaggedSinceBackedUp()

	ts.restore(made.ID, opener.ID, closer.ID)

	want := map[string][]string{
		"Opener": {"Demos"}, "Closer": {"covers", "Demos"},
		"Opener (restored)": {"covers", "Live"}, "Closer (restored)": {"covers"},
	}
	if got := ts.songTags(); !reflect.DeepEqual(got, want) {
		t.Errorf("songs' tags = %v, want %v", got, want)
	}
}
