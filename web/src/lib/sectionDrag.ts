// Dragging a Section to a new place in the Arrangement, or between the
// Arrangement and the Scrapbook: from where the pointer is to what it would
// drop into, to what the drop does. A move within the Arrangement saves the
// same order pressing ↑ or ↓ that many times gives, as those presses would.

/** What's being dragged: an Occurrence, by its place in the Arrangement, or a Scrapbook Section, by its id. */
export type Dragged = { occurrenceAt: number } | { section: number };

/** Where a drag would drop: a gap in the Arrangement, or the Scrapbook. */
export type Target = { gap: number } | { scrapbook: true };

/**
 * What a drop does, with the gap it shows in if it lands in the Arrangement:
 * an Occurrence moved within it or to the Scrapbook, or a Scrapbook Section
 * put back into it.
 */
export type Drop =
  { reorder: { from: number; to: number }; gap: number } | { toScrapbook: number } | { putBack: number; gap: number };

/** A box on the page, as getBoundingClientRect gives it. */
export type Box = { left: number; right: number; top: number; bottom: number };

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

/**
 * Where a drag would drop with the pointer at `pointer`: the Scrapbook while
 * it's over it, else the gap in the Arrangement it's at while it's in the
 * Arrangement's column, above or below it too; null anywhere else.
 * `scrapbook` is null without one to drop on.
 */
export function dropTarget(
  pointer: { x: number; y: number },
  scrapbook: Box | null,
  arrangement: Box,
  middles: number[],
): Target | null {
  const { x, y } = pointer;
  if (scrapbook && x >= scrapbook.left && x <= scrapbook.right && y >= scrapbook.top && y <= scrapbook.bottom) {
    return { scrapbook: true };
  }
  if (x < arrangement.left || x > arrangement.right) return null;
  return { gap: dropGap(y, middles) };
}

/** What dropping `dragged` on `target` does; null if nothing. */
export function dropFor(dragged: Dragged, target: Target | null): Drop | null {
  if (!target) return null;
  if ('scrapbook' in target) return 'occurrenceAt' in dragged ? { toScrapbook: dragged.occurrenceAt } : null;
  const { gap } = target;
  if ('section' in dragged) return { putBack: dragged.section, gap };
  const from = dragged.occurrenceAt;
  const to = targetIndex(from, gap);
  return to === from ? null : { reorder: { from, to }, gap };
}
