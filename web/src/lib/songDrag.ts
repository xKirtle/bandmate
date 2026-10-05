// Dragging a Song from the Songs page into a Folder, or out of one: telling
// a press on its row apart, a click or tap that opens it from a drag that
// files it.
import { pastSlop, type Point } from './press';

/** A press on a Song's row, from where it went down. */
export interface SongPress {
  from: Point;
  /**
   * `pressed`: a mouse or pen, not yet moved past the slop.
   * `holding`: a finger, held still for the long press.
   * `dragging`: dragging the Song.
   */
  phase: 'pressed' | 'holding' | 'dragging';
}

/** Something the pointer pressing did. */
export type SongInput =
  /** It moved to `at`. */
  | { kind: 'move'; at: Point }
  /** A finger was held still for the long press. */
  | { kind: 'hold' }
  /** It lifted. */
  | { kind: 'lift' }
  /** It was cancelled, e.g. by the browser. */
  | { kind: 'cancel' };

/**
 * What to do after an input: `wait` for more; `drag` the Song to where the
 * pointer is; `drop` it where it's aimed; or `giveUp`, leaving the press to
 * the browser, as a click or tap that opens the Song, or a swipe that
 * scrolls.
 */
export type SongOutcome = 'wait' | 'drag' | 'drop' | 'giveUp';

/** A press on a Song's row, by a finger or else a mouse or pen. */
export function pressSong(from: Point, touch: boolean): SongPress {
  return { from: { clientX: from.clientX, clientY: from.clientY }, phase: touch ? 'holding' : 'pressed' };
}

/** The press after an input, or null once it's over, and what to do. */
export function songStep(press: SongPress, input: SongInput): { press: SongPress | null; outcome: SongOutcome } {
  switch (input.kind) {
    case 'move':
      if (press.phase === 'dragging') return { press, outcome: 'drag' };
      // A small wobble while clicking or holding still isn't a drag.
      if (!pastSlop(press.from, input.at)) return { press, outcome: 'wait' };
      // A finger moving before the hold scrolls the list instead.
      if (press.phase === 'holding') return { press: null, outcome: 'giveUp' };
      return { press: { ...press, phase: 'dragging' }, outcome: 'drag' };
    case 'hold':
      if (press.phase !== 'holding') return { press, outcome: 'wait' };
      return { press: { ...press, phase: 'dragging' }, outcome: 'drag' };
    case 'lift':
      return { press: null, outcome: press.phase === 'dragging' ? 'drop' : 'giveUp' };
    case 'cancel':
      return { press: null, outcome: 'giveUp' };
  }
}

/** Where a Song can drop: into a Folder, or, on the "Songs" link inside one, out to none. */
export type SongTarget = { folder: number | null };

/**
 * Where a Song in the Folder `from` (null for none) moves, dropped on
 * `target`: null if that changes nothing, as on the Folder it's already
 * in, or anywhere that isn't a target.
 */
export function songDrop(from: number | null, target: SongTarget | null): SongTarget | null {
  return target && target.folder !== from ? target : null;
}

// How near an edge of the list in view, in px, a drag starts scrolling it.
const edgeZone = 48;

/**
 * How fast to scroll the list while dragging at `y` down the window, in
 * pixels a second, negative to go up, with the list in view from `top` to
 * `bottom`: still until the last edgeZone pixels before either edge, then
 * faster the nearer it gets, up to the height in view a second at the edge.
 * Still past either edge, over the header or the tab bar, where a drop
 * aims at them rather than the list.
 */
export function listEdgeSpeed(y: number, top: number, bottom: number): number {
  if (y < top || y > bottom) return 0;
  const height = bottom - top;
  if (y < top + edgeZone) return (-(top + edgeZone - y) / edgeZone) * height;
  if (y > bottom - edgeZone) return ((y - (bottom - edgeZone)) / edgeZone) * height;
  return 0;
}
