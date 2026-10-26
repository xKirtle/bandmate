#!/usr/bin/env bash
# Makes the recorded samples the Instruments sound from (ADR 0030), as they
# ship in public/samples/: downloads each set's source files at a pinned
# commit, then trims each one's leading silence, keeps what's heard with a
# short fade out, and encodes it mono, 44.1 kHz, MP3 at 96 kb/s, as #1205
# measured and picked them. The files are committed, so builds don't run
# this: run it again only to remake them, which needs network access, curl
# and an ffmpeg with libmp3lame.
#
# Run from anywhere: bash web/scripts/samples.sh
set -euo pipefail

public="$(cd "$(dirname "$0")/../public" && pwd)"
src="$(mktemp -d)"
trap 'rm -rf "$src"' EXIT

# make_set <folder> <source URL> <seconds kept> <fade-out start> <fade-out length> <file names...>
make_set() {
  local folder=$1 from=$2 keep=$3 fade_at=$4 fade_for=$5
  shift 5
  local out="$public/samples/$folder"
  mkdir -p "$out" "$src/$folder"
  for name in "$@"; do
    curl -sSfL -o "$src/$folder/$name.mp3" "$from/$name.mp3"
    ffmpeg -hide_banner -loglevel error -y -i "$src/$folder/$name.mp3" \
      -af "silenceremove=start_periods=1:start_threshold=-50dB,atrim=0:$keep,afade=t=out:st=$fade_at:d=$fade_for" \
      -ac 1 -ar 44100 -c:a libmp3lame -b:a 96k "$out/$name.mp3"
  done
}

# The piano: Salamander Grand Piano V2 by Alexander Holm (CC BY 3.0), as
# Tone.js packages it (https://github.com/Tonejs/audio, salamander/, the same
# files tonejs.github.io/audio/salamander/ serves), one velocity, every minor
# third from F#2 to C5. 6 s each, fading out over the last 0.5 s, as a
# piano's still ringing then.
make_set piano \
  "https://raw.githubusercontent.com/Tonejs/audio/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander" \
  6 5.5 0.5 \
  Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5

# The guitar: a steel-string acoustic from the University of Iowa Electronic
# Music Studios' Musical Instrument Samples, as Nicholaus Brosowsky's
# tonejs-instruments packages them (CC-BY 3.0;
# https://github.com/nbrosowsky/tonejs-instruments, samples/guitar-acoustic/,
# the same files nbrosowsky.github.io/tonejs-instruments/samples/ serves),
# every 2 semitones from D2 to D5. 4.5 s each, fading out over the last
# 0.3 s.
make_set guitar \
  "https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/622c2f1c32c8cfce4158ddc3eb26e518ddef37e5/samples/guitar-acoustic" \
  4.5 4.2 0.3 \
  D2 E2 Fs2 Gs2 As2 C3 D3 E3 Fs3 Gs3 As3 C4 D4 E4 Fs4 Gs4 As4 C5 D5

du -ch "$public"/samples/*/*.mp3 | tail -1
