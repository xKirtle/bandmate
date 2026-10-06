//go:build unix

package fetches

import (
	"os/exec"
	"syscall"
)

// stopTogether has stopping cmd stop everything it started too: the
// standalone yt-dlp runs as a child of its own launcher, and starts ffmpeg.
func stopTogether(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
}
