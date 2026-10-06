//go:build !unix

package fetches

import "os/exec"

// stopTogether leaves stopping cmd as it is: only yt-dlp itself is stopped.
func stopTogether(*exec.Cmd) {}
