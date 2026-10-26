package app

import "github.com/xKirtle/bandmate/internal/build"

// sampleCredits is the recorded samples the Instruments sound from, which
// ship in the web app, in web/public/samples/, each set's licence beside it
// (ADR 0030), as About credits them. Each version is the commit
// web/scripts/samples.sh takes the set from.
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
}
