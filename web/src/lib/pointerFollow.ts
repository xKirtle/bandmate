import type { Point } from './press';
import { isModifier, skipsSnapping } from './timelineKeys';

// Following the pointer for a drag on the Timeline, from its press until
// it's let go or given up. Each move goes to the drag, measured as the
// drag needs it. Once the press is a drag, the lanes scroll along near
// their edges, and the drag is moved again to where the pointer is as they
// go. A drag with a modifier, e.g. the Shift that skips snapping, also
// hears it pressed or let go mid-drag, where the pointer last was. The
// Clip drag, the Loop drag and the box drawn over empty lane space all go
// through it, each with its own.

/** Where the pointer is for a drag on the Timeline, as the Timeline measures it. */
export interface PointerAt {
  /** Where it is, to tell a click from a drag. */
  point: Point;
  /** The time under it across the lanes, in seconds, which may be before 0:00 or past the Timeline shown. */
  time: number;
}

/** A drag the Timeline follows the pointer for. `At` is where the drag needs the pointer, e.g. a PointerAt. */
export interface FollowedDrag<At> {
  /** Measures where the pointer is, for the drag. */
  at: (point: Point) => At;
  /**
   * Drags to where the pointer is, with Shift held or not, where that's
   * known: moved again as the lanes scroll along, it isn't. Says whether
   * to scroll along near the edges.
   */
  move: (at: At, free?: boolean) => boolean;
  /** A modifier pressed or let go mid-drag, where the pointer last was. A drag without one hears no keys. */
  modifier?: (free: boolean, at: At) => void;
  /** The pointer let go, after it stops being followed. */
  up: (event: PointerEvent) => void;
  /** The pointer given up, e.g. by the browser, after it stops being followed. */
  cancel: (event: PointerEvent) => void;
}

/** The Timeline's scrolling along near the edges of its lanes, as the pointer drags. */
export interface EdgeScroll {
  /** Notes where the pointer is, scrolling along while it's near an edge, and calling `move` with it each time it does. */
  along: (at: Point, move: (at: Point) => void) => void;
  /** Stops scrolling along. */
  done: () => void;
}

/** Follows the pointer for a drag, from each press until it's let go or given up. */
export class PointerFollow<At> {
  #drag: FollowedDrag<At>;
  #scroll: EdgeScroll;
  /** Where the pointer last moved to, for a modifier mid-drag. */
  #last: Point | null = null;
  /** The pointer followed, where only one is, e.g. not a second finger; undefined, any. */
  #pointerId: number | undefined;

  constructor(drag: FollowedDrag<At>, scroll: EdgeScroll) {
    this.#drag = drag;
    this.#scroll = scroll;
  }

  /**
   * Starts following the pointer, once the drag is pressed: only the one
   * with `pointerId`, where given, e.g. not a second finger, or else any.
   */
  start(pointerId?: number) {
    this.#last = null;
    this.#pointerId = pointerId;
    window.addEventListener('pointermove', this.#move);
    window.addEventListener('pointerup', this.#up);
    window.addEventListener('pointercancel', this.#cancel);
    if (!this.#drag.modifier) return;
    window.addEventListener('keydown', this.#modifierKey);
    window.addEventListener('keyup', this.#modifierKey);
  }

  /** Stops following the pointer, e.g. when the drag is given up for a pinch. */
  stop() {
    this.#scroll.done();
    window.removeEventListener('pointermove', this.#move);
    window.removeEventListener('pointerup', this.#up);
    window.removeEventListener('pointercancel', this.#cancel);
    window.removeEventListener('keydown', this.#modifierKey);
    window.removeEventListener('keyup', this.#modifierKey);
  }

  /**
   * Takes the pointer as moved to a point, e.g. where a finger is held
   * still once its long press draws a box, so the lanes scroll along from
   * there.
   */
  moveTo(point: Point) {
    this.#move(point);
  }

  /** Whether an event is from another pointer than the one followed. */
  #notFollowed(point: Point): boolean {
    return this.#pointerId !== undefined && 'pointerId' in point && point.pointerId !== this.#pointerId;
  }

  #move = (point: Point) => {
    if (this.#notFollowed(point)) return;
    // Scrolling along at an edge moves it too, with no keys to go by.
    const free = 'shiftKey' in point ? skipsSnapping(point as PointerEvent) : undefined;
    this.#last = { clientX: point.clientX, clientY: point.clientY };
    if (this.#drag.move(this.#drag.at(point), free)) this.#scroll.along(point, this.#move);
  };

  #up = (event: PointerEvent) => {
    if (this.#notFollowed(event)) return;
    this.stop();
    this.#drag.up(event);
  };

  #cancel = (event: PointerEvent) => {
    if (this.#notFollowed(event)) return;
    this.stop();
    this.#drag.cancel(event);
  };

  #modifierKey = (event: KeyboardEvent) => {
    if (!isModifier(event.key) || !this.#last) return;
    this.#drag.modifier?.(skipsSnapping(event), this.#drag.at(this.#last));
  };
}
