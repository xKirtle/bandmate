package app_test

import (
	"fmt"
	"net/http"
	"reflect"
	"slices"
	"testing"
)

// tag is a Tag as the API lists it.
type tag struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Songs int    `json:"songs"`
}

// setTags sends a Song's whole list of Tag names.
func (ts *testServer) setTags(songID int64, names ...string) response {
	ts.t.Helper()
	if names == nil {
		names = []string{}
	}
	return ts.Do(http.MethodPut, songPath(songID)+"/tags", map[string]any{"tags": names})
}

// tagSong sets a Song's Tags and returns them as the API answers.
func (ts *testServer) tagSong(songID int64, names ...string) []string {
	ts.t.Helper()
	res := ts.setTags(songID, names...)
	expectStatus(ts.t, res, http.StatusOK)
	var got []string
	res.JSON(ts.t, &got)
	return got
}

// listTags reads every Tag.
func (ts *testServer) listTags() []tag {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, "/api/tags", nil)
	expectStatus(ts.t, res, http.StatusOK)
	var list []tag
	res.JSON(ts.t, &list)
	return list
}

func TestSongCarriesTheTagsSet(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Opener")

	got := ts.tagSong(s.ID, "  Live  ", "Album 2023", "covers")

	want := []string{"Album 2023", "covers", "Live"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("tags set = %v, want %v, trimmed, by name ignoring case", got, want)
	}
	if got := ts.getSong(s.ID).Tags; !reflect.DeepEqual(got, want) {
		t.Errorf("song's tags = %v, want %v", got, want)
	}
	if got := ts.listSongs()[0].Tags; !reflect.DeepEqual(got, want) {
		t.Errorf("listed song's tags = %v, want %v", got, want)
	}
}

func TestUntaggedSongCarriesNoTags(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Opener")

	if got := ts.getSong(s.ID).Tags; got == nil || len(got) != 0 {
		t.Errorf("song's tags = %#v, want an empty list", got)
	}
	if got := ts.listSongs()[0].Tags; got == nil || len(got) != 0 {
		t.Errorf("listed song's tags = %#v, want an empty list", got)
	}
}

func TestTagNamesAreMatchedIgnoringCase(t *testing.T) {
	ts := newTestServer(t)
	opener := ts.createSong("Opener")
	closer := ts.createSong("Closer")
	ts.tagSong(opener.ID, "Live", "Canção")

	got := ts.tagSong(closer.ID, "live", "CANÇÃO", "LIVE")

	if want := []string{"Canção", "Live"}; !reflect.DeepEqual(got, want) {
		t.Errorf("tags = %v, want the existing %v, once each", got, want)
	}
	want := []tag{{Name: "Canção", Songs: 2}, {Name: "Live", Songs: 2}}
	if got := tagsWithoutIDs(ts.listTags()); !reflect.DeepEqual(got, want) {
		t.Errorf("tags listed = %+v, want %+v", got, want)
	}
}

func TestNewTagNameTakesItsFirstSpelling(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Opener")

	got := ts.tagSong(s.ID, "Live", "LIVE")

	if want := []string{"Live"}; !reflect.DeepEqual(got, want) {
		t.Errorf("tags = %v, want %v", got, want)
	}
}

func TestTagNameCantBeBlank(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Opener")
	ts.tagSong(s.ID, "Live")

	expectError(t, ts.setTags(s.ID, "Covers", "   "), http.StatusBadRequest, "a Tag's name can't be blank")

	if got := ts.getSong(s.ID).Tags; !reflect.DeepEqual(got, []string{"Live"}) {
		t.Errorf("tags = %v, want [Live] as before", got)
	}
}

func TestSettingTagsNeedsTheList(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Opener")

	res := ts.Do(http.MethodPut, songPath(s.ID)+"/tags", map[string]any{})

	expectError(t, res, http.StatusBadRequest, "tags must be a list of names")
}

func TestTaggingAnUnknownSongIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Opener")

	expectStatus(t, ts.setTags(s.ID+1, "Live"), http.StatusNotFound)

	if got := ts.listTags(); len(got) != 0 {
		t.Errorf("tags = %+v, want none", got)
	}
}

func TestTaggingASongLeavesItUnedited(t *testing.T) {
	ts := newTestServer(t)
	s := ts.updateSong(ts.createSong("Done").ID, map[string]any{"status": "finished"})

	ts.tagSong(s.ID, "Live")
	ts.tagSong(s.ID, "Covers")

	tagged := ts.getSong(s.ID)
	if tagged.Version != s.Version || tagged.UpdatedAt != s.UpdatedAt {
		t.Errorf("after tagging, version %d edited %s; want %d and %s as before",
			tagged.Version, tagged.UpdatedAt, s.Version, s.UpdatedAt)
	}
	if !reflect.DeepEqual(tagged.Tags, []string{"Covers"}) {
		t.Errorf("tags = %v, want [Covers]", tagged.Tags)
	}
}

func TestTagGoesWithItsLastSong(t *testing.T) {
	ts := newTestServer(t)
	opener := ts.createSong("Opener")
	closer := ts.createSong("Closer")
	ts.tagSong(opener.ID, "Live", "Covers")
	ts.tagSong(closer.ID, "Live")

	ts.tagSong(opener.ID, "Live")

	want := []tag{{Name: "Live", Songs: 2}}
	if got := tagsWithoutIDs(ts.listTags()); !reflect.DeepEqual(got, want) {
		t.Errorf("tags = %+v, want %+v, Covers gone with its last Song", got, want)
	}
	ts.tagSong(opener.ID)
	if got, want := tagsWithoutIDs(ts.listTags()), []tag{{Name: "Live", Songs: 1}}; !reflect.DeepEqual(got, want) {
		t.Errorf("tags = %+v, want %+v", got, want)
	}
}

func TestTagGoesWithItsLastSongDeleted(t *testing.T) {
	ts := newTestServer(t)
	opener := ts.createSong("Opener")
	closer := ts.createSong("Closer")
	ts.tagSong(opener.ID, "Live", "Covers")
	ts.tagSong(closer.ID, "Live")

	expectStatus(t, ts.Do(http.MethodDelete, songPath(opener.ID), nil), http.StatusNoContent)

	want := []tag{{Name: "Live", Songs: 1}}
	if got := tagsWithoutIDs(ts.listTags()); !reflect.DeepEqual(got, want) {
		t.Errorf("tags = %+v, want %+v", got, want)
	}
}

// tagsWithoutIDs is Tags as listed, with ids left out, which the API picks.
func tagsWithoutIDs(list []tag) []tag {
	out := []tag{}
	for _, t := range list {
		t.ID = 0
		out = append(out, t)
	}
	return out
}

// renameTag sends a Tag's new name, merging it into another Tag with that
// name only when merge is set.
func (ts *testServer) renameTag(id int64, name string, merge bool) response {
	ts.t.Helper()
	return ts.Do(http.MethodPatch, fmt.Sprintf("/api/tags/%d", id), map[string]any{"name": name, "merge": merge})
}

// tagNamed finds a Tag by its name as listed.
func (ts *testServer) tagNamed(name string) tag {
	ts.t.Helper()
	for _, t := range ts.listTags() {
		if t.Name == name {
			return t
		}
	}
	ts.t.Fatalf("no Tag named %q", name)
	return tag{}
}

func TestSongListCanBeFilteredBySeveralTags(t *testing.T) {
	ts := newTestServer(t)
	ts.tagSong(ts.createSong("Live Cover").ID, "Live", "Covers")
	ts.tagSong(ts.createSong("Live Only").ID, "Live")
	ts.tagSong(ts.createSong("Live Cover 2023").ID, "Live", "Covers", "Album 2023")
	ts.createSong("Untagged")
	ts.updateSong(ts.createSong("Finished Cover").ID, map[string]any{"status": "finished"})
	ts.tagSong(ts.listSongs("q=finished")[0].ID, "Covers")

	cases := map[string][]string{
		"tag=Live":                           {"Live Cover 2023", "Live Only", "Live Cover"},
		"tag=live":                           {"Live Cover 2023", "Live Only", "Live Cover"},
		"tag=Live&tag=Covers":                {"Live Cover 2023", "Live Cover"},
		"tag=Live&tag=Covers&tag=Album+2023": {"Live Cover 2023"},
		"tag=Live&tag=Nothing":               {},
		"tag=+covers+&tag=":                  {"Finished Cover", "Live Cover 2023", "Live Cover"},
		"tag=Covers&status=finished":         {"Finished Cover"},
		"tag=Covers&q=2023":                  {"Live Cover 2023"},
		"tag=Live&tag=LIVE":                  {"Live Cover 2023", "Live Only", "Live Cover"},
	}
	for query, want := range cases {
		if got := titles(ts.listSongs(query)); !reflect.DeepEqual(got, want) {
			t.Errorf("song list for %q = %v, want %v", query, got, want)
		}
	}
}

func TestTitleSearchDoesntMatchTagNames(t *testing.T) {
	ts := newTestServer(t)
	ts.tagSong(ts.createSong("Opener").ID, "Live")

	if got := titles(ts.listSongs("q=live")); len(got) != 0 {
		t.Errorf("searching for a Tag's name lists %v, want nothing", got)
	}
}

func TestTagCanBeRenamed(t *testing.T) {
	ts := newTestServer(t)
	s := ts.updateSong(ts.createSong("Opener").ID, map[string]any{"status": "finished"})
	ts.tagSong(s.ID, "live", "Covers")
	live := ts.tagNamed("live")

	res := ts.renameTag(live.ID, "  Live shows ", false)

	expectStatus(t, res, http.StatusOK)
	var got tag
	res.JSON(t, &got)
	if want := (tag{ID: live.ID, Name: "Live shows", Songs: 1}); got != want {
		t.Errorf("renamed tag = %+v, want %+v", got, want)
	}
	renamed := ts.getSong(s.ID)
	if want := []string{"Covers", "Live shows"}; !reflect.DeepEqual(renamed.Tags, want) {
		t.Errorf("song's tags = %v, want %v", renamed.Tags, want)
	}
	if renamed.Version != s.Version || renamed.UpdatedAt != s.UpdatedAt {
		t.Errorf("after renaming a Tag, version %d edited %s; want %d and %s as before",
			renamed.Version, renamed.UpdatedAt, s.Version, s.UpdatedAt)
	}
}

func TestTagCanBeRenamedToItsOwnNameInAnotherCase(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Opener")
	ts.tagSong(s.ID, "live")

	expectStatus(t, ts.renameTag(ts.tagNamed("live").ID, "Live", false), http.StatusOK)

	if got := ts.getSong(s.ID).Tags; !reflect.DeepEqual(got, []string{"Live"}) {
		t.Errorf("song's tags = %v, want [Live]", got)
	}
}

func TestRenamingATagOntoAnothersNameAsksToMerge(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Opener")
	ts.tagSong(s.ID, "live")
	ts.tagSong(ts.createSong("Closer").ID, "Live shows")

	res := ts.renameTag(ts.tagNamed("live").ID, "LIVE SHOWS", false)

	expectError(t, res, http.StatusConflict, "there's already a Tag called “Live shows”")
	if got := ts.getSong(s.ID).Tags; !reflect.DeepEqual(got, []string{"live"}) {
		t.Errorf("song's tags = %v, want [live] as before", got)
	}
}

func TestRenamingATagOntoAnothersNameMergesThem(t *testing.T) {
	ts := newTestServer(t)
	both := ts.createSong("Both")
	ts.tagSong(both.ID, "live", "Live shows", "Covers")
	onlyLive := ts.createSong("Only live")
	ts.tagSong(onlyLive.ID, "live")
	onlyShows := ts.createSong("Only shows")
	ts.tagSong(onlyShows.ID, "Live shows")
	shows := ts.tagNamed("Live shows")

	res := ts.renameTag(ts.tagNamed("live").ID, "live SHOWS", true)

	expectStatus(t, res, http.StatusOK)
	var got tag
	res.JSON(t, &got)
	if want := (tag{ID: shows.ID, Name: "live SHOWS", Songs: 3}); got != want {
		t.Errorf("merged tag = %+v, want %+v, the other Tag, named as typed", got, want)
	}
	want := []tag{{Name: "Covers", Songs: 1}, {Name: "live SHOWS", Songs: 3}}
	if got := tagsWithoutIDs(ts.listTags()); !reflect.DeepEqual(got, want) {
		t.Errorf("tags = %+v, want %+v", got, want)
	}
	for _, s := range []song{both, onlyLive, onlyShows} {
		if got := ts.getSong(s.ID).Tags; !slices.Contains(got, "live SHOWS") || slices.Contains(got, "live") {
			t.Errorf("%s's tags = %v, want the merged Tag only", s.Title, got)
		}
	}
}

func TestRenamingATagNeedsANonBlankName(t *testing.T) {
	ts := newTestServer(t)
	ts.tagSong(ts.createSong("Opener").ID, "Live")

	expectError(t, ts.renameTag(ts.tagNamed("Live").ID, "  ", false), http.StatusBadRequest,
		"a Tag's name can't be blank")
}

func TestRenamingAnUnknownTagIsNotFound(t *testing.T) {
	ts := newTestServer(t)
	ts.tagSong(ts.createSong("Opener").ID, "Live")

	expectStatus(t, ts.renameTag(ts.tagNamed("Live").ID+1, "Covers", true), http.StatusNotFound)
}

func TestTagCanBeDeletedKeepingItsSongs(t *testing.T) {
	ts := newTestServer(t)
	opener := ts.updateSong(ts.createSong("Opener").ID, map[string]any{"status": "finished"})
	ts.tagSong(opener.ID, "Live", "Covers")
	closer := ts.createSong("Closer")
	ts.tagSong(closer.ID, "Live")

	expectStatus(t, ts.Do(http.MethodDelete, fmt.Sprintf("/api/tags/%d", ts.tagNamed("Live").ID), nil),
		http.StatusNoContent)

	if got := titles(ts.listSongs()); !reflect.DeepEqual(got, []string{"Closer", "Opener"}) {
		t.Errorf("songs = %v, want both kept", got)
	}
	after := ts.getSong(opener.ID)
	if !reflect.DeepEqual(after.Tags, []string{"Covers"}) {
		t.Errorf("opener's tags = %v, want [Covers]", after.Tags)
	}
	if after.Version != opener.Version || after.UpdatedAt != opener.UpdatedAt {
		t.Errorf("after deleting a Tag, version %d edited %s; want %d and %s as before",
			after.Version, after.UpdatedAt, opener.Version, opener.UpdatedAt)
	}
	if got := ts.getSong(closer.ID).Tags; len(got) != 0 {
		t.Errorf("closer's tags = %v, want none", got)
	}
	if got, want := tagsWithoutIDs(ts.listTags()), []tag{{Name: "Covers", Songs: 1}}; !reflect.DeepEqual(got, want) {
		t.Errorf("tags = %+v, want %+v", got, want)
	}
}

func TestDeletingAnUnknownTagIsNotFound(t *testing.T) {
	ts := newTestServer(t)

	expectStatus(t, ts.Do(http.MethodDelete, "/api/tags/1", nil), http.StatusNotFound)
}
