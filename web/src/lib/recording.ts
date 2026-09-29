// Where a recording goes on the chosen Track, and where playback and
// capture start for it. The playhead never decides: a Take always goes at
// the Track's append point, so it never lands on an older one.
import type { Placed } from './schedule';

/** How long playback leads in before a Take, in seconds, so the Beat is heard coming in. */
export const leadIn = 2;

/** Where a recording goes, and where playing and capturing start for it, in seconds. */
export interface RecordingPlan {
  /** Where the Take's Clip starts: the append point. */
  start: number;
  /** Where playback and capture start: leadIn before, but never before 0:00. */
  from: number;
}

/**
 * Plans a recording on a Track holding clips: its Take goes where the last
 * of them ends, or at 0:00 on an empty Track.
 */
export function recordingPlan(clips: readonly Placed[]): RecordingPlan {
  const start = clips.reduce((end, c) => Math.max(end, c.start + c.length), 0);
  return { start, from: Math.max(0, start - leadIn) };
}
