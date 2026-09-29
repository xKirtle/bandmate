import { dropGap, moveTo, targetIndex } from './sectionDrag';

// Dragging a Track by the grip on its header to a new place among the
// Tracks: from where the pointer is to where it would drop, to the order
// that saves, the same one pressing ↑ or ↓ that many times gives.

/** A Track moved from one place to another, and the gap between Tracks the drop shows in. */
export type TrackDrop = { from: number; to: number; gap: number };

/**
 * Where the Track at `from` would drop, with the pointer at `y`; null in
 * the gaps either side of it, which leave it where it is. `middles` are
 * where the middle of each Track's header is, down the page, in the same
 * units as `y`.
 */
export function trackDrop(from: number, y: number, middles: number[]): TrackDrop | null {
  const gap = dropGap(y, middles);
  const to = targetIndex(from, gap);
  return to === from ? null : { from, to, gap };
}

/** The order of the Tracks, by their ids in `order`, once `drop` is made. */
export function tracksDropped(order: number[], drop: TrackDrop): number[] {
  return moveTo(order, drop.from, drop.to);
}
