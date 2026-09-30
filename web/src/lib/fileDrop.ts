// Dragging audio files from outside the page onto the Timeline, to import
// them as Sounds: whether a drag carries files, which Track they'd go to,
// and importing them in turn.

/** Whether a drag, by its data's types, carries files, e.g. from a file manager. */
export function carriesFiles(types: readonly string[]): boolean {
  return types.includes('Files');
}

/** How far down the page something reaches, from its top to its bottom, in pixels. */
export type Extent = { top: number; bottom: number };

/** A Track's row, across its header and lane, as it is down the page. */
export type TrackRow = Extent & { trackId: number };

/**
 * The Track files dropped `y` down the page go to, or null where a drop
 * does nothing. Over a Track's row, that Track; below the last one, the
 * Chosen Track. `area` is the Tracks area as shown, and `rows` the Tracks'
 * rows in order, which may be scrolled out of it.
 */
export function fileDropTrack(y: number, area: Extent, rows: TrackRow[], chosen: number): number | null {
  // Tracks scrolled out of view aren't where the files are.
  if (y < area.top) return null;
  if (y >= area.bottom) return chosen;
  const row = rows.find((r) => y >= r.top && y < r.bottom);
  if (row) return row.trackId;
  const last = rows.at(-1);
  return last && y >= last.bottom ? chosen : null;
}

/**
 * Imports each file dropped, one after another in the order dropped, each
 * on its own, so one refused doesn't stop the rest: what refusing it said
 * is told as it happens.
 */
export async function importEach<F>(
  files: F[],
  importOne: (file: F) => Promise<void>,
  refused: (message: string) => void,
): Promise<void> {
  for (const file of files) {
    try {
      await importOne(file);
    } catch (e) {
      refused((e as Error).message);
    }
  }
}
