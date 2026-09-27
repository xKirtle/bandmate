package app_test

import (
	"net/http"
	"strings"
	"testing"
)

func TestSPAEntryPageIsServedAtRoot(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodGet, "/", nil)

	expectStatus(t, res, http.StatusOK)
	expectEntryPage(t, res)
}

func TestSPAStaticFilesAreServed(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodGet, "/assets/app.js", nil)

	expectStatus(t, res, http.StatusOK)
	if string(res.Body) != "console.log('bandmate')" {
		t.Errorf("body = %q, want the asset's contents", res.Body)
	}
}

func TestUnknownClientRouteFallsBackToSPAEntryPage(t *testing.T) {
	for _, path := range []string{"/songs/42", "/songs/new", "/some/deep/route"} {
		t.Run(path, func(t *testing.T) {
			ts := newTestServer(t)

			res := ts.Do(http.MethodGet, path, nil)

			expectStatus(t, res, http.StatusOK)
			expectEntryPage(t, res)
		})
	}
}

func TestUnknownAPIPathIsNotFoundJSON(t *testing.T) {
	for _, path := range []string{"/api/nope", "/api"} {
		t.Run(path, func(t *testing.T) {
			ts := newTestServer(t)

			res := ts.Do(http.MethodGet, path, nil)

			expectStatus(t, res, http.StatusNotFound)
			var e struct{ Error string }
			res.JSON(t, &e)
			if e.Error == "" {
				t.Error("want a readable error message")
			}
		})
	}
}

func expectEntryPage(t *testing.T, res response) {
	t.Helper()
	if !strings.Contains(string(res.Body), "<title>Bandmate</title>") {
		t.Errorf("body = %q, want the SPA entry page", res.Body)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
}
