import { GripDragging, offPage, type At, type Span } from './gripDragging.svelte';
import { dropFor as sectionDrop, dropTarget, type Box, type Dragged, type Drop, type Target } from './sectionDrag';

// On desktop in Write mode, a Section is dragged by the grip on its header:
// within the Arrangement, from it to the Scrapbook or onto another Section in
// it, or from the Scrapbook back into it or onto a Section in it; and an
// inactive Alternate by the grip on its card, out of its Section into either
// as a Section of its own. Pointer events rather than HTML5 drag and drop,
// so the drop shows between Sections and Esc cancels. One drag is shared by
// the Lyric Sheet and the Scrapbook, as a drag goes from one to the other.
// The drag itself is gripDragging's, with the Sections' rule for where it
// aims and what dropping there does handed to it: a Section's place in the
// Arrangement is a row, and the Arrangement's and the Scrapbook's own
// columns are measured here beside them.
export class SectionDragging extends GripDragging<Dragged, Target, Drop> {
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

  /** The id of the Alternate being dragged, if one is. */
  readonly alternate: number | null = $derived.by(() => {
    const dragged = this.current?.dragged;
    return dragged && 'alternate' in dragged ? dragged.alternate : null;
  });

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
    super({ enabled, order });
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

  protected targetAt(dragged: Dragged, at: At, rows: readonly (Span | null)[]): Target | null {
    const arrangement = this.#arrangement?.getBoundingClientRect();
    if (!arrangement) return null;
    // A Section not on the page has its gaps counted above the pointer.
    const spans = rows.map((row) => row ?? offPage);
    // A Section drops onto any Section in the Arrangement but itself: over
    // itself, it's still in the gaps either side. An Alternate only drops
    // between Sections, to be one of its own.
    const canDropOnto = (at: number) =>
      'section' in dragged || ('arrangementAt' in dragged && at !== dragged.arrangementAt);
    return dropTarget(at, this.#scrapbookBox(), arrangement, spans, canDropOnto);
  }

  protected dropFor(dragged: Dragged, target: Target | null): Drop | null {
    return sectionDrop(dragged, target);
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
}
