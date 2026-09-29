import { untrack } from 'svelte';
import { dropFor, dropTarget, type Box, type Drop, type Dragged, type Target } from './sectionDrag';

// On desktop in Write mode, a Section is dragged by the grip on its header:
// within the Arrangement, from it to the Scrapbook, or from the Scrapbook
// back into it. Pointer events rather than HTML5 drag and drop, so the drop
// shows between Sections and Esc cancels. One drag is shared by the Lyric
// Sheet and the Scrapbook, as a drag goes from one to the other.
export class SectionDrag {
  /** The drag under way: what's dragged, where it would drop, and where the pointer is. */
  current = $state<{ dragged: Dragged; target: Target; x: number; y: number } | null>(null);
  /** What letting go now would do, if anything. */
  readonly drop: Drop | null = $derived(this.current && dropFor(this.current.dragged, this.current.target));
  /** Whether Sections can be dragged at all. */
  readonly on: boolean = $derived.by(() => this.#enabled());

  #enabled: () => boolean;
  // Each Occurrence's place on the page, by its place in the Arrangement.
  #occurrences = new Map<number, HTMLElement>();
  #scrapbook: HTMLElement | null = null;

  /**
   * `enabled` says whether Sections can be dragged; it turning false
   * mid-drag, e.g. the window narrowing or Read mode coming on, cancels the
   * drag, as the pointer's release would never reach the grip. So does
   * `layout` changing: it names the Arrangement and Scrapbook, whose changing
   * mid-drag, e.g. from another tab, would move what's being dragged.
   */
  constructor(enabled: () => boolean, layout: () => unknown) {
    this.#enabled = enabled;
    $effect(() => {
      if (!this.on) untrack(() => this.cancel());
    });
    $effect(() => {
      void layout();
      untrack(() => this.cancel());
    });
  }

  cancel() {
    this.current = null;
  }

  /** Attaches an Occurrence's place on the page, at `index` in the Arrangement. */
  placeOccurrence(el: HTMLElement, index: number) {
    this.#occurrences.set(index, el);
    return () => {
      if (this.#occurrences.get(index) === el) this.#occurrences.delete(index);
    };
  }

  /** Attaches the Scrapbook's place on the page, where an Occurrence can be dropped. */
  placeScrapbook = (el: HTMLElement) => {
    this.#scrapbook = el;
    return () => {
      if (this.#scrapbook === el) this.#scrapbook = null;
    };
  };

  /** Aims the drag at where the pointer is, e.g. again as the page scrolls under it. */
  aim(x: number, y: number) {
    if (this.current) this.current = { ...this.current, target: this.#targetAt(x, y), x, y };
  }

  #targetAt(x: number, y: number): Target {
    const middles: number[] = [];
    for (let i = 0, el; (el = this.#occurrences.get(i)); i++) {
      const box = el.getBoundingClientRect();
      middles.push(box.top + box.height / 2);
    }
    return dropTarget({ x, y }, this.#scrapbookBox(), middles);
  }

  // Only the part of the Scrapbook in view in its column can be dropped on.
  #scrapbookBox(): Box | null {
    const box = this.#scrapbook?.getBoundingClientRect();
    if (!box) return null;
    const column = this.#scrapbook?.parentElement?.getBoundingClientRect() ?? box;
    return {
      left: Math.max(box.left, column.left),
      right: Math.min(box.right, column.right),
      top: Math.max(box.top, column.top),
      bottom: Math.min(box.bottom, column.bottom),
    };
  }

  /**
   * The pointer handlers for a grip dragging `dragged`, dropping by
   * `onDrop` what letting go does.
   */
  grip(dragged: Dragged, onDrop: (drop: Drop) => void) {
    return {
      onpointerdown: (e: PointerEvent & { currentTarget: HTMLElement }) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        this.current = { dragged, target: this.#targetAt(e.clientX, e.clientY), x: e.clientX, y: e.clientY };
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
