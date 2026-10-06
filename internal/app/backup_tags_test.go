package app_test

import (
	"net/http"
	"reflect"
	"testing"
)

// tagsBySong maps each Song's title to the names of the Tags it carries.
func (ts *testServer) tagsBySong() map[string][]string {
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
	if got := ts.tagsBySong(); !reflect.DeepEqual(got, want) {
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

	// Live, gone since, comes back as the Backup names it; Demos, off its
	// last Song, goes.
	want := map[string][]string{"Opener": {"covers", "Live"}, "Closer": {"covers"}}
	if got := ts.tagsBySong(); !reflect.DeepEqual(got, want) {
		t.Errorf("songs' tags = %v, want %v", got, want)
	}
	wantTags := []tag{{Name: "covers", Songs: 2}, {Name: "Live", Songs: 1}}
	if got := tagsWithoutIDs(ts.listTags()); !reflect.DeepEqual(got, wantTags) {
		t.Errorf("tags = %+v, want %+v", got, wantTags)
	}
}

func TestASongReplacedKeepsATagItWasTheLastToCarry(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Opener")
	ts.tagSong(s.ID, "Live")
	made := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	live := ts.tagNamed("Live")
	expectStatus(t, ts.renameTag(live.ID, "LIVE", false), http.StatusOK)

	// LIVE goes with Opener, cleared to be made anew, yet the Backup's
	// Opener carries it, as Live.
	ts.restoreReplacing(made.ID, []int64{s.ID}, []int64{s.ID}, nil)

	if got := ts.tagsBySong(); !reflect.DeepEqual(got, map[string][]string{"Opener": {"LIVE"}}) {
		t.Errorf("songs' tags = %v, want Opener tagged LIVE, as named here", got)
	}
	if got := ts.listTags(); !reflect.DeepEqual(got, []tag{{ID: live.ID, Name: "LIVE", Songs: 1}}) {
		t.Errorf("tags = %+v, want LIVE alone, the same Tag, on Opener", got)
	}
}

func TestARestoredSongMatchesATagIgnoringCaseBeyondASCII(t *testing.T) {
	elsewhere := newTestServer(t)
	s := elsewhere.createSong("Opener")
	elsewhere.tagSong(s.ID, "ÉTÉ")
	made := elsewhere.backUp(map[string]any{"songs": []int64{s.ID}})
	ts := newTestServer(t)
	ts.tagSong(ts.createSong("Closer").ID, "Été")
	up := ts.uploadFrom(elsewhere, made)

	ts.restore(up.ID, s.ID)

	if got := tagsWithoutIDs(ts.listTags()); !reflect.DeepEqual(got, []tag{{Name: "Été", Songs: 2}}) {
		t.Errorf("tags = %+v, want ours alone, as named here, on both Songs", got)
	}
}

func TestABackupMadeBeforeTagsRestoresItsSongsWithNoTags(t *testing.T) {
	ts := newTestServer(t)
	placeholder := ts.createSong("Placeholder")
	ts.tagSong(placeholder.ID, "Live")
	made := ts.backUp(map[string]any{"songs": []int64{placeholder.ID}})
	ts.nightDriveBackedUpBefore("0037_tags", made.ID)

	restored := ts.restore(made.ID, 4)

	if len(restored) != 1 || restored[0].Title != "Night Drive" {
		t.Fatalf("restored = %+v, want Night Drive", restored)
	}
	want := map[string][]string{"Placeholder": {"Live"}, "Night Drive": {}}
	if got := ts.tagsBySong(); !reflect.DeepEqual(got, want) {
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
	if got := ts.tagsBySong(); !reflect.DeepEqual(got, want) {
		t.Errorf("songs' tags = %v, want %v", got, want)
	}
}
