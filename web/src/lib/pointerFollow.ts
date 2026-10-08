import type { Point } from './press';
import { isModifier, skipsSnapping } from './timelineKeys';

// Following the pointer for a drag on the Timeline, from its press until
// it's let go or given up: each move goes to the drag, measured, and once
// it's a drag the lanes scroll along near their edges, replaying where the
// pointer is as they go. A drag with a modifier, e.g. the Shift that skips
// snapping, also hears it pressed or let go mid-drag, where the pointer
// last was. The Timeline's Clip drag and Loop drag both go through it.

/** A drag the Timeline follows the pointer for, in what it measures of the pointer, e.g. a PointerAt. */
export interface Followed<At> {
  /** Measures where the pointer is, for the drag. */
  at: (point: Point) => At;
  /**
   * Drags to where the pointer is, with Shift held or not, where that's
   * known: replayed as the lanes scroll along, it isn't. Says whether to
   * scroll along near the edges.
   */
  move: (at: At, free?: boolean) => boolean;
  /** A modifier pressed or let go mid-drag, where the pointer last was. Left out, keys aren't listened to. */
  modifier?: (free: boolean, at: At) => void;
  /** The pointer let go, once it's no longer followed. */
  up: () => void;
  /** The pointer given up, e.g. by the browser, once it's no longer followed. */
  cancel: () => void;
}

/** The Timeline's scrolling along near the edges of its lanes. */
export interface EdgeScroll {
  /** Notes where the pointer is, scrolling along if it's near an edge, and calling `move` again as it does. */
  along: (at: Point, move: (at: Point) => void) => void;
  /** Stops scrolling along. */
  done: () => void;
}

/** Follows the pointer for one drag, from each press until it's let go or given up. */
export class PointerFollow<At> {
  #drag: Followed<At>;
  #scroll: EdgeScroll;
  /** Where the pointer last moved to, for a modifier mid-drag. */
  #last: Point | null = null;

  constructor(drag: Followed<At>, scroll: EdgeScroll) {
    this.#drag = drag;
    this.#scroll = scroll;
  }

  /** Starts following the pointer, as the drag is pressed. */
  start() {
    this.#last = null;
    window.addEventListener('pointermove', this.#move);
    window.addEventListener('pointerup', this.#up);
    window.addEventListener('pointercancel', this.#cancel);
    if (!this.#drag.modifier) return;
    window.addEventListener('keydown', this.#key);
    window.addEventListener('keyup', this.#key);
  }

  /** Stops following the pointer, e.g. for the drag given up some other way. */
  stop() {
    this.#scroll.done();
    window.removeEventListener('pointermove', this.#move);
    window.removeEventListener('pointerup', this.#up);
    window.removeEventListener('pointercancel', this.#cancel);
    window.removeEventListener('keydown', this.#key);
    window.removeEventListener('keyup', this.#key);
  }

  #move = (point: Point) => {
    // Scrolling along at an edge moves it too, with no keys to go by.
    const free = 'shiftKey' in point ? skipsSnapping(point as PointerEvent) : undefined;
    this.#last = { clientX: point.clientX, clientY: point.clientY };
    if (this.#drag.move(this.#drag.at(point), free)) this.#scroll.along(point, this.#move);
  };

  #up = () => {
    this.stop();
    this.#drag.up();
  };

  #cancel = () => {
    this.stop();
    this.#drag.cancel();
  };

  #key = (event: KeyboardEvent) => {
    if (!isModifier(event.key) || !this.#last) return;
    this.#drag.modifier?.(skipsSnapping(event), this.#drag.at(this.#last));
  };
}
