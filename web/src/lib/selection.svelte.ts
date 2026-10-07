import { untrack } from 'svelte';
import type { Freeze } from './freeze';

// The Selection: the Clips the next Clip action applies to, none, one or
// several, on any Tracks. It isn't an edit, and it's never kept: it lives
// in the page while the Song is open, so leaving the Song drops it.

/** The ids of some Clips, e.g. those selected. */
export type ClipIds = ReadonlySet<number>;

/** No Clip. */
export const noClips: ClipIds = new Set();

/**
 * Where a box is drawn over empty lane space: from `start` to `end`
 * seconds, over the Tracks from index `tracks[0]` to `tracks[1]`, either
 * way round, as drawn from any corner.
 */
export type BoxSpan = { start: number; end: number; tracks: readonly [number, number] };

/** Something done to the Clips that changes which are selected. */
export type SelectionGesture =
  /** A Clip was clicked, with no Mod held. */
  | { kind: 'click'; clipId: number }
  /** A Clip was clicked with Mod (Ctrl, or ⌘ on a Mac) held. */
  | { kind: 'toggle'; clipId: number }
  /** A press on a Clip became a drag to move it. */
  | { kind: 'drag'; clipId: number }
  /** A box was drawn over empty lane space. With Mod held, it `adds`. */
  | ({ kind: 'box'; adds: boolean } & BoxSpan)
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
 * empty lane space without Mod, selects none. Clips no longer on the
 * Timeline, e.g. deleted in another tab or taken away by undo, drop out;
 * without a gesture, or on a Mod+click on empty lane space, that's all
 * that happens, and `selected` itself is given back if none did.
 *
 * The seam inside the Selection, which applies it unless frozen.
 */
export function afterGesture(tracks: Tracks, selected: ClipIds, gesture?: SelectionGesture): ClipIds {
  const present = new Set(tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const kept = [...selected].filter((id) => present.has(id));
  const pruned = kept.length === selected.size ? selected : new Set(kept);
  if (!gesture || ('clipId' in gesture && !present.has(gesture.clipId))) return pruned;
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
      return gesture.adds ? pruned : noClips;
    case 'clear':
      return noClips;
  }
}

/** A box being drawn over empty lane space, selecting the Clips it touches. */
export interface SelectionBox {
  /** Draws it over this span, selecting the Clips it touches. */
  draw(span: BoxSpan): void;
  /** Gives it up, e.g. for a second finger, selecting what was selected before it. */
  restore(): void;
}

/** Which menu a Clip's menu gesture opens: the Selection menu, acting on every selected Clip, or the Clip's own. */
export type ClipMenu = 'selection' | 'clip';

function menuOf(selected: ClipIds, clipId: number): ClipMenu {
  return selected.size > 1 && selected.has(clipId) ? 'selection' : 'clip';
}

/**
 * A Timeline's Selection, and the only way it changes. A phone, where
 * Clips can't be edited, has none.
 *
 * While the Timeline is frozen, by a recording or a Merge, a
 * user's gesture leaves it as it is (see freeze.ts).
 */
export class Selection {
  #ids = $state.raw<ClipIds>(noClips);
  #tracks: () => Tracks;
  #freeze: () => Freeze;

  /**
   * Over the Timeline's Tracks, frozen while `freeze` says. Clips gone
   * from the Tracks, e.g. deleted in another tab or taken away by undo,
   * drop out of it, frozen or not.
   */
  constructor(tracks: () => Tracks, freeze: () => Freeze) {
    this.#tracks = tracks;
    this.#freeze = freeze;
    $effect(() => {
      const present = tracks();
      untrack(() => (this.#ids = afterGesture(present, this.#ids)));
    });
  }

  /** The ids of the Clips selected. */
  get ids(): ClipIds {
    return this.#ids;
  }

  /** How many Clips are selected. */
  get size(): number {
    return this.#ids.size;
  }

  /** Whether a Clip is selected. */
  has(clipId: number): boolean {
    return this.#ids.has(clipId);
  }

  /** Applies a user's gesture, unless frozen. */
  apply(gesture: SelectionGesture) {
    if (this.#freeze()) return;
    this.#ids = afterGesture(this.#tracks(), this.#ids, gesture);
  }

  /**
   * Starts a box over empty lane space, which replaces the Selection as it
   * is now, or with Mod held as it's pressed, `adds` to it. Frozen, the
   * box leaves the Selection as it is.
   */
  startBox(adds: boolean): SelectionBox {
    const before = this.#ids;
    return {
      draw: (span) => {
        if (this.#freeze()) return;
        this.#ids = afterGesture(this.#tracks(), before, { kind: 'box', adds, ...span });
      },
      restore: () => {
        this.#ids = afterGesture(this.#tracks(), before);
      },
    };
  }

  /**
   * The menu a Clip's menu gesture would open, by right-click, its ⋯, a
   * long press or the Menu key, as `openMenu` would, changing nothing.
   */
  menuFor(clipId: number): ClipMenu {
    return menuOf(this.#afterMenu(clipId), clipId);
  }

  /**
   * Opens a Clip's menu: on a Clip in a Selection of several, it's the
   * Selection menu; on a Clip outside it, that Clip becomes the Selection,
   * unless frozen, and its own menu opens, as it does on the only
   * selected Clip. Frozen, a Clip outside it opens its own menu without
   * becoming it.
   */
  openMenu(clipId: number): ClipMenu {
    this.#ids = this.#afterMenu(clipId);
    return menuOf(this.#ids, clipId);
  }

  /** The Selection after opening a Clip's menu: what dragging the Clip would make it, unless frozen. */
  #afterMenu(clipId: number): ClipIds {
    const tracks = this.#tracks();
    return this.#freeze() ? afterGesture(tracks, this.#ids) : afterGesture(tracks, this.#ids, { kind: 'drag', clipId });
  }

  /**
   * Selects the Clips an edit made or brought back, e.g. pasted,
   * duplicated, split, merged, undone or redone, once it's saved. Unless
   * a recording has started since: a Merge, frozen until it's saved,
   * still selects its merged Clip.
   */
  selectEdited(clipIds: Iterable<number>) {
    if (this.#freeze() === 'recording') return;
    this.#ids = new Set(clipIds);
  }
}
