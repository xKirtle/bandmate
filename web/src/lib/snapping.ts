// Snapping: a dragged edge close enough to a target goes onto it exactly,
// so things line up on the Timeline. Plain arithmetic, so the Timeline
// only has to follow it: it says what can be snapped to, which edges are
// dragged and how near is near enough, and keeps its own limits after.

/** Somewhere an edge can snap to: a time, and what's there, e.g. a Clip's Track. */
export interface Target<T> {
  at: number;
  of: T;
}

/** A snap: which of the dragged edges went onto a target, by how far, the time it went to and what's there. */
export interface Snap<T> {
  edge: number;
  by: number;
  at: number;
  to: T[];
}

/**
 * Where the edges dragged would snap: onto the target nearest any of them,
 * within reach seconds, or null with none in reach. Its to is everything
 * at that time, e.g. for a guide through them all.
 */
export function snap<T>(targets: readonly Target<T>[], edges: readonly number[], reach: number): Snap<T> | null {
  let best: { edge: number; by: number; at: number } | null = null;
  for (const [edge, time] of edges.entries()) {
    for (const target of targets) {
      const by = target.at - time;
      if (Math.abs(by) <= reach && (!best || Math.abs(by) < Math.abs(best.by))) best = { edge, by, at: target.at };
    }
  }
  if (!best) return null;
  const { at } = best;
  return { ...best, to: targets.filter((t) => t.at === at).map((t) => t.of) };
}

/** How near a target an edge snaps to it, on screen, in pixels. */
export const snapPixels = 8;

/** How near a target an edge snaps to it, in seconds, at scale pixels a second. */
export function reachAt(scale: number): number {
  return snapPixels / scale;
}

/**
 * Where a Clip length seconds long moved to desired starts: snapped by
 * whichever of its edges is nearer a target in reach, then kept within
 * its limits by clamp. A limit that keeps it off the target leaves it
 * unsnapped, where it would go without snapping.
 */
export function snapMove<T>(
  targets: readonly Target<T>[],
  length: number,
  desired: number,
  reach: number,
  clamp: (start: number) => number,
): { start: number; snap: Snap<T> | null } {
  const found = snap(targets, [desired, desired + length], reach);
  if (found) {
    // From the target itself, so the edge lands on it exactly.
    const start = found.edge === 0 ? found.at : found.at - length;
    if (clamp(start) === start) return { start, snap: found };
  }
  return { start: clamp(desired), snap: null };
}

/**
 * The lanes a snap's guide runs across: from the lane being dragged in to
 * the furthest lane holding something aligned, either way.
 */
export function guideLanes(dragged: number, aligned: readonly number[]): { from: number; to: number } {
  return { from: Math.min(dragged, ...aligned), to: Math.max(dragged, ...aligned) };
}

/**
 * Every Clip's start and end as targets, on every Track but for the one
 * being dragged, each with the lane it's in, counted from the top.
 */
export function clipTargets(
  tracks: readonly { clips: readonly { id: number; start: number; length: number }[] }[],
  dragged: number,
): Target<number>[] {
  return tracks.flatMap((track, lane) =>
    track.clips
      .filter((c) => c.id !== dragged)
      .flatMap((c) => [
        { at: c.start, of: lane },
        { at: c.start + c.length, of: lane },
      ]),
  );
}
