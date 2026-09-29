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
 * The left of a popover `width` px wide, lined up with the start or end of
 * the field or button it opens from, but kept `gap` px inside the window.
 */
export function popoverLeft(
  anchor: { left: number; right: number },
  width: number,
  viewportWidth: number,
  gap: number,
  align: 'start' | 'end',
): number {
  const left = align === 'start' ? anchor.left : anchor.right - width;
  return Math.max(gap, Math.min(left, viewportWidth - gap - width));
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
  list.style.left = `${popoverLeft(at, width, document.documentElement.clientWidth, gap, 'start')}px`;
}

/** Scrolls the highlighted option (aria-selected) into `list`'s view. */
export function revealSelected(list: HTMLElement) {
  const option = list.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!option) return;
  if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
  else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }
}
