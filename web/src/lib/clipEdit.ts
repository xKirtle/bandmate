// Where a Clip being dragged or trimmed may go: never over another Clip on
// its Track, never before 0:00, and never beyond its source. Plain
// arithmetic, so the Timeline only has to follow it. The server enforces
// the same rules and rejects anything else.

import type { Clip, ClipMove } from './api';
import { activeTake } from './clipSource';
import type { Placed } from './schedule';

/** The shortest a Clip can be trimmed to, in seconds. */
export const minClipLength = 0.25;

/**
 * Where a Clip of the given length can start nearest to where it's
 * dragged, among the other Clips on the Track it's over. Dragged into a
 * neighbour, it stops at the neighbour's edge, on whichever side is nearer.
 */
export function clampMove(others: readonly Placed[], length: number, desired: number): number {
  let best = Infinity;
  for (const [from, to] of gaps(others)) {
    if (to - from < length) continue;
    const start = Math.min(Math.max(desired, from), to - length);
    if (Math.abs(start - desired) < Math.abs(best - desired)) best = start;
  }
  return best;
}

/**
 * The Clip with its start edge dragged to desired: the audio stays where it
 * is on the Timeline, so the trim into its source moves with the edge. It
 * stops at the source's start, 0:00 and the Clip before it.
 */
export function clampTrimStart(clip: Placed, others: readonly Placed[], desired: number): Placed {
  const end = clip.start + clip.length;
  // Neighbours are told apart by where they start, so one touching the Clip
  // still counts when rounding leaves its end a hair past the Clip's start.
  const before = others.filter((c) => c.start < clip.start);
  const earliest = Math.max(0, clip.start - clip.offset, ...before.map(endOf));
  const start = Math.min(Math.max(desired, earliest), end - minClipLength);
  // Rounding could otherwise take the trim a hair before the source's start.
  return { start, offset: Math.max(0, clip.offset + (start - clip.start)), length: end - start };
}

/**
 * The Clip with its end edge dragged to desired. It stops at the end of
 * its source, sourceDuration seconds long, and at the Clip after it.
 */
export function clampTrimEnd(clip: Placed, others: readonly Placed[], sourceDuration: number, desired: number): Placed {
  const end = clip.start + clip.length;
  const latest = Math.min(
    clip.start + sourceDuration - clip.offset,
    ...others.filter((c) => c.start > clip.start).map((c) => c.start),
  );
  const newEnd = Math.max(Math.min(desired, latest), clip.start + minClipLength);
  return { start: clip.start, offset: clip.offset, length: newEnd - clip.start };
}

/** The Tracks of a Timeline, for the Clips on them and where they are. */
type Tracks = readonly { id: number; clips: readonly { id: number; start: number; length: number }[] }[];

/**
 * Where every selected Clip goes when the Clip clipId among them is
 * dragged to start at `start` over the Track trackId, in Timeline order.
 * They move by one amount, the nearest to the one wanted at which every
 * one of them is clear of the Clips outside the Selection and after 0:00,
 * so they keep their places relative to each other; selected Clips never
 * block each other. All on one Track, they go to the Track dragged over;
 * on several, each keeps its Track.
 */
export function moveGroup(
  tracks: Tracks,
  selected: ReadonlySet<number>,
  clipId: number,
  trackId: number,
  start: number,
): ClipMove[] {
  const members = tracks.flatMap((t) => t.clips.filter((c) => selected.has(c.id)).map((clip) => ({ clip, track: t })));
  const dragged = members.find((m) => m.clip.id === clipId)!;
  const oneTrack = members.every((m) => m.track === dragged.track);
  const to = (m: (typeof members)[number]) => (oneTrack ? tracks.find((t) => t.id === trackId)! : m.track);
  // The amounts each Clip can move by, narrowed down to those every one can.
  let allowed: Range[] = [[-Infinity, Infinity]];
  for (const m of members) {
    const others = to(m).clips.filter((c) => !selected.has(c.id));
    const { start: s, length } = m.clip;
    const fits = gaps(others)
      .filter(([from, end]) => end - from >= length)
      .map(([from, end]): Range => [from - s, end - length - s]);
    allowed = overlap(allowed, fits);
  }
  const by = nearest(allowed, start - dragged.clip.start);
  return members.map((m) => ({ clipId: m.clip.id, trackId: to(m).id, start: m.clip.start + by }));
}

/** A stretch of numbers, from the first to the second, both included. */
type Range = [number, number];

/** Where two sets of stretches, each in order and not overlapping, overlap. */
function overlap(a: readonly Range[], b: readonly Range[]): Range[] {
  const result: Range[] = [];
  for (const [aFrom, aTo] of a) {
    for (const [bFrom, bTo] of b) {
      const [from, to] = [Math.max(aFrom, bFrom), Math.min(aTo, bTo)];
      if (from <= to) result.push([from, to]);
    }
  }
  return result.sort((x, y) => x[0] - y[0]);
}

/** The number in the stretches nearest to the one wanted. */
function nearest(ranges: readonly Range[], wanted: number): number {
  let best = Infinity;
  for (const [from, to] of ranges) {
    const at = Math.min(Math.max(wanted, from), to);
    if (Math.abs(at - wanted) < Math.abs(best - wanted)) best = at;
  }
  return best;
}

function endOf(c: Span): number {
  return c.start + c.length;
}

/** Where a Clip is on its Track. */
type Span = Pick<Placed, 'start' | 'length'>;

/** The free stretches of a Track between its Clips, the last one endless. */
function gaps(clips: readonly Span[]): [number, number][] {
  const result: [number, number][] = [];
  let from = 0;
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    if (c.start > from) result.push([from, c.start]);
    from = Math.max(from, endOf(c));
  }
  result.push([from, Infinity]);
  return result;
}

/**
 * The nudge its active Take gets when a Clip of Takes is Alt+dragged by
 * seconds, from the nudge it has, in whole milliseconds.
 */
export function draggedNudge(clip: Clip, seconds: number): number {
  const take = activeTake(clip)!;
  return Math.round((take.nudge + seconds) * 1000) / 1000;
}

/**
 * A Clip of Takes with its active Take nudged, as it's shown while
 * dragged: only the Take moves, never the Clip's window. Nudged before the
 * Clip's span, it's shown there, where the server takes the span back
 * instead: the Take is heard in the same place either way.
 */
export function nudged(clip: Clip, nudge: number): Clip {
  return {
    ...clip,
    takes: clip.takes.map((t) =>
      t.id === clip.activeTakeId ? { ...t, position: t.position + nudge - t.nudge, nudge } : t,
    ),
  };
}
