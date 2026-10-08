package app

import (
	"errors"
	"log"
	"net/http"

	"github.com/xKirtle/bandmate/internal/domain"
)

// domainStatus is the status each kind of domain error answers with.
var domainStatus = map[domain.Kind]int{
	domain.KindInvalid:  http.StatusBadRequest,
	domain.KindConflict: http.StatusConflict,
	domain.KindNotFound: http.StatusNotFound,
}

// writeDomainError maps the domain packages' errors onto HTTP responses: a
// domain error answers with its message, and its code and details where it
// has any; anything else is logged and answers 500.
func writeDomainError(w http.ResponseWriter, err error) {
	var de *domain.Error
	status, ok := 0, errors.As(err, &de)
	if ok {
		status, ok = domainStatus[de.Kind]
	}
	if !ok {
		log.Printf("internal error: %v", err)
		writeError(w, http.StatusInternalServerError, "something went wrong")
		return
	}
	if de.Code == "" && len(de.Details) == 0 {
		writeError(w, status, de.Msg)
		return
	}
	body := make(map[string]any, len(de.Details)+2)
	for k, v := range de.Details {
		body[k] = v
	}
	body["error"] = de.Msg
	if de.Code != "" {
		body["code"] = de.Code
	}
	writeJSON(w, status, body)
}
