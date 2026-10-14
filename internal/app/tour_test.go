package app_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/xKirtle/bandmate/internal/db"
)

const (
	tourPath        = "/api/tour"
	tourOfferedPath = "/api/tour/offered"
)

// tourOffered tells whether the Tour has been offered on the install, so the
// empty Songs page no longer offers it.
func (ts *testServer) tourOffered() bool {
	ts.t.Helper()
	res := ts.Do(http.MethodGet, tourPath, nil)
	expectStatus(ts.t, res, http.StatusOK)
	var tour struct {
		Offered *bool `json:"offered"`
	}
	res.JSON(ts.t, &tour)
	if tour.Offered == nil {
		ts.t.Fatalf("tour = %s, want whether it's been offered", res.Body)
	}
	return *tour.Offered
}

func TestANewInstallHasNotOfferedTheTour(t *testing.T) {
	ts := newTestServer(t)

	if ts.tourOffered() {
		t.Error("a new install's Tour reads as offered, want it not yet")
	}
}

// Taking the Tour from the offer and saying No thanks to it both mark it
// offered, the same call, for the whole install: every Device reads it.
func TestEitherChoiceMarksTheTourOfferedForGood(t *testing.T) {
	ts := newTestServer(t)

	expectReply(t, ts.Do(http.MethodPost, tourOfferedPath, nil), http.StatusOK, map[string]any{"offered": true})
	if !ts.tourOffered() {
		t.Error("Tour after it was offered reads as not offered")
	}

	// Marking it again changes nothing.
	expectReply(t, ts.Do(http.MethodPost, tourOfferedPath, nil), http.StatusOK, map[string]any{"offered": true})

	ts.Stop()
	restarted := startTestServer(t, ts.DataDir)
	if !restarted.tourOffered() {
		t.Error("Tour after a restart reads as not offered, want it kept")
	}
}

// Putting the Demo back, as a Tour taken from About does, doesn't count as
// offering it, nor does the Demo Song count as a Song of the install's.
func TestTheDemoAloneLeavesTheTourUnoffered(t *testing.T) {
	ts := newTestServer(t)
	ts.putDemoBack()
	ts.Stop()

	restarted := startTestServer(t, ts.DataDir)
	if restarted.tourOffered() {
		t.Error("Tour after the Demo was put back reads as offered")
	}
}

// An install upgraded from before the Tour that has Songs never sees it
// offered: it isn't new.
func TestUpgradingAnInstallWithSongsMarksTheTourOffered(t *testing.T) {
	dir := t.TempDir()
	old, err := db.OpenBefore(context.Background(), dir, "0047_tour")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Exec(`INSERT INTO songs (id, title, status, version, created_at, updated_at)
		VALUES (1, 'Old Song', 'drafting', 1, '2025-01-02T03:04:05.000000000Z', '2025-01-02T03:04:05.000000000Z')`); err != nil {
		t.Fatal(err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}

	ts := startTestServer(t, dir)

	if !ts.tourOffered() {
		t.Error("Tour after upgrading an install with Songs reads as not offered")
	}
}

// One upgraded with none is as new as a new install: it's offered.
func TestUpgradingAnInstallWithNoSongsLeavesTheTourUnoffered(t *testing.T) {
	ts := startTestServer(t, dataBefore(t, "0047_tour"))

	if ts.tourOffered() {
		t.Error("Tour after upgrading an install with no Songs reads as offered")
	}
}
