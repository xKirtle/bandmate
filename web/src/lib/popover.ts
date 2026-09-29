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

/**
 * Places `list`, a popover in the top layer, `gap` px under `anchor`, or over
 * it when there's no room below: at least as wide as it, and inside the window.
 */
export function placeUnder(list: HTMLElement, anchor: HTMLElement, gap: number) {
  const at = anchor.getBoundingClientRect();
  list.style.minWidth = `${at.width}px`;
  const { width, height } = list.getBoundingClientRect();
  // On a phone, what the on-screen keyboard leaves visible.
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  list.style.top = `${popoverTop(at, height, viewportHeight, gap)}px`;
  const room = document.documentElement.clientWidth - gap;
  list.style.left = `${Math.max(gap, Math.min(at.left, room - width))}px`;
}
