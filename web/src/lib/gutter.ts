/**
 * Which of the rows, top to bottom, a height on the page is in, e.g. to
 * find the Line under the pointer; null if it's in none. It serves pointer
 * hovering, not the gutter's own state, which is the Cue gutter's (see
 * cueGutter.svelte.ts).
 */
export function rowAt(rows: readonly { top: number; bottom: number }[], y: number): number | null {
  const i = rows.findIndex((r) => y >= r.top && y < r.bottom);
  return i === -1 ? null : i;
}
