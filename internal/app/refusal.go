package app

import (
	"html/template"
	"log"
	"net/http"

	"github.com/xKirtle/bandmate/internal/db"
)

// UpgradeGuide is the self-hosting guide's section on upgrading and rolling
// back, which says how to put right what a refused start names.
const UpgradeGuide = "https://xkirtle.github.io/bandmate/self-hosting#upgrading-and-rolling-back"

// Refused is the error New returns when Bandmate won't run on its data
// directory as it is. It neither migrates the database nor serves the app:
// main serves RefusalHandler in its place, so the reason shows in the
// browser and Docker doesn't restart Bandmate in a loop.
type Refused struct {
	// Reason says what's wrong, in a sentence or two for a self-hoster.
	Reason string
	// Err is what caused it, if anything did.
	Err error
}

func (r *Refused) Error() string { return r.Reason }

func (r *Refused) Unwrap() error { return r.Err }

// refusedNewer is the refusal of a database a newer Bandmate migrated. It
// names rollBackTo, the Upgrade copy this Bandmate can run, if there is one.
func refusedNewer(err error, rollBackTo string) *Refused {
	reason := "The database was changed by a newer Bandmate, which this older one can't run on. " +
		"Run the newer Bandmate again, or roll back as the upgrade guide says."
	if rollBackTo != "" {
		reason += " An Upgrade copy this Bandmate can run is in the data folder: " + rollBackTo + "."
	}
	return &Refused{Reason: reason, Err: err}
}

// refusedUpgradeCopy is the refusal of a database whose Upgrade copy
// couldn't be taken, so it wasn't migrated: without the copy, the upgrade
// couldn't be rolled back.
func refusedUpgradeCopy(err *db.UpgradeCopyError) *Refused {
	return &Refused{
		Reason: "Bandmate couldn't copy the database before upgrading it, so it hasn't upgraded it (" +
			err.Err.Error() + "). Make sure Bandmate can write to the upgrade-copies folder of its data folder " +
			"and that the disk has room, then start it again.",
		Err: err,
	}
}

// RefusalHandler serves a refused Bandmate: one page, the same for every
// path, saying why and linking the upgrade guide, and an unhealthy health
// check. It serves no app and no API.
func RefusalHandler(r *Refused) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/api/health" {
			writeError(w, http.StatusServiceUnavailable, r.Reason)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusServiceUnavailable)
		if err := refusalPage.Execute(w, struct{ Reason, Guide string }{r.Reason, UpgradeGuide}); err != nil {
			log.Printf("writing the refusal page: %v", err)
		}
	})
}

// refusalPage is bare and self-contained, as the SPA isn't served: the
// browser's own colours in either theme, the system font, and the values of
// the app's type and spacing tokens.
var refusalPage = template.Must(template.New("refusal").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Bandmate can't start</title>
<style>
body { font-family: system-ui, sans-serif; font-size: 1rem; line-height: 1.5; max-width: 40rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { font-size: 1.5rem; }
</style>
</head>
<body>
<h1>Bandmate can't start</h1>
<p>{{.Reason}}</p>
<p><a href="{{.Guide}}">Upgrading and rolling back</a>, in the self-hosting guide</p>
</body>
</html>
`))
