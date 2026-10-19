import { GripDragging, offPage, type At, type Span } from './gripDragging.svelte';
import { trackDrop, type TrackDrop } from './trackDrag';

// On desktop, a Track is dragged by the grip along its header's left edge
// to a new place among the Tracks, its lane going with it. Pointer events
// rather than HTML5 drag and drop, like dragging Sections, so the drop
// shows between Tracks and Esc cancels. The drag itself is gripDragging's,
// with the Tracks' rule for where it drops handed to it: a Track header's
// place among them is a row, and where it would drop is already what the
// drop does.
export class TrackDragging extends GripDragging<number, TrackDrop, TrackDrop> {
  /**
   * `enabled` says whether Tracks can be dragged; it turning false
   * mid-drag, e.g. the window narrowing or a recording starting, cancels
   * the drag. So does `order`, naming the order of the Tracks, changing,
   * e.g. by an undo, which would move what's being dragged.
   */
  constructor(enabled: () => boolean, order: () => string) {
    super({ enabled, order });
  }

  protected targetAt(from: number, at: At, rows: readonly (Span | null)[]): TrackDrop | null {
    return trackDrop(from, at.y, rows.map(middleOf));
  }

  protected dropFor(_from: number, drop: TrackDrop | null): TrackDrop | null {
    return drop;
  }
}

// Where the middle of a Track's header is, down the page; one not on the
// page counts above the pointer, as offPage says.
function middleOf(row: Span | null): number {
  const { top, bottom } = row ?? offPage;
  return (top + bottom) / 2;
}
