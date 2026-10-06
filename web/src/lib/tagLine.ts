// How many of a Song's Tags fit on one line, as the Songs table shows them.

export type TagWidths = {
  /** Each Tag's badge, as wide as it's drawn, in order. */
  widths: readonly number[];
  /** The width of the line. */
  room: number;
  /** The space between two badges. */
  gap: number;
  /** The "+N" badge's width. */
  moreWidth: number;
};

/** How many Tags to show, from the first. */
export function fitTags({ widths, room, gap, moreWidth }: TagWidths): number {
  const all = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
  if (all <= room) return widths.length;
  // Each Tag shown takes its width and a gap before the next badge.
  let used = moreWidth;
  let shown = 0;
  while (used + widths[shown] + gap <= room) used += widths[shown++] + gap;
  // The first is shown anyway, cut short, so "+N" never stands alone.
  return Math.max(shown, 1);
}
