package app

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/xKirtle/bandmate/internal/beats"
	"github.com/xKirtle/bandmate/internal/fetches"
)

// A Beat added from a link is fetched first, into a waiting file the
// browser reads once, as it reads an uploaded file, and then added by
// reference to it, so its audio is never sent back.

// fetchLink fetches a link's audio into a waiting file, answering once it's
// there. Abandoning the request stops the fetch.
func (a *App) fetchLink(w http.ResponseWriter, r *http.Request) {
	if a.addFromLinkOff {
		writeError(w, http.StatusForbidden, "Adding a Beat from a link is turned off on this Bandmate.")
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
		writeBeatError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, added)
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
		log.Printf("internal error: %v", err)
		writeError(w, http.StatusInternalServerError, "something went wrong")
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
