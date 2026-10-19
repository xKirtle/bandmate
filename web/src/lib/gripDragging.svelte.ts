// Dragging a row by a grip: the state kept while one is under way, shared by
// every such drag. Three things are dragged this way — a Track on the
// Timeline, a Section in the Lyric Sheet or the Scrapbook, and a Song on the
// Songs page — and each kept the same state machine of its own. It's kept
// here once, with each one's own rule for where a drag aims and what letting
// go there does handed in by a subclass:
//
// - The drag under way: what's dragged, where it aims, and where the pointer
//   is. Null with none.
// - Whether what this drags can be dragged at all, which turning false
//   mid-drag, e.g. the window narrowing or a recording starting, gives the
//   drag up: the pointer's release would never reach the grip.
// - The order of the rows, whose changing mid-drag, e.g. by an undo or from
//   another tab, gives the drag up too: it would move what's being dragged.
// - The rows' elements as they come and go, and their places down the page
//   measured from them, a row that isn't on the page measuring as none.
// - The pointer handlers for a grip: the drag follows the pointer it
//   captures, a release drops what it aims at, if anything, and a cancelled
//   pointer gives it up.
//
// The pure rules stay in the modules beside this one: trackDrag.ts,
// sectionDrag.ts and songDrag.ts. The Songs page drags a Song by its row
// rather than a grip, telling a drag from a click or a tap first, so it
// keeps that of its own and uses the state kept here.
import { untrack } from 'svelte';

/** Where a row runs down the page, as getBoundingClientRect gives it. */
export type Span = { top: number; bottom: number };

/**
 * A row that isn't on the page, for a rule that wants a span for every row:
 * above any pointer, so the gaps either side of it are counted above it.
 */
export const offPage: Span = { top: -Infinity, bottom: -Infinity };

/** Where the pointer is on the page, in the units the rows are measured in. */
export type At = { x: number; y: number };

export interface GripDraggingOptions {
  /** Whether what this drags can be dragged at all. */
  enabled: () => boolean;
  /**
   * The order of the rows, as a string that changes when it does; by
   * default nothing moves them under a drag.
   */
  order?: () => string;
}

/**
 * A drag by a grip, with a subclass's rule for where it aims and what
 * dropping there does: `Dragged` is what's dragged, `Target` where it aims
 * and `Drop` what letting go does.
 */
export abstract class GripDragging<Dragged, Target, Drop> {
  /** The drag under way: what's dragged, where it aims, and where the pointer is. */
  current = $state<{ dragged: Dragged; target: Target | null; x: number; y: number } | null>(null);
  /** What letting go now would do, if anything. */
  readonly drop: Drop | null = $derived(this.current && this.dropFor(this.current.dragged, this.current.target));
  /** Whether what this drags can be dragged at all. */
  readonly on: boolean = $derived.by(() => this.#options.enabled());

  #options: GripDraggingOptions;
  #order: string = $derived.by(() => this.#options.order?.() ?? '');
  // Each row's element on the page, by its place among the rows.
  #rows = new Map<number, HTMLElement>();

  constructor(options: GripDraggingOptions) {
    this.#options = options;
    $effect(() => {
      if (!this.on) untrack(() => this.cancel());
    });
    // Nothing to watch where nothing moves the rows under a drag.
    if (options.order)
      $effect(() => {
        void this.#order;
        untrack(() => this.cancel());
      });
    // Nor does a drag outlive what it was dragged on.
    $effect(() => () => this.cancel());
  }

  /**
   * Where a drag of `dragged` aims with the pointer at `at`: null nowhere.
   * `rows` are where each row runs down the page, by its place among them,
   * null for one that isn't on the page.
   */
  protected abstract targetAt(dragged: Dragged, at: At, rows: readonly (Span | null)[]): Target | null;

  /** What dropping `dragged` where it aims does; null if nothing. */
  protected abstract dropFor(dragged: Dragged, target: Target | null): Drop | null;

  /** Gives up the drag under way, if there is one. */
  cancel() {
    this.current = null;
  }

  /** Attaches a row's element, at `index` among the rows, until it goes again. */
  placeRow(el: HTMLElement, index: number) {
    this.#rows.set(index, el);
    return () => {
      // Only this element: another row's may have taken its place meanwhile.
      if (this.#rows.get(index) === el) this.#rows.delete(index);
    };
  }

  /**
   * Aims the drag at where the pointer is, or, given neither, again at where
   * it last was, e.g. as the rows scroll under it. Does nothing without a
   * drag under way.
   */
  aim(x = this.current?.x, y = this.current?.y) {
    if (!this.current || x === undefined || y === undefined) return;
    this.current = { ...this.current, target: this.#aimedAt(this.current.dragged, x, y), x, y };
  }

  #aimedAt(dragged: Dragged, x: number, y: number): Target | null {
    return this.targetAt(dragged, { x, y }, this.#spans());
  }

  // Where each row runs down the page, by its place among them, up to the
  // last one attached: a row that isn't on the page measures as none.
  #spans(): (Span | null)[] {
    const count = Math.max(-1, ...this.#rows.keys()) + 1;
    return Array.from({ length: count }, (_, i) => {
      const box = this.#rows.get(i)?.getBoundingClientRect();
      return box ? { top: box.top, bottom: box.bottom } : null;
    });
  }

  /** The pointer handlers for the grip that drags `dragged`, dropping it by `onDrop`. */
  grip(dragged: Dragged, onDrop: (drop: Drop) => void) {
    return {
      onpointerdown: (e: PointerEvent & { currentTarget: HTMLElement }) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        this.current = { dragged, target: this.#aimedAt(dragged, e.clientX, e.clientY), x: e.clientX, y: e.clientY };
      },
      onpointermove: (e: PointerEvent) => this.aim(e.clientX, e.clientY),
      onpointerup: () => {
        const drop = this.drop;
        this.cancel();
        if (drop) onDrop(drop);
      },
      onpointercancel: () => this.cancel(),
    };
  }
}

/**
 * The row nearest a height on the page, by its place among `rows`: the one
 * the height is within, else whichever is nearest above or below it, the
 * first of two equally near. Null with no row on the page.
 */
export function nearestRow(y: number, rows: readonly (Span | null)[]): number | null {
  let nearest: number | null = null;
  let distance = Infinity;
  rows.forEach((row, index) => {
    if (!row) return;
    const away = y < row.top ? row.top - y : y > row.bottom ? y - row.bottom : 0;
    if (away < distance) [nearest, distance] = [index, away];
  });
  return nearest;
}
