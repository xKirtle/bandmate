package app_test

import (
	"net/http"
	"testing"
)

func TestHealthIsOKWhenDatabaseIsReachable(t *testing.T) {
	ts := newTestServer(t)

	res := ts.Do(http.MethodGet, "/api/health", nil)

	expectStatus(t, res, http.StatusOK)
	var body struct{ Status string }
	res.JSON(t, &body)
	if body.Status != "ok" {
		t.Errorf("status = %q, want %q", body.Status, "ok")
	}
}
