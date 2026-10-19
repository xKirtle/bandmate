/**
 * The Timeline's editing and mouse Shortcuts: what the Selection's and a
 * focused Clip's keys do, and when, the ruler's arrows, and the modifiers
 * held while dragging or turning the wheel. Which Shortcut a key press is
 * comes from shortcutPress.ts.
 */

import type { Freeze } from './freeze';
import { pressedInControl, pressedOnPage, type ShortcutPress } from './shortcutPress';
import { matches, type Key, type KeyPress, type Way } from './shortcuts';
import { rebound } from './shortcutKeys';

/** The modifiers held with a pointer or wheel event, or a key press. */
export type Modifiers = Omit<KeyPress, 'key'>;

/** A mouse action, `click`, `drag` or `wheel`, held with these modifiers, as a key press to match. */
function mouse(key: 'click' | 'drag' | 'wheel', e: Modifiers): KeyPress {
  // Picked one by one: an event's modifiers are on its prototype, which spreading it would miss.
  return { key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey };
}

/**
 * What a Timeline Shortcut does: clear the Selection, select every Clip,
 * delete the Selection or a focused Clip alone, copy or cut the Selection,
 * paste the Clipboard, or open a focused Clip's ⋯ menu.
 */
export type TimelineKey =
  'clearSelection' | 'selectAll' | 'deleteSelection' | 'deleteClip' | 'copy' | 'cut' | 'paste' | 'clipMenu';

/** What the Timeline is doing, which says whether a Shortcut can act now. */
export type TimelineKeyContext = {
  /** The Timeline can be edited, i.e. it isn't in Read mode or on a phone. */
  editable: boolean;
  /** Why the Timeline can't be edited now, if it can't. */
  freeze: Freeze;
  /** How many Clips are selected. */
  selected: number;
  /** The Clip the key was pressed on, if it has focus itself, and whether it's in the Selection. */
  focusedClip: { inSelection: boolean } | null;
  /** A Track is being dragged by its grip. */
  draggingTrack: boolean;
};

/**
 * Which Timeline Shortcut a key press is, if any, and if it should act
 * now: null leaves the key to the page.
 */
export function timelineKey(e: ShortcutPress, at: TimelineKeyContext): TimelineKey | null {
  // Not while a Track is dragged, which Esc then cancels.
  if (at.draggingTrack) return null;
  // Deleting, copying, cutting and pasting go with editing, so not on a
  // phone, nor while recording or merging.
  const edits = at.editable && at.freeze === null;
  const pressed = pressedOnPage(e);
  switch (pressed?.id) {
    case 'clipMenu':
      // Only a focused Clip has one, and it opens even while recording or
      // merging, with its edits off.
      return at.focusedClip && at.editable ? 'clipMenu' : null;
    case 'deleteClip':
      if (!edits) return null;
      // A focused Clip's Delete: the whole Selection if it's in it, else
      // that Clip alone. From anywhere else in the Timeline, the Selection.
      if (at.focusedClip) return at.focusedClip.inSelection ? 'deleteSelection' : 'deleteClip';
      return at.selected > 0 ? 'deleteSelection' : null;
    case 'clearSelection':
      return at.selected > 0 ? 'clearSelection' : null;
    case 'selectAll':
      return at.editable ? 'selectAll' : null;
    case 'pasteClips':
      return edits ? 'paste' : null;
    // Copying and cutting act on the Selection, even from a focused Clip
    // outside it.
    case 'copyClips':
      return edits && at.selected > 0 ? 'copy' : null;
    case 'cutClips':
      return edits && at.selected > 0 ? 'cut' : null;
    default:
      return null;
  }
}

/** Whether a box drawn over empty lane space with these modifiers adds the Clips it touches to the Selection, rather than replacing it. */
export function addsBox(e: Modifiers): boolean {
  return matches(mouse('drag', e), rebound().addBox.keys);
}

/** Whether a Clip clicked with these modifiers is added to the Selection or taken out, rather than selected alone. */
export function togglesSelection(e: Modifiers): boolean {
  return matches(mouse('click', e), rebound().toggleClip.keys);
}

/**
 * Where a key press on the ruler seeks to, from `position`, or null if it
 * doesn't: 5 s, or 15 s with Shift unless rebound. The ruler hears it in
 * its own handler, the arrows being its own keys. Home and End are
 * Song-wide, so `songKey` decides them.
 */
export function rulerSeek(e: ShortcutPress, position: number): number | null {
  const pressed = pressedInControl(e);
  const by = pressed?.id === 'seek' ? 5 : pressed?.id === 'seekFar' ? 15 : null;
  if (by === null || pressed?.way === null) return null;
  return position + (pressed?.way === 'back' ? -by : by);
}

/** The start of a Timeline `length` long, going back, or its end, going forward: where its keys and its buttons go. */
export function startOrEnd(going: Way, length: number): number {
  return going === 'back' ? 0 : length;
}

/** Whether a key is a modifier, which, pressed or let go mid-drag, may make the drag a Shortcut, or stop it being one. */
export function isModifier(key: string): boolean {
  return key === 'Shift' || key === 'Alt' || key === 'Control' || key === 'Meta';
}

/** Whether a Clip dragged with these modifiers nudges its active Take inside it, rather than moving. */
export function nudges(e: Modifiers): boolean {
  return matches(mouse('drag', e), rebound().nudgeTake.keys);
}

/** Whether a Clip or the Loop dragged with these modifiers goes anywhere, snapping to nothing. */
export function skipsSnapping(e: Modifiers): boolean {
  return matches(mouse('drag', e), rebound().skipSnapping.keys);
}

/**
 * Whether the wheel turned with these modifiers zooms the Timeline: with
 * its keys, or as a trackpad's pinch, which a browser sends as Ctrl+wheel
 * and which zooms whatever its keys are.
 */
export function zooms(e: Modifiers, keys: readonly Key[] = rebound().zoom.keys): boolean {
  return e.ctrlKey || matches(mouse('wheel', e), keys);
}
