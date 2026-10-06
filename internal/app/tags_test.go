package app_test

import (
	"net/http"
	"reflect"
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
