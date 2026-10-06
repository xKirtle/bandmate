//go:build unix

package app_test

import (
	"os"
	"strconv"
	"syscall"
	"testing"
)

// expectStopped fails the test unless the stand-in yt-dlp whose process id
// is in pidFile has stopped.
func expectStopped(t *testing.T, pidFile string) {
	t.Helper()
	text, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatalf("the stand-in yt-dlp never started: %v", err)
	}
	pid, _ := strconv.Atoi(string(text))
	waitFor(t, "yt-dlp to stop", func() bool { return syscall.Kill(pid, 0) != nil })
}
