import { formatCue } from './cues';

/** A Line's Cue field in the gutter, as far as Enter in another goes on to it. */
export interface GutterField {
  edit: () => void;
}

/**
 * Keeps the gutter's Cue fields by key, so Enter in one can go on to the
 * next down the Lyric Sheet. A Line without a field just now, e.g. while
 * typing that isn't saved has moved it, is skipped.
 */
export function gutterFields() {
  const fields = new Map<string, GutterField>();
  return {
    /** Hands over the field under a key, or null once it's gone. */
    set(key: string, field: GutterField | null | undefined) {
      if (field) fields.set(key, field);
      else fields.delete(key);
    },
    /** Opens the first field after a key, of the keys in order down the page; answers whether there was one. */
    editAfter(order: readonly string[], key: string): boolean {
      const next = order
        .slice(order.indexOf(key) + 1)
        .map((k) => fields.get(k))
        .find((f) => f !== undefined);
      next?.edit();
      return !!next;
    },
  };
}

/** Names a Cue's ▶ for screen readers, e.g. "Play from Line 3 of Verse 1 at 0:38.5". */
export function playLabel(label: string, cue: number): string {
  return `Play from ${label} at ${formatCue(cue)}`;
}
