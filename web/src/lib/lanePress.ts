// Telling a press on empty lane space apart: a click, a box drawn over
// the Clips to select, or, for a finger, the start of a pan. A plain click
// or tap there places the playhead and chooses the Track, as an insertion
// point; a Mod+click, likely the start of a box to add, or a finger held
// for a box and let go, doesn't.
import { pastSlop, type Point } from './press';

/** A press on empty lane space, from where it went down. */
export interface LanePress {
  from: Point;
  /** Whether a finger is pressing, rather than a mouse or pen. */
  touch: boolean;
  /** Whether Mod was held as it was pressed, so its box adds to the Selection. */
  adds: boolean;
  /**
   * `pressed`: a mouse or pen, not yet moved past the slop.
   * `holding`: a finger, held still for the long press.
   * `boxing`: drawing a box.
   */
  phase: 'pressed' | 'holding' | 'boxing';
  /**
   * Whether it's moved past the slop. A mouse or pen has by the time it
   * draws a box; a finger's box, drawn once held, let go before then is a
   * click.
   */
  dragged: boolean;
}

/** Something the pointer pressing did. */
export type LaneInput =
  /** It moved to `at`. */
  | { kind: 'move'; at: Point }
  /** A finger was held still for the long press. */
  | { kind: 'hold' }
  /** It lifted. */
  | { kind: 'lift' }
  /** It was cancelled, e.g. by the browser. */
  | { kind: 'cancel' };

/**
 * What to do after an input: `wait` for more; draw the `box` to where
 * the pointer is, selecting what it touches; or, the press over, `place`
 * the playhead where it was pressed and choose that Track, as a plain
 * click on empty lane space does, besides clearing the Selection; treat
 * it as only a `click` there, for the Selection; `keep` the box's
 * Selection; `restore` the Selection from before the press; or `giveUp`,
 * leaving the Selection be.
 */
export type LaneOutcome = 'wait' | 'box' | 'place' | 'click' | 'keep' | 'restore' | 'giveUp';

/** A press on empty lane space, by a finger or else a mouse or pen, with Mod held or not. */
export function pressLane(from: Point, touch: boolean, adds = false): LanePress {
  return {
    from: { clientX: from.clientX, clientY: from.clientY },
    touch,
    adds,
    phase: touch ? 'holding' : 'pressed',
    dragged: false,
  };
}

/** The press after an input, or null once it's over, and what to do. */
export function laneStep(press: LanePress, input: LaneInput): { press: LanePress | null; outcome: LaneOutcome } {
  const boxing = press.phase === 'boxing';
  switch (input.kind) {
    case 'move': {
      // A small wobble while clicking or holding still isn't a drag.
      const dragged = press.dragged || pastSlop(press.from, input.at);
      if (boxing) return { press: dragged === press.dragged ? press : { ...press, dragged }, outcome: 'box' };
      if (!dragged) return { press, outcome: 'wait' };
      // A finger moving before the hold pans the Timeline instead.
      if (press.phase === 'holding') return { press: null, outcome: 'giveUp' };
      return { press: { ...press, phase: 'boxing', dragged }, outcome: 'box' };
    }
    case 'hold':
      // The box appears under the finger, from where it was pressed.
      if (press.phase !== 'holding') return { press, outcome: 'wait' };
      return { press: { ...press, phase: 'boxing' }, outcome: 'box' };
    case 'lift':
      if (boxing) return { press: null, outcome: press.dragged ? 'keep' : 'click' };
      return { press: null, outcome: press.adds ? 'click' : 'place' };
    case 'cancel':
      return { press: null, outcome: boxing ? 'restore' : 'giveUp' };
  }
}
