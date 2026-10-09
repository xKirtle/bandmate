// Where a Clip's audio meets the Timeline. A Clip's start and length are
// Timeline time, while its offset, a Take's position and nudge, and its
// source's duration are time in its audio. It plays its audio at a rate:
// how many seconds of its source it plays for each second of the Timeline.
// Everything that crosses between the two goes through here, so the rate
// is the one place a Clip's speed is decided: its Tempo.

import type { Placed } from './schedule';

/** How many seconds of its source a Clip plays for each second of the Timeline. */
function rate(clip: Placed): number {
  return clip.tempo ?? 1;
}

/** Where in its source a Clip is at time t on the Timeline, in seconds; before its start or past its end too. */
export function sourceAt(clip: Placed, t: number): number {
  return clip.offset + (t - clip.start) * rate(clip);
}

/** When on the Timeline a Clip reaches a position in its source, in seconds; outside its trim too. */
export function timelineAt(clip: Placed, position: number): number {
  return clip.start + (position - clip.offset) / rate(clip);
}

/** How many seconds of its source a Clip plays over seconds of the Timeline. */
export function sourceLength(clip: Placed, seconds: number): number {
  return seconds * rate(clip);
}

/** How many seconds of the Timeline a Clip takes to play seconds of its source. */
export function timelineLength(clip: Placed, seconds: number): number {
  return seconds / rate(clip);
}
