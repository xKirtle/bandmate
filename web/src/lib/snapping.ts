// Snapping: a dragged edge close enough to a target goes onto it exactly,
// so things line up on the Timeline. Plain arithmetic, so the Timeline
// only has to follow it: it says what can be snapped to, which edges are
// dragged and how near is near enough, and keeps its own limits after.

import { tolerance } from './trackPlacement';

/** A Timeline's Tracks, top to bottom, as far as snapping goes: where each Clip on them is. */
export type Tracks = readonly { clips: readonly { id: number; start: number; length: number }[] }[];

/** Somewhere an edge can snap to: a time, and what's there, e.g. a Clip's Track. */
export interface Target<T> {
  at: number;
  of: T;
}

/** A snap: which of the dragged edges went onto a target, by how far, the time it went to and what's aligned there. */
export interface Snap<T> {
  edge: number;
  by: number;
  at: number;
  aligned: T[];
}

// Times within the server's tolerance are the same time, as rounding leaves
// a Clip's end a hair off a start it was lined up with.

/**
 * Where the edges dragged would snap: onto the target nearest any of them,
 * within reach seconds, or null with none in reach. It gives back
 * everything aligned at that time, e.g. for a guide through them all.
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
  return { ...best, aligned: targets.filter((t) => Math.abs(t.at - at) <= tolerance).map((t) => t.of) };
}

/** How near a target an edge snaps to it, on screen, in pixels. */
const snapPixels = 8;

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

/** A snap of the Selection: which selected Clip's edge, its start (0) or end (1), went onto a target. */
export type SelectionSnap<T> = Snap<T> & { clipId: number };

/**
 * How far the selected Clips, moved together by desired seconds, go:
 * snapped by whichever start or end of any of them is nearest a target in
 * reach, then kept within their limits by clamp, which gives the amount
 * they can move by nearest to the one asked. A limit that keeps them off
 * the target leaves them unsnapped, where they would go without snapping,
 * as does free, for Shift held.
 */
export function snapSelection<T>(
  targets: readonly Target<T>[],
  clips: readonly { id: number; start: number; length: number }[],
  desired: number,
  reach: number,
  clamp: (by: number) => number,
  free = false,
): { by: number; snap: SelectionSnap<T> | null } {
  if (free) return { by: clamp(desired), snap: null };
  const edges = clips.flatMap((c) => [c.start, c.start + c.length]);
  const found = snap(
    targets,
    edges.map((at) => at + desired),
    reach,
  );
  if (found) {
    // From the target itself, so the edge that snapped lands on it.
    const by = found.at - edges[found.edge];
    // A hair off is still on it, as the clamp works out the amount from a start.
    if (Math.abs(clamp(by) - by) <= tolerance) {
      const clip = clips[Math.floor(found.edge / 2)];
      return { by, snap: { ...found, clipId: clip.id, edge: found.edge % 2 } };
    }
  }
  return { by: clamp(desired), snap: null };
}

/**
 * Where one edge dragged to desired goes: onto a target in reach, then
 * kept within its limits by clamp, e.g. a trimmed Clip's edge. A limit
 * that keeps it off the target leaves it unsnapped, where it would go
 * without snapping.
 */
export function snapEdge<T>(
  targets: readonly Target<T>[],
  desired: number,
  reach: number,
  clamp: (at: number) => number,
): { at: number; snap: Snap<T> | null } {
  const found = snap(targets, [desired], reach);
  // A hair off is still on it, as a trimmed end is worked out from a length.
  if (found && Math.abs(clamp(found.at) - found.at) <= tolerance) return { at: found.at, snap: found };
  return { at: clamp(desired), snap: null };
}

/** How the Loop is being set: marking a new one, or dragging its start or end. */
export type LoopDrag = 'new' | 'start' | 'end';

/** Where a new Loop pressed at desired is marked from: onto a target in reach, if there is one. */
export function loopMark<T>(targets: readonly Target<T>[], desired: number, reach: number): number {
  return snap(targets, [desired], reach)?.at ?? desired;
}

/**
 * Where the Loop goes as an edge of it is dragged to desired, the other
 * staying at anchor: onto a target in reach, then kept from 0:00 and
 * from being shorter than shortest seconds. A limit that keeps it off the
 * target leaves it unsnapped, where it would go without snapping.
 *
 * A new Loop, marked from anchor, runs to desired either side of it. It's
 * never snapped shorter than shortest, or to the other side of anchor,
 * but goes as short as it's dragged unsnapped, as one that short isn't
 * set at all.
 */
export function snapLoop<T>(
  targets: readonly Target<T>[],
  mode: LoopDrag,
  anchor: number,
  desired: number,
  reach: number,
  shortest: number,
): { start: number; end: number; snap: Snap<T> | null } {
  if (mode === 'new') {
    const found = snap(targets, [desired], reach);
    const sameSide = found && (found.at - anchor) * (desired - anchor) > 0;
    const snapped = found && sameSide && Math.abs(found.at - anchor) >= shortest ? found : null;
    const to = snapped ? snapped.at : desired;
    return { start: Math.min(anchor, to), end: Math.max(anchor, to), snap: snapped };
  }
  if (mode === 'start') {
    const moved = snapEdge(targets, desired, reach, (at) => Math.max(0, Math.min(at, anchor - shortest)));
    return { start: moved.at, end: anchor, snap: moved.snap };
  }
  const moved = snapEdge(targets, desired, reach, (at) => Math.max(at, anchor + shortest));
  return { start: anchor, end: moved.at, snap: moved.snap };
}

/**
 * What's aligned at a target: a Clip's edge, in the lane it's in counted
 * from the top; one of the Loop's edges; or the playhead.
 */
export type Aligned = number | 'loop' | 'playhead';

/**
 * The lanes a snap's guide runs across: from the lane being dragged in to
 * the furthest lane holding a Clip aligned, either way, and up to the
 * ruler for a Loop edge, or for the Loop being dragged, the Loop being
 * drawn above it. The playhead is already a line, so it's left out, and
 * with nothing else aligned there's no guide.
 */
export function guideLanes(
  dragged: number | 'ruler',
  aligned: readonly Aligned[],
): { from: number | 'ruler'; to: number } | null {
  const rest = aligned.filter((a) => a !== 'playhead');
  if (rest.length === 0) return null;
  const lanes = rest.filter((a) => a !== 'loop');
  if (dragged !== 'ruler') lanes.push(dragged);
  return {
    from: dragged === 'ruler' || rest.includes('loop') ? 'ruler' : Math.min(...lanes),
    to: Math.max(...lanes),
  };
}

/**
 * The start and end of every Clip but those being dragged, if any, on
 * every Track, as targets, each with the lane it's in, counted from the
 * top.
 */
export function clipTargets(tracks: Tracks, dragged: ReadonlySet<number> = new Set()): Target<number>[] {
  return tracks.flatMap((track, lane) =>
    track.clips
      .filter((c) => !dragged.has(c.id))
      .flatMap((c) => [
        { at: c.start, of: lane },
        { at: c.start + c.length, of: lane },
      ]),
  );
}

/**
 * Everything a moved or trimmed Clip, or the Selection moved, snaps to:
 * the start and end of every Clip not being dragged, the playhead, and
 * the Loop's start and end, on or off, if there is one.
 */
export function editTargets(
  tracks: Tracks,
  dragged: ReadonlySet<number>,
  playhead: number,
  loop: { start: number; end: number } | null,
): Target<Aligned>[] {
  const loopEdges: Target<Aligned>[] = loop
    ? [
        { at: loop.start, of: 'loop' },
        { at: loop.end, of: 'loop' },
      ]
    : [];
  return [...clipTargets(tracks, dragged), { at: playhead, of: 'playhead' }, ...loopEdges];
}

/**
 * Everything the Loop snaps to, as it's marked or an edge of it dragged:
 * every Clip's start and end, on every Track, and the playhead.
 */
export function loopTargets(tracks: Tracks, playhead: number): Target<Aligned>[] {
  return [...clipTargets(tracks), { at: playhead, of: 'playhead' }];
}
