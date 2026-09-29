// Where a recording goes on the chosen Track, and where playback and
// capture start for it. The playhead never decides: a Take always goes at
// the Track's append point, so it never lands on an older one. A Retake
// goes into its Clip instead, from the Clip's start as trimmed, and grows
// it, but never into the next Clip.
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

/** Plans a Retake into a Clip: from its start as trimmed, with the same lead-in. */
export function retakePlan(clip: Placed): RecordingPlan {
  return { start: clip.start, from: Math.max(0, clip.start - leadIn) };
}

/**
 * How long a Clip is after a Retake into it that ends at end: grown to fit
 * it, but never past the start of the next of its Track's clips, and never
 * shrunk. What's past that is kept, hidden, to trim into view later.
 */
export function retakeLength(clip: Placed, clips: readonly Placed[], end: number): number {
  // With the server's tolerance, so a neighbour placed right at its end counts as next.
  const after = clip.start + clip.length - 1e-6;
  const next = clips.reduce((at, c) => (c.start >= after ? Math.min(at, c.start) : at), Infinity);
  return Math.max(clip.length, Math.min(end, next) - clip.start);
}

// As the server's, so a Take ending right at its Clip's start counts as none.
const tolerance = 1e-6;

/**
 * Whether a recording planned so, lasting duration seconds and placed
 * latencyOffset earlier, has anything past its Clip's start, rather than
 * stopping during the lead-in with nothing to keep.
 */
export function sungPastStart(plan: RecordingPlan, duration: number, latencyOffset: number): boolean {
  return plan.from + duration - latencyOffset > plan.start + tolerance;
}
