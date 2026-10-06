//go:build !unix

package app_test

import (
	"os"
	"testing"
)

// expectStopped can't ask whether a process is running here, so it checks
// only that the stand-in yt-dlp started.
func expectStopped(t *testing.T, pidFile string) {
	t.Helper()
	waitFor(t, "yt-dlp to start", func() bool { _, err := os.Stat(pidFile); return err == nil })
}
