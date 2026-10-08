import { laneStep, pressLane, type LaneInput, type LanePress } from './lanePress';
import type { PointerAt } from './pointerFollow';
import type { Selection, SelectionBox } from './selection.svelte';

// Drawing a box over empty lane space, from press to release: the Clips
// it touches on the Tracks it spans become the Selection as it's drawn,
// or, with Mod held as it's pressed, are added to it. A press let go
// without moving past the slop is a click there instead, an insertion
// point: it clears the Selection, and asks for the playhead to move to
// exactly where it was pressed, unsnapped, and for that Track to be
// chosen. With Mod held, that was likely the start of a box to add, so it
// leaves the Selection, the playhead and the Chosen Track be.
//
// A finger dragging pans the lanes instead: a tap does what a click does,
// and it draws a box only once held still for a long press, and that box
// always replaces the Selection; let go without dragging, it only clears
// the Selection. A box given up, e.g. for a second finger pinching, puts
// the Selection back as it was at the press. While the Timeline is
// frozen, the Selection is left as it is, a finger's long press draws no
// box, and a click asks for nothing.
//
// It works in seconds and Tracks: the Timeline measures the page, listens
// to the pointer, scrolls at the edges, keeps the long-press timer, and
// moves the playhead and chooses the Track a click asks for.

/** Where the pointer is, for a box: its point, the time under it, the Track under it and how far down the lanes it is. */
export interface BoxAt extends PointerAt {
  /** The index of the Track whose lane is nearest. */
  track: number;
  /** How far down the lanes it is, in pixels. */
  y: number;
}

/** The Timeline a box is drawn over. */
export interface BoxContext {
  /** The Timeline's Selection, which the box draws on. */
  selection: Selection;
  /** Whether the Timeline is frozen, by a recording or a Merge. */
  frozen: () => boolean;
}

/** The box shown as it's drawn: from `start` to `end` in seconds across the lanes, and from `top` to `bottom` in pixels down them, either way round. */
export interface BoxShown {
  start: number;
  end: number;
  top: number;
  bottom: number;
}

/** What a click on empty lane space asks for: the playhead moved to a time, and the Track at an index chosen. */
export interface BoxClick {
  time: number;
  track: number;
}

interface Press {
  /** The press, telling a click, a box and a pan apart. */
  lane: LanePress;
  /** Where it was pressed: the box's start and top. */
  from: BoxAt;
  /** The box's hold on the Selection, which it replaces or adds to as it was pressed. */
  box: SelectionBox;
}

/** A box drawn over empty lane space on a Timeline, from press to release. */
export class BoxDrag {
  #press: Press | null = null;
  #box = $state<BoxShown | null>(null);
  #context: BoxContext;

  constructor(context: BoxContext) {
    this.#context = context;
  }

  /** Whether empty lane space is pressed, or a box drawn. */
  get pressed(): boolean {
    return this.#press !== null;
  }

  /** Whether a finger is pressing, rather than a mouse or pen. */
  get touch(): boolean {
    return this.#press?.lane.touch ?? false;
  }

  /** The box shown, once the press has moved past the slop or a finger's been held; until then, none. */
  get box(): BoxShown | null {
    return this.#box;
  }

  /** Presses empty lane space, by a finger or else a mouse or pen, with Mod held or not. */
  press(at: BoxAt, touch: boolean, mod: boolean) {
    const lane = pressLane(at.point, touch, mod);
    this.#press = { lane, from: at, box: this.#context.selection.startBox(lane.adds) };
    this.#box = null;
  }

  /**
   * Moves to where the pointer is. Says whether a box is drawn there, to
   * scroll along near the edges. A finger moving before it's held pans
   * instead, ending the press.
   */
  move(at: BoxAt): boolean {
    return this.#step({ kind: 'move', at: at.point }, at) === 'box';
  }

  /**
   * A finger held still for the long press: it draws a box from under it.
   * Says whether it does; frozen, it gives the press up instead.
   */
  hold(): boolean {
    const press = this.#press;
    if (!press) return false;
    if (this.#context.frozen()) {
      this.#done();
      return false;
    }
    return this.#step({ kind: 'hold' }, press.from) === 'box';
  }

  /** Lets go, ending the press. Gives back what a click asks for, or null, e.g. for a box drawn, or while frozen. */
  release(): BoxClick | null {
    const press = this.#press;
    if (!press) return null;
    const outcome = this.#step({ kind: 'lift' }, press.from);
    if (outcome !== 'insertionPoint' || this.#context.frozen()) return null;
    return { time: press.from.time, track: press.from.track };
  }

  /** Gives the press up, e.g. for a second finger pinching: a box drawn puts the Selection back as it was. */
  cancel() {
    if (this.#press) this.#step({ kind: 'cancel' }, this.#press.from);
  }

  /** Steps the press on, drawing the box to `at` or ending the press as it says. */
  #step(input: LaneInput, at: BoxAt) {
    const press = this.#press;
    if (!press) return null;
    const { press: lane, outcome } = laneStep(press.lane, input);
    if (lane) press.lane = lane;
    const { selection } = this.#context;
    switch (outcome) {
      case 'wait':
        return outcome;
      case 'box': {
        const { time: start, track, y: top } = press.from;
        this.#box = { start, end: at.time, top, bottom: at.y };
        press.box.draw({ start, end: at.time, tracks: [track, at.track] });
        return outcome;
      }
      case 'insertionPoint':
        selection.apply({ kind: 'emptyClick', adds: false });
        break;
      case 'click':
        selection.apply({ kind: 'emptyClick', adds: press.lane.adds });
        break;
      case 'restore':
        press.box.restore();
        break;
      case 'keep':
      case 'giveUp':
        break;
    }
    this.#done();
    return outcome;
  }

  #done() {
    this.#press = null;
    this.#box = null;
  }
}
