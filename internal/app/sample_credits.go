package app

import "github.com/xKirtle/bandmate/internal/build"

// sampleCredits is the recorded samples the Instruments sound from, which
// ship in the web app, in web/public/samples/, each set's licence beside it
// (ADR 0030), as About credits them. Each version is the commit
// web/scripts/samples.sh takes the set from, or for Iowa's, whose files carry
// no version and are pinned by checksum instead, the year they were recorded.
// Iowa's terms aren't a licence SPDX names, so its License is a LicenseRef
// and its URL the page that states them.
var sampleCredits = []build.Dependency{
	{
		Name:    "Salamander Grand Piano",
		Version: "efd8296",
		License: "CC-BY-3.0",
		Credit: []build.Link{
			{Text: "The piano's samples: "},
			{Text: "Salamander Grand Piano", URL: "https://github.com/Tonejs/audio/tree/master/salamander"},
			{Text: " V2 by Alexander Holm, "},
			{Text: "CC BY 3.0", URL: "https://creativecommons.org/licenses/by/3.0/"},
			{Text: ", trimmed and re-encoded."},
		},
	},
	{
		Name:    "University of Iowa Musical Instrument Samples",
		Version: "2011",
		License: "LicenseRef-Iowa-MIS",
		URL:     "https://theremin.music.uiowa.edu/MIS.html",
		Credit: []build.Link{
			{Text: "The guitar's samples: "},
			{Text: "University of Iowa Electronic Music Studios", URL: "https://theremin.music.uiowa.edu/MIS.html"},
			{Text: ", "},
			{Text: "Musical Instrument Samples", URL: "https://theremin.music.uiowa.edu/MISguitar.html"},
			{Text: " (Raimundo 118, Brian Penkrot, 2011), trimmed, retuned and re-encoded; free to use for any project, without restrictions."},
		},
	},
}
