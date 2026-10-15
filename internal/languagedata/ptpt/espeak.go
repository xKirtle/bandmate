package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
)

// espeakVersion is the version of eSpeak NG the pronunciations are made
// with, as another can say words differently. Keep espeakVersion in
// languagedata.go in step with it.
const espeakVersion = "1.51.1"

// batch is how many words one run of eSpeak NG says.
const batch = 10000

// espeak is the command that runs eSpeak NG: $ESPEAK_NG, such as a
// container's, or else espeak-ng.
func espeak(args ...string) *exec.Cmd {
	command := strings.Fields(os.Getenv("ESPEAK_NG"))
	if len(command) == 0 {
		command = []string{"espeak-ng"}
	}
	return exec.Command(command[0], append(command[1:], args...)...)
}

// checkEspeak makes sure eSpeak NG runs, and is the pinned version.
func checkEspeak() error {
	out, err := espeak("--version").Output()
	if err != nil {
		return fmt.Errorf("running eSpeak NG (install it, or set ESPEAK_NG to a command that runs it, as CONTRIBUTING.md says): %w", err)
	}
	if !strings.Contains(string(out), "text-to-speech: "+espeakVersion+" ") {
		return fmt.Errorf("eSpeak NG is %q, want version %s", strings.TrimSpace(string(out)), espeakVersion)
	}
	return nil
}

// sayAll is each word as eSpeak NG's European Portuguese voice says it, in
// IPA, its phonemes parted by "_": "dɨ_p_ˈoɪ_ʃ". Each word is said as a
// sentence of its own, so none sounds as it would before the next. The
// words go in batches, several at once.
func sayAll(words []string) (map[string]string, error) {
	said := make(map[string]string, len(words))
	var mu sync.Mutex
	var firstErr error
	work := make(chan []string)
	var wg sync.WaitGroup
	for range runtime.NumCPU() {
		wg.Go(func() {
			for chunk := range work {
				lines, err := say(chunk)
				mu.Lock()
				if err != nil && firstErr == nil {
					firstErr = err
				}
				for i, line := range lines {
					said[chunk[i]] = line
				}
				mu.Unlock()
			}
		})
	}
	for start := 0; start < len(words); start += batch {
		work <- words[start:min(start+batch, len(words))]
	}
	close(work)
	wg.Wait()
	return said, firstErr
}

// say is a batch of words as eSpeak NG says them, a line each.
func say(words []string) ([]string, error) {
	var in bytes.Buffer
	for _, w := range words {
		in.WriteString(w + ".\n")
	}
	cmd := espeak("-v", "pt", "-q", "--ipa", "--sep=_")
	cmd.Stdin = &in
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("running eSpeak NG: %w", err)
	}
	lines := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	if len(lines) != len(words) {
		return nil, fmt.Errorf("eSpeak NG said %d lines for %d words, from %q", len(lines), len(words), words[0])
	}
	for i := range lines {
		lines[i] = strings.TrimSpace(lines[i])
	}
	return lines, nil
}
