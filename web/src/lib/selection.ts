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
  /** A press on a Clip became a drag to move it. */
  | { kind: 'drag'; clipId: number }
  /**
   * A box was drawn over empty lane space, from `start` to `end` seconds,
   * over the Tracks from index `tracks[0]` to `tracks[1]`, either way
   * round, as drawn from any corner. With Mod held, it `adds`.
   */
  | { kind: 'box'; start: number; end: number; tracks: readonly [number, number]; adds: boolean }
  /** Every Clip was asked for, with Mod+A. */
  | { kind: 'all' }
  /**
   * Empty lane space was clicked, a press not moving far enough to draw a
   * box. With Mod held, it was likely the start of a box that `adds`.
   */
  | { kind: 'emptyClick'; adds: boolean }
  /** Esc was pressed. */
  | { kind: 'clear' };

/** The Tracks of a Timeline, for the Clips on them and where they are. */
type Tracks = readonly { clips: readonly { id: number; start: number; length: number }[] }[];

/** The Clips a box touches: any part of them, in time, on a Track it spans. A Clip it only meets edge to edge it doesn't. */
function boxed(tracks: Tracks, box: Extract<SelectionGesture, { kind: 'box' }>): number[] {
  const [from, to] = [Math.min(box.start, box.end), Math.max(box.start, box.end)];
  const [first, last] = [Math.min(...box.tracks), Math.max(...box.tracks)];
  return tracks
    .slice(first, last + 1)
    .flatMap((t) => t.clips.filter((c) => c.start < to && c.start + c.length > from).map((c) => c.id));
}

/**
 * The Selection after a gesture, given the Timeline's Tracks. A plain
 * click selects that Clip alone, and a Mod+click adds it or takes it out.
 * Dragging a selected Clip keeps the Selection, so it all moves; dragging
 * another selects it alone. A box selects the Clips it touches, or adds
 * them with Mod, select-all selects every Clip, and clearing, or clicking
 * empty lane space without Mod, selects none. Clips no longer on the Timeline, e.g. deleted in
 * another tab or taken away by undo, drop out; without a gesture, or on a
 * Mod+click on empty lane space, that's all that happens, and `selected`
 * itself is given back if none did. While `locked`, e.g. while recording,
 * that's all that happens whatever the gesture.
 */
export function selection(tracks: Tracks, selected: Selection, gesture?: SelectionGesture, locked = false): Selection {
  const present = new Set(tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const kept = [...selected].filter((id) => present.has(id));
  const pruned = kept.length === selected.size ? selected : new Set(kept);
  if (locked || !gesture || ('clipId' in gesture && !present.has(gesture.clipId))) return pruned;
  switch (gesture.kind) {
    case 'click':
      return new Set([gesture.clipId]);
    case 'drag':
      return pruned.has(gesture.clipId) ? pruned : new Set([gesture.clipId]);
    case 'toggle':
      return selected.has(gesture.clipId)
        ? new Set(kept.filter((id) => id !== gesture.clipId))
        : new Set([...kept, gesture.clipId]);
    case 'box':
      return new Set([...(gesture.adds ? kept : []), ...boxed(tracks, gesture)]);
    case 'all':
      return present;
    case 'emptyClick':
      return gesture.adds ? pruned : noSelection;
    case 'clear':
      return noSelection;
  }
}

/** Which menu a Clip's menu gesture opens, and what the Selection becomes. */
export type MenuOpening = {
  /** The Selection menu, acting on every selected Clip, or the Clip's own menu. */
  menu: 'selection' | 'clip';
  selected: Selection;
};

/**
 * The menu a Clip's menu gesture opens, by right-click, its ⋯, a long
 * press or the Menu key, and the Selection after it. On a Clip in a
 * Selection of several, it's the Selection menu; on a Clip outside it,
 * that Clip becomes the Selection, and its own menu opens, as it does on
 * the only selected Clip. While `locked`, e.g. while recording, the
 * Selection is left as it is, so a Clip outside it opens its own menu
 * without becoming it.
 */
export function menuFor(tracks: Tracks, selected: Selection, clipId: number, locked = false): MenuOpening {
  // The Selection becomes what dragging the Clip would make it: kept, if
  // the Clip is in it, else that Clip alone.
  const after = selection(tracks, selected, { kind: 'drag', clipId }, locked);
  return { menu: after.size > 1 && after.has(clipId) ? 'selection' : 'clip', selected: after };
}
