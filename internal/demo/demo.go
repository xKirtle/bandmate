// Package demo holds the Demo the Tour shows, built into Bandmate (ADR
// 0020): a one-Song Backup holding the Demo Song, with its Lyric Sheet and
// Timeline, and the Demo Beat its Clip plays. README.md beside it says how
// to rebuild it.
package demo

import _ "embed"

// Backup is the built-in Backup's file, as a Backup is downloaded.
//
//go:embed demo.bandmate
var Backup []byte
