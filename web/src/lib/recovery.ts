// Recovering an unsaved Take: a recording kept in the browser while it
// records, and until the server confirms its upload, so a crashed tab or a
// failed upload doesn't lose it. Kept, it goes where it would have gone:
// into its Clip for a Retake, in step with the Takes already there even if
// the Clip moved, or at its Clip's start for a new Take. Where that's no
// longer possible, it's appended to its Track, or to the chosen Track once
// its own is gone, what it captured staying in step with where its Clip
// starts.
import type { Take } from './api';
import { recordingPlan, sungPastStart, type RecordingPlan } from './recording';
import type { Placed } from './schedule';

/** Where a recording was going, as kept with it. */
export interface Unsaved {
  trackId: number;
  /** The Clip retaken, or null for a new one. */
  clipId: number | null;
  /**
   * The Takes already in the Clip retaken, each with the Timeline time it
   * was recorded to start at (before any nudge), to keep the Retake in step
   * with them; none for a new one.
   */
  takes: { id: number; at: number }[];
  plan: RecordingPlan;
  /** The Latency Offset it was recorded with, in seconds. */
  latencyOffset: number;
}

/** Where a Take is uploaded to: into a Clip of Takes, or in a new Clip on a Track. */
export type TakeTarget = { clipId: number } | { trackId: number; start: number };

/** Where a recovered Take goes now, and the Timeline time its capture began there. */
export interface RecoveredPlacement {
  /** Null without Tracks, for the caller to add one: it then goes at 0:00. */
  target: TakeTarget | null;
  captureStart: number;
}

type PlacedClip = Placed & {
  id: number;
  activeTakeId: number | null;
  takes: readonly Pick<Take, 'id' | 'position' | 'nudge'>[];
};

// As the server's, so Clips that only touch don't overlap.
const tolerance = 1e-6;

/** The Timeline time each of a Clip's Takes was recorded to start at, before any nudge. */
export function takesAt(clip: PlacedClip): { id: number; at: number }[] {
  return clip.takes.map((t) => ({ id: t.id, at: clip.start - clip.offset + t.position - t.nudge }));
}

/**
 * Where a recording lasting duration seconds goes, on the Timeline's Tracks
 * as they are now, with the chosen Track; null if it stopped during the
 * lead-in, so there's nothing to keep.
 */
export function recoveredPlacement(
  tracks: readonly { id: number; clips: readonly PlacedClip[] }[],
  unsaved: Unsaved,
  duration: number,
  chosen: number | null,
): RecoveredPlacement | null {
  const { plan, latencyOffset } = unsaved;
  if (!sungPastStart(plan, duration, latencyOffset)) return null;
  // Moved later by, along with where its Clip is.
  const shifted = (by: number) => plan.from + by;
  const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === unsaved.clipId);
  if (clip && clip.activeTakeId !== null) {
    const now = takesAt(clip);
    const was = unsaved.takes.find((t) => now.some((n) => n.id === t.id));
    // Without them, where the Clip starts is all there is to go by.
    const by = was ? now.find((n) => n.id === was.id)!.at - was.at : clip.start - plan.start;
    return { target: { clipId: clip.id }, captureStart: shifted(by) };
  }
  const own = tracks.find((t) => t.id === unsaved.trackId);
  if (own && unsaved.clipId === null) {
    const end = plan.from + duration - latencyOffset;
    const free = own.clips.every((c) => c.start + c.length <= plan.start + tolerance || c.start >= end - tolerance);
    if (free) return { target: { trackId: own.id, start: plan.start }, captureStart: plan.from };
  }
  const track = own ?? tracks.find((t) => t.id === chosen) ?? tracks.at(-1);
  const start = track ? recordingPlan(track.clips, 0).start : 0;
  return { target: track ? { trackId: track.id, start } : null, captureStart: shifted(start - plan.start) };
}
