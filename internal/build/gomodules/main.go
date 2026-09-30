// Command gomodules writes go-modules.json, the Go modules Bandmate's binary
// is built from, other than Bandmate itself, with their licenses, for the
// About page. go generate runs it in internal/build.
//
// go-licenses finds the licenses. It reports libraries, the package paths
// under one license file (e.g. golang.org/x/sys/unix), and a library once per
// license it finds there, so each library is mapped to the module it's in,
// as go list knows it, and each module is listed once, with every license.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"slices"
	"strings"
)

const (
	goLicenses = "github.com/google/go-licenses/v2@v2.0.1"
	binary     = "../../cmd/bandmate"
	self       = "github.com/xKirtle/bandmate"
	out        = "go-modules.json"
	// unknown is what go-licenses reports when it can't identify a license.
	unknown = "Unknown"
)

type module struct {
	Name     string   `json:"name"`
	Version  string   `json:"version"`
	License  string   `json:"license"`
	licenses []string // each distinct one, in the order found
}

func main() {
	log.SetFlags(0)
	log.SetPrefix("gomodules: ")

	versions, err := moduleVersions()
	if err != nil {
		log.Fatal(err)
	}
	libraries, err := libraryLicenses()
	if err != nil {
		log.Fatal(err)
	}

	byPath := map[string]*module{}
	for _, lib := range libraries {
		path := moduleOf(lib.name, versions)
		if path == "" {
			log.Fatalf("%s isn't in any module go list knows", lib.name)
		}
		m := byPath[path]
		if m == nil {
			m = &module{Name: path, Version: versions[path]}
			byPath[path] = m
		}
		if !slices.Contains(m.licenses, lib.license) {
			m.licenses = append(m.licenses, lib.license)
		}
	}

	mods := make([]module, 0, len(byPath))
	for _, m := range byPath {
		// A license found beside an unidentified one still applies.
		if len(m.licenses) > 1 {
			m.licenses = slices.DeleteFunc(m.licenses, func(l string) bool { return l == unknown })
		}
		m.License = strings.Join(m.licenses, " AND ")
		mods = append(mods, *m)
	}
	slices.SortFunc(mods, func(a, b module) int { return strings.Compare(a.Name, b.Name) })

	data, err := json.MarshalIndent(mods, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(out, append(data, '\n'), 0o644); err != nil {
		log.Fatal(err)
	}
}

// moduleVersions is the version of each module the binary is built from,
// other than Bandmate itself, by path.
func moduleVersions() (map[string]string, error) {
	cmd := exec.Command("go", "list", "-deps", "-f", "{{with .Module}}{{.Path}} {{.Version}}{{end}}", binary)
	cmd.Stderr = os.Stderr
	listed, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("listing the binary's modules: %w", err)
	}
	versions := map[string]string{}
	for line := range strings.Lines(string(listed)) {
		path, version, _ := strings.Cut(strings.TrimSpace(line), " ")
		if path != "" && path != self {
			versions[path] = version
		}
	}
	return versions, nil
}

type library struct{ name, license string }

// libraryLicenses is each library the binary is built from, other than
// Bandmate's own, once per license go-licenses finds for it.
func libraryLicenses() ([]library, error) {
	tmpl, err := os.CreateTemp("", "gomodules-*.tpl")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmpl.Name())
	if _, err := tmpl.WriteString("{{range .}}{{.Name}}\t{{.LicenseName}}\n{{end}}"); err != nil {
		return nil, err
	}
	if err := tmpl.Close(); err != nil {
		return nil, err
	}

	cmd := exec.Command("go", "run", goLicenses, "report", binary, "--ignore", self, "--template", tmpl.Name())
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	report, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("running go-licenses: %w\n%s", err, stderr.Bytes())
	}

	var libs []library
	scanner := bufio.NewScanner(bytes.NewReader(report))
	for scanner.Scan() {
		name, license, ok := strings.Cut(scanner.Text(), "\t")
		if !ok {
			continue
		}
		libs = append(libs, library{name: name, license: license})
	}
	return libs, scanner.Err()
}

// moduleOf is the module a package path is in: the longest module path it's
// under, or "" if none.
func moduleOf(pkg string, versions map[string]string) string {
	best := ""
	for path := range versions {
		if (pkg == path || strings.HasPrefix(pkg, path+"/")) && len(path) > len(best) {
			best = path
		}
	}
	return best
}
