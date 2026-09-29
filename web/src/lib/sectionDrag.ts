// Dragging a Section to a new place in the Arrangement, or between the
// Arrangement and the Scrapbook, or onto another Section to add its
// Alternates to it; or an inactive Alternate out of its Section, into the
// Arrangement or the Scrapbook as a Section of its own: from where the
// pointer is to what it would drop into, to what the drop does. A move
// within the Arrangement saves the same order pressing ↑ or ↓ that many
// times gives, as those presses would.

/**
 * What's being dragged: a Lyric Sheet Section, by its place in the
 * Arrangement, a Scrapbook Section, by its id, or an inactive Alternate, by
 * its id.
 */
export type Dragged = DraggedSection | { alternate: number };

/** A Section being dragged, from the Lyric Sheet or the Scrapbook. */
export type DraggedSection = { arrangementAt: number } | { section: number };

/**
 * Where a drag would drop: a gap in the Arrangement, onto the Section at a
 * place in it, or the Scrapbook.
 */
export type Target = { gap: number } | { onto: number } | { scrapbook: true };

/**
 * What a drop does, with the gap it shows in if it lands in the Arrangement:
 * a Section moved within it or to the Scrapbook, a Scrapbook Section put
 * back into it, a Section, from either, added to the Section at a place
 * in it, or an Alternate, by its id, moved out of its Section into it or the
 * Scrapbook.
 */
export type Drop =
  | { reorder: { from: number; to: number }; gap: number }
  | { toScrapbook: number }
  | { putBack: number; gap: number }
  | { addTo: { dragged: DraggedSection; arrangementAt: number } }
  | { alternateToArrangement: number; gap: number }
  | { alternateToScrapbook: number };

/** A box on the page, as getBoundingClientRect gives it. */
export type Box = { left: number; right: number; top: number; bottom: number };

/** Where something runs down the page, as getBoundingClientRect gives it. */
export type Span = { top: number; bottom: number };

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
 * `scrapbook` is null without one to drop on. `sections` are where each
 * Section in it runs down the page. The middle half of a Section that
 * `canDropOnto` allows, by its place, drops onto it instead, leaving a
 * quarter at its top and bottom for the gaps either side.
 */
export function dropTarget(
  pointer: { x: number; y: number },
  scrapbook: Box | null,
  arrangement: Box,
  sections: Span[],
  canDropOnto: (at: number) => boolean = () => false,
): Target | null {
  const { x, y } = pointer;
  if (scrapbook && x >= scrapbook.left && x <= scrapbook.right && y >= scrapbook.top && y <= scrapbook.bottom) {
    return { scrapbook: true };
  }
  if (x < arrangement.left || x > arrangement.right) return null;
  const at = sections.findIndex(({ top, bottom }) => {
    const quarter = (bottom - top) / 4;
    return y > top + quarter && y < bottom - quarter;
  });
  if (at !== -1 && canDropOnto(at)) return { onto: at };
  return { gap: dropGap(y, sections.map(({ top, bottom }) => (top + bottom) / 2)) };
}

/** What dropping `dragged` on `target` does; null if nothing. */
export function dropFor(dragged: Dragged, target: Target | null): Drop | null {
  if (!target) return null;
  if ('alternate' in dragged) {
    if ('scrapbook' in target) return { alternateToScrapbook: dragged.alternate };
    return 'gap' in target ? { alternateToArrangement: dragged.alternate, gap: target.gap } : null;
  }
  if ('scrapbook' in target) return 'arrangementAt' in dragged ? { toScrapbook: dragged.arrangementAt } : null;
  if ('onto' in target) {
    const onItself = 'arrangementAt' in dragged && dragged.arrangementAt === target.onto;
    return onItself ? null : { addTo: { dragged, arrangementAt: target.onto } };
  }
  const { gap } = target;
  if ('section' in dragged) return { putBack: dragged.section, gap };
  const from = dragged.arrangementAt;
  const to = targetIndex(from, gap);
  return to === from ? null : { reorder: { from, to }, gap };
}

/** Whether a drop lands on the Scrapbook, of a Section or an Alternate. */
export function dropsOnScrapbook(drop: Drop | null): boolean {
  return drop !== null && ('toScrapbook' in drop || 'alternateToScrapbook' in drop);
}
