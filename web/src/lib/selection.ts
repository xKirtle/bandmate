// The Selection: the Clips the next Clip action applies to, none, one or
// several, on any Tracks. It isn't an edit, and it's never kept: it lives
// in the page while the Song is open, so leaving the Song drops it.

/** The ids of the Clips selected. */
export type Selection = ReadonlySet<number>;

/** No Clip selected. */
export const noSelection: Selection = new Set();

/** Something done to the Clips that changes which are selected. */
export type SelectionGesture =
  /** A Clip was clicked, with no Mod held. */
  | { kind: 'click'; clipId: number }
  /** A Clip was clicked with Mod (Ctrl, or ⌘ on a Mac) held. */
  | { kind: 'toggle'; clipId: number }
  /** Empty lane space was clicked, or Esc pressed. */
  | { kind: 'clear' };

/** The Tracks of a Timeline, for the Clips on them. */
type Tracks = readonly { clips: readonly { id: number }[] }[];

/**
 * The Selection after a gesture, given the Timeline's Tracks: a plain
 * click selects that Clip alone, a Mod+click adds it or takes it out, and
 * clearing selects none. Clips no longer on the Timeline, e.g. deleted in
 * another tab or taken away by undo, drop out; without a gesture that's
 * all that happens, and `selected` itself is given back if none did.
 */
export function selection(tracks: Tracks, selected: Selection, gesture?: SelectionGesture): Selection {
  const present = new Set(tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const kept = [...selected].filter((id) => present.has(id));
  if (!gesture || (gesture.kind !== 'clear' && !present.has(gesture.clipId))) {
    return kept.length === selected.size ? selected : new Set(kept);
  }
  switch (gesture.kind) {
    case 'click':
      return new Set([gesture.clipId]);
    case 'toggle':
      return selected.has(gesture.clipId)
        ? new Set(kept.filter((id) => id !== gesture.clipId))
        : new Set([...kept, gesture.clipId]);
    case 'clear':
      return noSelection;
  }
}
