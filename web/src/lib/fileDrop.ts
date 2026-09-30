// Dragging audio files from outside the page onto the Timeline, to import
// them as Sounds: whether a drag carries files, and which Track they'd go to.

/** Whether a drag, by its data's types, carries files, e.g. from a file manager. */
export function carriesFiles(types: readonly string[]): boolean {
  return types.includes('Files');
}

/** Where something is down the page, in pixels. */
export type Span = { top: number; bottom: number };

/**
 * The Track files dropped `y` down the page go to, or null where a drop
 * does nothing. Over a Track's row, that Track; below the last one, the
 * Chosen Track. `area` is the Tracks area as shown, and `rows` each Track's
 * row, in the order of `tracks`, which may be scrolled out of the area.
 */
export function fileDropTrack(y: number, area: Span, rows: Span[], tracks: number[], chosen: number): number | null {
  // Tracks scrolled out of view aren't where the files are.
  if (y < area.top) return null;
  if (y >= area.bottom) return chosen;
  const row = rows.findIndex((r) => y >= r.top && y < r.bottom);
  if (row !== -1) return tracks[row];
  const last = rows.at(-1);
  return last && y >= last.bottom ? chosen : null;
}

/**
 * Imports each file dropped, one after another in the order dropped, each
 * on its own, so one refused doesn't stop the rest. Resolves to what each
 * refusal said, in order.
 */
export async function importEach<F>(files: F[], importOne: (file: F) => Promise<void>): Promise<string[]> {
  const refused: string[] = [];
  for (const file of files) {
    try {
      await importOne(file);
    } catch (e) {
      refused.push((e as Error).message);
    }
  }
  return refused;
}
