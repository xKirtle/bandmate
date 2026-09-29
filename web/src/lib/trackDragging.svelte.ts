import { untrack } from 'svelte';
import { trackDrop, type TrackDrop } from './trackDrag';

// On desktop, a Track is dragged by the grip along its header's left edge
// to a new place among the Tracks, its lane going with it. Pointer events
// rather than HTML5 drag and drop, like dragging Sections, so the drop
// shows between Tracks and Esc cancels.
export class TrackDragging {
  /** The drag under way: the place of the Track dragged, and where it would drop. */
  current = $state<{ from: number; drop: TrackDrop | null } | null>(null);
  /** Whether Tracks can be dragged at all. */
  readonly on: boolean = $derived.by(() => this.#enabled());

  #enabled: () => boolean;
  #order: string = $derived.by(() => this.#orderOf());
  #orderOf: () => string;
  // Each Track header's place on the page, by the Track's place.
  #heads = new Map<number, HTMLElement>();

  /**
   * `enabled` says whether Tracks can be dragged; it turning false
   * mid-drag, e.g. the window narrowing or a recording starting, cancels
   * the drag. So does `order`, naming the order of the Tracks, changing,
   * e.g. by an undo, which would move what's being dragged.
   */
  constructor(enabled: () => boolean, order: () => string) {
    this.#enabled = enabled;
    this.#orderOf = order;
    $effect(() => {
      if (!this.on) untrack(() => this.cancel());
    });
    $effect(() => {
      void this.#order;
      untrack(() => this.cancel());
    });
  }

  cancel() {
    this.current = null;
  }

  /** Attaches a Track header's place on the page, at `index` among the Tracks. */
  placeHead(el: HTMLElement, index: number) {
    this.#heads.set(index, el);
    return () => {
      if (this.#heads.get(index) === el) this.#heads.delete(index);
    };
  }

  #dropAt(from: number, y: number): TrackDrop | null {
    const count = Math.max(-1, ...this.#heads.keys()) + 1;
    const middles = Array.from({ length: count }, (_, i) => {
      const box = this.#heads.get(i)?.getBoundingClientRect();
      return box ? (box.top + box.bottom) / 2 : -Infinity;
    });
    return trackDrop(from, y, middles);
  }

  /** The pointer handlers for the grip of the Track at `index`, dropping it by `onDrop`. */
  grip(index: number, onDrop: (drop: TrackDrop) => void) {
    return {
      onpointerdown: (e: PointerEvent & { currentTarget: HTMLElement }) => {
        if (e.button !== 0 || !this.on) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        this.current = { from: index, drop: null };
      },
      onpointermove: (e: PointerEvent) => {
        if (this.current) this.current = { ...this.current, drop: this.#dropAt(this.current.from, e.clientY) };
      },
      onpointerup: () => {
        const drop = this.current?.drop;
        this.cancel();
        if (drop) onDrop(drop);
      },
      onpointercancel: () => this.cancel(),
    };
  }
}
