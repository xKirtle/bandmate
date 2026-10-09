package app_test

import (
	"bytes"
	"log"
	"net/http"
	"strings"
	"testing"
)

// A request the server can't act on as sent answers 400 with why, and
// nothing else.
func TestAnInvalidRequestAnswers400WithWhy(t *testing.T) {
	ts := newTestServer(t)
	s := ts.createSong("Night Drive")

	res := ts.patchSong(s.ID, map[string]any{"title": "  "})

	expectReply(t, res, http.StatusBadRequest, map[string]any{"error": "title is required"})
}

// A request for something that isn't there answers 404.
func TestARequestForWhatIsntThereAnswers404(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodGet, songPath(404), nil)

	expectReply(t, res, http.StatusNotFound, map[string]any{"error": "not found"})
}

// A request that clashes with what's there answers 409 with why, and, where
// the app acts on the clash, its code and details beside it.
func TestAConflictAnswers409WithItsCodeAndDetails(t *testing.T) {
	ts := newTestServer(t)
	b := ts.beatOfLength("Dark Trap", 10)
	night := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(night.ID, b.ID))

	res := ts.Do(http.MethodDelete, beatPath(b.ID), nil)

	expectReply(t, res, http.StatusConflict, map[string]any{
		"error": "“Dark Trap” can't be deleted while these Songs use it: Night Drive",
		"code":  "in_use",
		"songs": []any{map[string]any{"id": float64(night.ID), "title": "Night Drive"}},
	})
}

// An error that isn't one the request could have avoided, e.g. the database
// failing, is logged and answers 500 without saying what went wrong.
func TestAnErrorTheRequestCouldntAvoidIsLoggedAndAnswers500(t *testing.T) {
	ts := newTestServer(t)
	var logs bytes.Buffer
	was := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(was) })
	ts.failStatements(inserts, "songs")

	res := ts.Do(http.MethodPost, "/api/songs", map[string]any{"title": "Night Drive"})

	expectReply(t, res, http.StatusInternalServerError, map[string]any{"error": "something went wrong"})
	if !strings.Contains(logs.String(), "injected fault") {
		t.Errorf("log = %q, want the database's error in it", logs.String())
	}
}
