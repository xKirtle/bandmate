// Track placement: how the web app decides a Clip fits on a Track, as the
// server does, so what it sends isn't refused. A stretch of a Track is free
// when no other Clip on it overlaps it by more than the server's tolerance,
// so a Clip may touch its neighbours' edges. Paste and Duplicate, recovering
// an unsaved Take and Merge ask it; snapping, Split and Retake take only the
// tolerance, for their own rules. The move and trim clamps work it out
// exactly instead.

/**
 * How far apart, in seconds, two times can be and still be the same time,
 * as the server takes it: it absorbs rounding, e.g. a Clip placed right at
 * a neighbour's end.
 */
export const tolerance = 1e-6;

/** Where a Clip is on its Track, as far as fitting goes. */
export interface PlacedClip {
  id: number;
  start: number;
  length: number;
}

/** A stretch of a Track, from start to end, in seconds. */
export interface Span {
  start: number;
  end: number;
}

/**
 * The Clips, of a Track's clips, in the way of a span on it: those
 * overlapping it by more than the tolerance at both its edges, but for
 * those left out, e.g. the Clips being moved.
 */
export function inTheWay<C extends PlacedClip>(
  clips: readonly C[],
  span: Span,
  leaveOut: ReadonlySet<number> = new Set(),
): C[] {
  return clips.filter(
    (c) => !leaveOut.has(c.id) && c.start < span.end - tolerance && c.start + c.length > span.start + tolerance,
  );
}

/**
 * Whether a span of a Track holding clips is free of them, but for those
 * left out: touching a neighbour's edge is fine, as is overlapping it by
 * less than the tolerance.
 */
export function isFree(clips: readonly PlacedClip[], span: Span, leaveOut?: ReadonlySet<number>): boolean {
  return inTheWay(clips, span, leaveOut).length === 0;
}
