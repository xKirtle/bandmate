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
	// Reason says what's wrong, in a sentence or two for a self-hoster,
	// up to where it points to the upgrade guide: it ends with the words
	// before guideWords, e.g. "…or roll back using the". The page links
	// guideWords there.
	Reason string
	// UpgradeCopy is the Upgrade copy this Bandmate can run, to roll back
	// to, as a path within the data directory, if there is one.
	UpgradeCopy string
	// Err is what caused it, if anything did.
	Err error
}

// guideWords end every refusal's reason, naming the upgrade guide.
const guideWords = "upgrade guide"

// Error is the reason in full, as plain text.
func (r *Refused) Error() string { return r.Reason + " " + guideWords + "." }

func (r *Refused) Unwrap() error { return r.Err }

// upgradeCopyFound starts the sentence naming a refusal's Upgrade copy,
// which ends with its path.
const upgradeCopyFound = "An Upgrade copy that can be used with this Bandmate version has been found at "

// UpgradeCopyFound is the sentence naming the Upgrade copy this Bandmate
// can run, for the log, or "" if there's none.
func (r *Refused) UpgradeCopyFound() string {
	if r.UpgradeCopy == "" {
		return ""
	}
	return upgradeCopyFound + r.UpgradeCopy + "."
}

// refusedNewer is the refusal of a database a newer Bandmate migrated. It
// names upgradeCopy, the Upgrade copy this Bandmate can run, if there is one.
func refusedNewer(err error, upgradeCopy string) *Refused {
	return &Refused{
		Reason: "The database was changed by a newer Bandmate, which this older one can't run on. " +
			"Run the newer Bandmate again, or roll back using the",
		UpgradeCopy: upgradeCopy,
		Err:         err,
	}
}

// refusedUpgradeCopy is the refusal of a database whose Upgrade copy
// couldn't be taken, so it wasn't migrated: without the copy, the upgrade
// couldn't be rolled back.
func refusedUpgradeCopy(err *db.UpgradeCopyError) *Refused {
	return &Refused{
		Reason: "Bandmate couldn't copy the database before upgrading it, so it hasn't upgraded it (" +
			err.Err.Error() + "). Make sure Bandmate can write to the upgrade-copies folder of its data folder " +
			"and that the disk has room, then start it again. See the",
		Err: err,
	}
}

// RefusalHandler serves a refused Bandmate: one page, the same for every
// path, saying why, linking the upgrade guide from its reason, and naming
// the Upgrade copy to roll back to if there is one, and an unhealthy health
// check. It serves no app and no API.
func RefusalHandler(r *Refused) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/api/health" {
			writeError(w, http.StatusServiceUnavailable, r.Error())
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusServiceUnavailable)
		page := struct{ Reason, Guide, GuideWords, UpgradeCopy, Found string }{
			r.Reason, UpgradeGuide, guideWords, r.UpgradeCopy, upgradeCopyFound,
		}
		if err := refusalPage.Execute(w, page); err != nil {
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
code { overflow-wrap: anywhere; }
</style>
</head>
<body>
<h1>Bandmate can't start</h1>
<p>{{.Reason}} <a href="{{.Guide}}">{{.GuideWords}}</a>.</p>
{{with .UpgradeCopy}}<p>{{$.Found}}<code>{{.}}</code>.</p>
{{end}}</body>
</html>
`))
