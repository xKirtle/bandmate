package app

import (
	"context"
	"errors"
	"net/http"

	"github.com/xKirtle/bandmate/internal/beats"
	"github.com/xKirtle/bandmate/internal/fetches"
	"github.com/xKirtle/bandmate/internal/releases"
)

// A Beat added from a link is fetched first, into a waiting file the
// browser reads once, as it reads an uploaded file, and then added by
// reference to it, so its audio is never sent back.

// fetchLink fetches a link's audio into a waiting file, answering once it's
// there. Abandoning the request stops the fetch.
func (a *App) fetchLink(w http.ResponseWriter, r *http.Request) {
	if a.refuseWhenAddFromLinkOff(w) {
		return
	}
	var req struct {
		Link string `json:"link"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	f, err := a.fetches.Fetch(r.Context(), req.Link)
	if err != nil {
		writeFetchError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (a *App) fetchedAudio(w http.ResponseWriter, r *http.Request) {
	if err := a.fetches.Serve(w, r, r.PathValue("id")); err != nil {
		writeFetchError(w, err)
	}
}

func (a *App) discardFetched(w http.ResponseWriter, r *http.Request) {
	a.fetches.Discard(r.PathValue("id"))
	w.WriteHeader(http.StatusNoContent)
}

// addFetchedBeat adds a waiting file as a Beat, with the details the user
// entered and what the browser worked out by decoding it.
func (a *App) addFetchedBeat(w http.ResponseWriter, r *http.Request) {
	var details struct {
		beats.Details
		uploadDetails
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxDetailsSize)
	if !readJSON(w, r, &details) {
		return
	}
	var added beats.Beat
	err := a.fetches.Keep(r.PathValue("id"), func(path string, f fetches.Fetched) error {
		file, err := a.beatFiles.ReceiveFile(path)
		if err != nil {
			return err
		}
		added, err = a.beats.Add(r.Context(), details.Details, details.audio(f.FileName, f.ContentType), file)
		return err
	})
	if errors.Is(err, fetches.ErrNotFound) {
		writeFetchError(w, err)
		return
	}
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, added)
}

// refuseWhenAddFromLinkOff answers that adding from a link is turned off,
// when it is, saying whether it did.
func (a *App) refuseWhenAddFromLinkOff(w http.ResponseWriter) bool {
	if a.addFromLinkOff {
		writeError(w, http.StatusForbidden, "Adding a Beat from a link is turned off on this Bandmate.")
	}
	return a.addFromLinkOff
}

// ytDlpInUse tells About which yt-dlp fetches run, and whether it's the
// bundled one or an updated copy.
func (a *App) ytDlpInUse(w http.ResponseWriter, r *http.Request) {
	if a.refuseWhenAddFromLinkOff(w) {
		return
	}
	in, err := a.ytDlp.InUse(r.Context())
	if err != nil {
		writeFetchError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, in)
}

// ytDlpLatestCheck tells About whether a newer yt-dlp than the one in use
// has been released, so its Update button is offered only when there is
// one. A yt-dlp in use that's newer than the latest release, e.g. a mounted
// nightly, is up to date.
func (a *App) ytDlpLatestCheck(w http.ResponseWriter, r *http.Request) {
	if a.refuseWhenAddFromLinkOff(w) {
		return
	}
	in, err := a.ytDlp.InUse(r.Context())
	if err != nil {
		writeFetchError(w, err)
		return
	}
	latest, check := a.ytDlpLatest.Get(r.Context())
	report := struct {
		Check   releases.Check   `json:"check"`
		Verdict releases.Verdict `json:"verdict,omitempty"`
		Latest  *releases.Link   `json:"latest,omitempty"`
	}{Check: check}
	if check == releases.Checked {
		report.Latest = &latest
		report.Verdict = releases.UpToDate
		if in.Behind(latest.Tag) {
			report.Verdict = releases.UpdateAvailable
		}
	}
	writeJSON(w, http.StatusOK, report)
}

// updateYtDlp runs yt-dlp's self-update, only when About's Update yt-dlp is
// pressed, and says what it did.
func (a *App) updateYtDlp(w http.ResponseWriter, r *http.Request) {
	if a.refuseWhenAddFromLinkOff(w) {
		return
	}
	u, err := a.ytDlp.Update(r.Context())
	if err != nil {
		writeFetchError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// writeFetchError maps a fetch's errors onto HTTP responses.
func writeFetchError(w http.ResponseWriter, err error) {
	var refused *fetches.RefusedError
	switch {
	case errors.As(err, &refused):
		writeError(w, fetchStatus[refused.Reason], refused.Msg)
	case errors.Is(err, fetches.ErrNotFound):
		writeError(w, http.StatusNotFound, "That fetched audio is gone: it waits an hour, or until Bandmate restarts. Fetch the link again.")
	case errors.Is(err, context.Canceled):
		// Nobody is waiting for the answer.
	default:
		writeDomainError(w, err)
	}
}

// fetchStatus is the status each reason a fetch fails answers with.
var fetchStatus = map[fetches.Reason]int{
	fetches.NotALink:    http.StatusBadRequest,
	fetches.NotOneVideo: http.StatusUnprocessableEntity,
	fetches.Live:        http.StatusUnprocessableEntity,
	fetches.Private:     http.StatusUnprocessableEntity,
	fetches.SignIn:      http.StatusUnprocessableEntity,
	fetches.Unavailable: http.StatusUnprocessableEntity,
	fetches.Unsupported: http.StatusUnprocessableEntity,
	fetches.TooLarge:    http.StatusRequestEntityTooLarge,
	fetches.TimedOut:    http.StatusGatewayTimeout,
	fetches.Missing:     http.StatusServiceUnavailable,
	fetches.Failed:      http.StatusBadGateway,
}
