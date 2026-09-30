package releases

import (
	"cmp"
	"strconv"
	"strings"
)

// version is a release tag read as semantic versioning: v1.2.3, maybe with a
// pre-release suffix, e.g. v1.2.3-rc.1.
type version struct {
	core [3]int
	pre  string
}

// parseVersion reads a tag such as v0.4.0. ok is false for anything else,
// such as a commit or "dev".
func parseVersion(tag string) (v version, ok bool) {
	rest, found := strings.CutPrefix(tag, "v")
	if !found {
		return v, false
	}
	rest, _, _ = strings.Cut(rest, "+") // Build metadata doesn't order.
	rest, v.pre, _ = strings.Cut(rest, "-")
	parts := strings.Split(rest, ".")
	if len(parts) != 3 {
		return v, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || p != strconv.Itoa(n) {
			return v, false
		}
		v.core[i] = n
	}
	return v, true
}

// compareVersions orders a and b as semantic versioning does: by their
// numbers, then a pre-release before its release.
func compareVersions(a, b version) int {
	for i := range a.core {
		if c := cmp.Compare(a.core[i], b.core[i]); c != 0 {
			return c
		}
	}
	switch {
	case a.pre == b.pre:
		return 0
	case a.pre == "":
		return 1
	case b.pre == "":
		return -1
	}
	return comparePre(a.pre, b.pre)
}

// comparePre orders two pre-release suffixes field by field: numbers by
// value and before words, words alphabetically, and fewer fields first.
func comparePre(a, b string) int {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := range min(len(as), len(bs)) {
		an, aErr := strconv.Atoi(as[i])
		bn, bErr := strconv.Atoi(bs[i])
		var c int
		switch {
		case aErr == nil && bErr == nil:
			c = cmp.Compare(an, bn)
		case aErr == nil:
			c = -1
		case bErr == nil:
			c = 1
		default:
			c = strings.Compare(as[i], bs[i])
		}
		if c != 0 {
			return c
		}
	}
	return cmp.Compare(len(as), len(bs))
}
