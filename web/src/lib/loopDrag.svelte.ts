import type { TimelineLoop } from './api';
import type { Edit } from './history';
import { pastSlop, type Point } from './press';
import { loopMark, loopTargets, snapLoop, type Aligned, type LoopGrip, type Snap, type Tracks } from './snapping';

// Setting the Loop by dragging along the top of the ruler, from press to
// release: dragging there marks a new one, switched on, and dragging its
// start or end moves only that edge, the other staying put. Marked or
// moved, it snaps to Clips' edges and the playhead, unless Shift is held:
// a new one both where it's pressed and where it's dragged to. A click, a
// Loop shorter than the shortest, or one let go as it was, sets nothing.
// It's set on release: Timeline editing shows it where it was dropped
// until it's saved (see timelineEditing.svelte.ts), so a new one can be
// dragged straight away.
//
// It works in seconds: the Timeline measures the page, listens to the
// pointer and the keys, scrolls at the edges and saves.

/** Where the pointer is, as the Timeline measures it. */
export interface LoopAt {
  /** On the page, to tell a click from a drag. */
  point: Point;
  /** The time under it, in seconds, which may be before 0:00 or past the Timeline shown. */
  time: number;
}

/** The Timeline a Loop drag goes over. */
export interface LoopContext {
  /** The Tracks, whose Clips' edges the Loop snaps to. */
  tracks: () => Tracks;
  /** Where the playhead is, in seconds, to snap to. */
  playhead: () => number;
  /** The Loop as shown, if there is one: its edges are what's dragged, and let go as it was, nothing's set. */
  loop: () => TimelineLoop | null;
  /** How near a target an edge snaps to it, in seconds, at the zoom shown. */
  reach: () => number;
  /** How long the Timeline shown runs, in seconds, which the Loop is kept within. */
  span: () => number;
}

/** The edit a release saves. */
export type LoopSave = Extract<Edit, { kind: 'setLoop' }>;

// The shortest Loop set, in seconds, so a stray click doesn't set one. The
// server only needs its start before its end.
const shortest = 0.25;

interface Drag {
  grip: LoopGrip;
  /** The time the Loop is marked from: where a new one was pressed, before snapping, or its edge that isn't dragged. */
  anchor: number;
  /** Where the pointer went down, to tell a click from a drag. */
  from: Point;
  moved: boolean;
  /** The Loop as dragged. */
  loop: TimelineLoop;
  /** Whether Shift is held, to set the Loop without snapping. */
  free: boolean;
  /** What the edge dragged is snapped to, with the lanes of what's there, while it is. */
  snap: Snap<Aligned> | null;
}

/** A Loop drag on a Timeline, from press to release. */
export class LoopDrag {
  #drag = $state<Drag | null>(null);
  #context: LoopContext;

  constructor(context: LoopContext) {
    this.#context = context;
  }

  /** Whether the Loop, or the top of the ruler, is pressed or dragged. */
  get pressed(): boolean {
    return this.#drag !== null;
  }

  /** The Loop shown where it's dragged to, once the press is a drag; until then, none. */
  get loop(): TimelineLoop | null {
    return this.#drag?.moved ? this.#drag.loop : null;
  }

  /** What the edge dragged is snapped to, while it is, for the guide. */
  get snap(): Snap<Aligned> | null {
    return this.#drag?.snap ?? null;
  }

  /**
   * Presses the top of the ruler, to mark a new Loop, or the Loop's start
   * or end, to move that edge, at a point, with Shift held or not. An edge
   * pressed with no Loop shown marks a new one.
   */
  press(grip: LoopGrip, at: LoopAt, free: boolean) {
    const current = this.#context.loop();
    const from = { clientX: at.point.clientX, clientY: at.point.clientY };
    const common = { from, moved: false, free, snap: null };
    if (grip !== 'new' && current) {
      this.#drag = { ...common, grip, anchor: grip === 'start' ? current.end : current.start, loop: current };
      return;
    }
    const t = this.#within(at.time);
    this.#drag = { ...common, grip: 'new', anchor: t, loop: { start: t, end: t, on: true } };
  }

  /**
   * Drags to where the pointer is, with Shift held or not, where that's
   * known: replayed as the lanes scroll along, it isn't. Says whether the
   * press is a drag now, having moved past the slop.
   */
  move(at: LoopAt, free?: boolean): boolean {
    const drag = this.#drag;
    if (!drag) return false;
    // A small wobble while clicking isn't a drag.
    if (!drag.moved && !pastSlop(drag.from, at.point)) return false;
    drag.moved = true;
    if (free !== undefined) drag.free = free;
    this.#place(drag, at);
    return true;
  }

  /**
   * A modifier pressed or let go mid-drag, e.g. Shift: it snaps or frees
   * the Loop there and then, where the pointer is, without waiting for it
   * to move.
   */
  modifier(free: boolean, at: LoopAt) {
    const drag = this.#drag;
    if (!drag?.moved) return;
    drag.free = free;
    this.#place(drag, at);
  }

  #place(drag: Drag, at: LoopAt) {
    const { tracks, playhead, reach } = this.#context;
    const targets = drag.free ? [] : loopTargets(tracks(), playhead());
    // Where a new one was pressed snaps too, so both its ends can go onto something.
    const from = drag.grip === 'new' ? loopMark(targets, drag.anchor, reach()) : drag.anchor;
    const placed = snapLoop(targets, drag.grip, from, this.#within(at.time), reach(), shortest);
    drag.loop = { ...drag.loop, start: placed.start, end: placed.end };
    drag.snap = placed.snap;
  }

  /**
   * Lets go, ending the drag. Gives back the edit to save, or null for a
   * click, a Loop shorter than the shortest, or one let go as it was.
   */
  release(): LoopSave | null {
    const drag = this.#drag;
    this.#drag = null;
    if (!drag?.moved) return null;
    const to = drag.loop;
    const current = this.#context.loop();
    const unchanged = current && to.start === current.start && to.end === current.end && to.on === current.on;
    if (unchanged || to.end - to.start < shortest) return null;
    return { kind: 'setLoop', loop: to };
  }

  /** Gives the press or drag up, e.g. for a second finger pinching. */
  cancel() {
    this.#drag = null;
  }

  /** A time kept within the Timeline shown. */
  #within(time: number): number {
    return Math.max(0, Math.min(this.#context.span(), time));
  }
}
