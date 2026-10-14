package app

import "net/http"

// tourOffer is whether the Tour has been offered on the empty Songs page,
// the same on every Device.
type tourOffer struct {
	Offered bool `json:"offered"`
}

// tourOffered tells whether the Tour has been offered.
func (a *App) tourOffered(w http.ResponseWriter, r *http.Request) {
	offered, err := a.tour.Offered(r.Context())
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tourOffer{Offered: offered})
}

// markTourOffered marks the Tour offered, as taking it or saying No thanks
// from the offer does, so no Device offers it again.
func (a *App) markTourOffered(w http.ResponseWriter, r *http.Request) {
	if err := a.tour.MarkOffered(r.Context()); err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tourOffer{Offered: true})
}
