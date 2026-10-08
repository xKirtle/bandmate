// Telling a pointer's press apart: a click, a long press or a drag.

/** Where a pointer is on the page. */
export type Point = Pick<PointerEvent, 'clientX' | 'clientY'>;

/** Where the pointer is for a drag on the Timeline, as the Timeline measures it. */
export interface PointerAt {
  /** Where it is, to tell a click from a drag. */
  point: Point;
  /** The time under it across the lanes, in seconds, which may be before 0:00 or past the Timeline shown. */
  time: number;
}

/** How long a finger held still takes to count as a long press, in ms. */
export const longPressDelay = 500;

// How far a pointer can wobble, in px either way, before it's moving rather
// than clicking or holding still.
const slop = 4;

/** Whether a pointer that went down at `from` has moved past the slop by `to`. */
export function pastSlop(from: Point, to: Point): boolean {
  return Math.abs(to.clientX - from.clientX) > slop || Math.abs(to.clientY - from.clientY) > slop;
}
