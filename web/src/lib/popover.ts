/**
 * The top of a popover `height` px tall, `gap` px from the field or button it
 * opens from: under it, or over it when there's no room below, but never off
 * the top of the window.
 */
export function popoverTop(
  anchor: { top: number; bottom: number },
  height: number,
  viewportHeight: number,
  gap: number,
): number {
  if (anchor.bottom + gap + height <= viewportHeight) return anchor.bottom + gap;
  return Math.max(gap, anchor.top - gap - height);
}
