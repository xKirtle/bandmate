// Recovering an unsaved Take: a recording kept in the browser while it
// records, and until the server confirms its upload, so a crashed tab or a
// failed upload doesn't lose it. Kept, it goes where it would have gone:
// into its Clip for a Retake, or at its Clip's start for a new Take. Where
// that's no longer possible, it's appended to its Track, or to the chosen
// Track once its own is gone, what it captured staying in step with where
// its Clip starts.
import { recordingPlan, type RecordingPlan } from './recording';
import type { Placed } from './schedule';

/** Where a recording was going, as kept with it. */
export interface Unsaved {
  trackId: number;
  /** The Clip retaken, or null for a new one. */
  clipId: number | null;
  /** Where the retaken Clip's source span started on the Timeline (its start less its offset), or 0 for a new one. */
  origin: number;
  plan: RecordingPlan;
  /** The Latency Offset it was recorded with, in seconds. */
  latencyOffset: number;
}

/** Where a recovered Take goes now, and the Timeline time its capture began there. */
export type RecoveredPlacement =
  | { kind: 'retake'; clipId: number; captureStart: number }
  /** A new Clip at start, on trackId, or on a Track to add first where it's null. */
  | { kind: 'record'; trackId: number | null; start: number; captureStart: number };

type PlacedClip = Placed & { id: number; activeTakeId: number | null };

// As the server's, so Clips that only touch don't overlap.
const tolerance = 1e-6;

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
  if (plan.from + duration - latencyOffset <= plan.start + tolerance) return null;
  // Moved later by, along with where its Clip starts.
  const shifted = (by: number) => plan.from + by;
  if (unsaved.clipId !== null) {
    const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === unsaved.clipId);
    if (clip && clip.activeTakeId !== null) {
      return { kind: 'retake', clipId: clip.id, captureStart: shifted(clip.start - clip.offset - unsaved.origin) };
    }
  }
  const own = tracks.find((t) => t.id === unsaved.trackId);
  if (own && unsaved.clipId === null) {
    const end = plan.from + duration - latencyOffset;
    const free = own.clips.every((c) => c.start + c.length <= plan.start + tolerance || c.start >= end - tolerance);
    if (free) return { kind: 'record', trackId: own.id, start: plan.start, captureStart: plan.from };
  }
  const track = own ?? tracks.find((t) => t.id === chosen) ?? tracks.at(-1);
  const start = track ? recordingPlan(track.clips).start : 0;
  return { kind: 'record', trackId: track?.id ?? null, start, captureStart: shifted(start - plan.start) };
}

/** Samples captured in a batch, with the frame the first was captured at. */
export interface Batch {
  frame: number;
  samples: Float32Array;
}

/**
 * The samples captured from a frame on, from batches in any order, with
 * silence wherever none were kept.
 */
export function samplesFrom(batches: readonly Batch[], first: number): Float32Array<ArrayBuffer> {
  const last = batches.reduce((end, b) => Math.max(end, b.frame + b.samples.length), first);
  const samples = new Float32Array(last - first);
  for (const { frame, samples: batch } of batches) {
    const skip = Math.max(0, first - frame);
    if (skip < batch.length) samples.set(batch.subarray(skip), frame + skip - first);
  }
  return samples;
}
