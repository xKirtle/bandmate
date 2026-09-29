import { untrack } from 'svelte';
import { dropFor, dropTarget, type Box, type Drop, type Dragged, type Target } from './sectionDrag';

// On desktop in Write mode, a Section is dragged by the grip on its header:
// within the Arrangement, from it to the Scrapbook or onto another Section in
// it, or from the Scrapbook back into it or onto a Section in it. Pointer
// events rather than HTML5 drag and drop, so the drop shows between Sections
// and Esc cancels. One drag is shared by the Lyric Sheet and the Scrapbook,
// as a drag goes from one to the other.
export class SectionDragging {
  /** The drag under way: what's dragged, where it would drop, and where the pointer is. */
  current = $state<{ dragged: Dragged; target: Target | null; x: number; y: number } | null>(null);
  /** What letting go now would do, if anything. */
  readonly drop: Drop | null = $derived(this.current && dropFor(this.current.dragged, this.current.target));
  /** Whether Sections can be dragged at all. */
  readonly on: boolean = $derived.by(() => this.#enabled());
  /** The place in the Arrangement of the Lyric Sheet Section being dragged, if one is. */
  readonly arrangementAt: number | null = $derived.by(() => {
    const dragged = this.current?.dragged;
    return dragged && 'arrangementAt' in dragged ? dragged.arrangementAt : null;
  });
  /** The id of the Scrapbook Section being dragged, if one is. */
  readonly section: number | null = $derived.by(() => {
    const dragged = this.current?.dragged;
    return dragged && 'section' in dragged ? dragged.section : null;
  });

  #enabled: () => boolean;
  #order: string = $derived.by(() => this.#orderOf());
  #orderOf: () => string;
  // Each Lyric Sheet Section's place on the page, by its place in the Arrangement.
  #sections = new Map<number, HTMLElement>();
  #arrangement: HTMLElement | null = null;
  #scrapbook: HTMLElement | null = null;

  /**
   * `enabled` says whether Sections can be dragged; it turning false
   * mid-drag, e.g. the window narrowing or Read mode coming on, cancels the
   * drag, as the pointer's release would never reach the grip. So does
   * `order` changing: it names the order of the Arrangement and the
   * Scrapbook, whose changing mid-drag, e.g. from another tab, would move
   * what's being dragged. Other changes to the Song leave the drag be.
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

  /** Attaches a Lyric Sheet Section's place on the page, at `index` in the Arrangement. */
  placeSection(el: HTMLElement, index: number) {
    this.#sections.set(index, el);
    return () => {
      if (this.#sections.get(index) === el) this.#sections.delete(index);
    };
  }

  /** Attaches the Arrangement's place on the page: its column is where a Section drops into it. */
  placeArrangement = (el: HTMLElement) => {
    this.#arrangement = el;
    return () => {
      if (this.#arrangement === el) this.#arrangement = null;
    };
  };

  /** Attaches the Scrapbook's place on the page, where a Lyric Sheet Section can be dropped. */
  placeScrapbook = (el: HTMLElement) => {
    this.#scrapbook = el;
    return () => {
      if (this.#scrapbook === el) this.#scrapbook = null;
    };
  };

  /** Aims the drag at where the pointer is, e.g. again as the page scrolls under it. */
  aim(x: number, y: number) {
    if (this.current) this.current = { ...this.current, target: this.#targetAt(this.current.dragged, x, y), x, y };
  }

  #targetAt(dragged: Dragged, x: number, y: number): Target | null {
    const arrangement = this.#arrangement?.getBoundingClientRect();
    if (!arrangement) return null;
    // A Section not on the page has its gaps counted above the pointer.
    const count = Math.max(-1, ...this.#sections.keys()) + 1;
    const spans = Array.from({ length: count }, (_, i) => {
      const box = this.#sections.get(i)?.getBoundingClientRect();
      return box ? { top: box.top, bottom: box.bottom } : { top: -Infinity, bottom: -Infinity };
    });
    // A Section drops onto any Section in the Arrangement but itself: over
    // itself, it's still in the gaps either side.
    const canDropOnto = (at: number) => 'section' in dragged || at !== dragged.arrangementAt;
    return dropTarget({ x, y }, this.#scrapbookBox(), arrangement, spans, canDropOnto);
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
        this.current = { dragged, target: this.#targetAt(dragged, e.clientX, e.clientY), x: e.clientX, y: e.clientY };
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
