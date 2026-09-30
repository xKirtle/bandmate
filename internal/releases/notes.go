package releases

import (
	"regexp"
	"strconv"
	"strings"
)

// Badge marks what kind of change a Note is, from the heading GitHub groups
// it under by its pull request's label (see .github/release.yml).
type Badge string

const (
	NewFeature Badge = "new"
	Fix        Badge = "fix"
	Docs       Badge = "docs"
	// None is a change under Other, or under no heading.
	None Badge = ""
)

// categories are the headings of GitHub's generated notes, from
// .github/release.yml, and the Badge each gives its changes.
var categories = map[string]Badge{
	"Features": NewFeature,
	"Fixes":    Fix,
	"Docs":     Docs,
	"Other":    None,
}

// Note is one row of a release's notes: a pull request, with its Badge,
// title and link, or else a line of Text as the release's author wrote it.
type Note struct {
	Badge  Badge  `json:"badge,omitempty"`
	Title  string `json:"title,omitempty"`
	URL    string `json:"url,omitempty"`
	Number int    `json:"number,omitempty"`
	Text   string `json:"text,omitempty"`
}

var (
	// change is a pull request as GitHub's generated notes list it:
	// "* <title> by @<author> in <link to the pull request>". The title may
	// itself contain " by @", so the last one splits it off.
	change = regexp.MustCompile(`^\* (.+) by @\S+ in (https://\S+/pull/(\d+))$`)
	// firstContribution is a line under "New Contributors".
	firstContribution = regexp.MustCompile(`^\* @\S+ made their first contribution in https://\S+$`)
)

// Parse reads a release's notes into rows. GitHub's generated notes become a
// row per pull request; their headings and other boilerplate (the new
// contributors and the full changelog link) are left out. Any other line,
// such as a hand-written summary, is kept as Text, so nothing written is lost.
func Parse(body string) []Note {
	notes := []Note{}
	badge := None
	for line := range strings.Lines(body) {
		line = strings.TrimSpace(line)
		switch {
		case line == "",
			strings.HasPrefix(line, "<!--") && strings.HasSuffix(line, "-->"),
			strings.HasPrefix(line, "**Full Changelog**:"),
			firstContribution.MatchString(line):
			continue
		case line == "## What's Changed", line == "## New Contributors":
			badge = None
			continue
		}
		if heading, ok := strings.CutPrefix(line, "### "); ok {
			if b, known := categories[heading]; known {
				badge = b
				continue
			}
		}
		if m := change.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[3])
			notes = append(notes, Note{Badge: badge, Title: m[1], URL: m[2], Number: n})
			continue
		}
		if strings.HasPrefix(line, "#") {
			// A heading of the author's own starts a part the categories
			// don't reach.
			badge = None
		}
		notes = append(notes, Note{Text: line})
	}
	return notes
}
