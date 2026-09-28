// Dragging a Section to a new place in the Arrangement: from where the
// pointer is to the gap it would drop into, to the place the Section ends up
// at, to the new order. The order is the same one pressing ↑ or ↓ that many
// times gives, so a drop saves as those presses would.

/**
 * The gap a Section would drop into, with the pointer at `y`: 0 above the
 * first Section, `middles.length` below the last. `middles` are where the
 * middle of each Section is, down the page, in the same units as `y`.
 */
export function dropGap(y: number, middles: number[]): number {
  return middles.filter((m) => m < y).length;
}

/**
 * Where the Section at `from` ends up dropped into `gap`. The gaps just
 * above and below it both leave it where it is.
 */
export function targetIndex(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}

/** A copy of `order` with the item at `from` moved to `to`, the others keeping their order. */
export function moveTo<T>(order: T[], from: number, to: number): T[] {
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
