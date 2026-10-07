/**
 * The Timeline's editing and mouse Shortcuts: the Selection's and a focused
 * Clip's keys, decided with all their guards in `timelineKey`, the ruler's,
 * and the modifiers held while dragging or turning the wheel.
 */

import { opensMenu } from './menu';
import type { Freeze } from './freeze';
import { matches, shortcuts, stepBy, way, type Key, type KeyDown, type KeyPress, type Way } from './shortcuts';

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

/** Where a key was pressed in the Timeline, and what the Timeline is doing. */
export type TimelineKeyContext = {
  /** It was pressed in a text field, which takes typed keys. */
  inTextField: boolean;
  /** It was pressed in a ⋯ menu or a dialog, whose keys are for what's in it. */
  inMenuOrDialog: boolean;
  /** The Timeline can be edited, i.e. it isn't in Read mode or on a phone. */
  editable: boolean;
  /** Why the Timeline can't be edited now, if it can't. */
  freeze: Freeze;
  /** How many Clips are selected. */
  selected: number;
  /** The Clip the key was pressed on, if it has focus itself, and whether it's selected. */
  focusedClip: { selected: boolean } | null;
  /** A Track is being dragged by its grip. */
  draggingTrack: boolean;
};

/**
 * Which Timeline Shortcut a key press is, if any, and if it should act
 * now: null leaves the key to the page.
 */
export function timelineKey(e: KeyDown, at: TimelineKeyContext): TimelineKey | null {
  // A text field's, a menu's or a dialog's keys are their own.
  if (e.defaultPrevented || at.inTextField || at.inMenuOrDialog) return null;
  // Deleting, copying, cutting and pasting go with editing, so not on a
  // phone, nor while recording or merging.
  const edits = at.editable && at.freeze === null;
  const deletes = matches(e, shortcuts.deleteClip.keys);
  if (at.focusedClip && opensMenu(e)) {
    // Even while recording or merging, with its edits off, and while a Track is dragged.
    return at.editable ? 'clipMenu' : null;
  }
  // A focused Clip's Delete, even while a Track is dragged: the whole
  // Selection if it's in it, else that Clip alone.
  if (at.focusedClip && deletes) {
    if (!edits) return null;
    return at.focusedClip.selected ? 'deleteSelection' : 'deleteClip';
  }
  // Esc then cancels the drag.
  if (at.draggingTrack) return null;
  if (matches(e, shortcuts.clearSelection.keys)) return at.selected > 0 ? 'clearSelection' : null;
  if (matches(e, shortcuts.selectAll.keys)) return at.editable ? 'selectAll' : null;
  if (matches(e, shortcuts.pasteClips.keys)) return edits ? 'paste' : null;
  // These act on the Selection, even from a focused Clip outside it.
  if (!edits || at.selected === 0) return null;
  if (deletes) return 'deleteSelection';
  if (matches(e, shortcuts.copyClips.keys)) return 'copy';
  if (matches(e, shortcuts.cutClips.keys)) return 'cut';
  return null;
}

/** Whether a box drawn over empty lane space with these modifiers adds the Clips it touches to the Selection, rather than replacing it. */
export function addsBox(e: Modifiers): boolean {
  return matches(mouse('drag', e), shortcuts.addBox.keys);
}

/** Whether a Clip clicked with these modifiers is added to the Selection or taken out, rather than selected alone. */
export function togglesSelection(e: Modifiers): boolean {
  return matches(mouse('click', e), shortcuts.toggleClip.keys);
}

/** Where a key press on the ruler seeks to, from `position` on a Timeline `length` long, or null if it doesn't. */
export function rulerSeek(e: KeyPress, position: number, length: number): number | null {
  const by = stepBy(e, [
    [shortcuts.seek, 5],
    [shortcuts.seekFar, 15],
  ]);
  if (by !== null) return position + by;
  const going = way(e, shortcuts.startOrEnd);
  return going ? startOrEnd(going, length) : null;
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
  return matches(mouse('drag', e), shortcuts.nudgeTake.keys);
}

/** Whether a Clip or the Loop dragged with these modifiers goes anywhere, snapping to nothing. */
export function skipsSnapping(e: Modifiers): boolean {
  return matches(mouse('drag', e), shortcuts.skipSnapping.keys);
}

/**
 * Whether the wheel turned with these modifiers zooms the Timeline: with
 * its keys, or as a trackpad's pinch, which a browser sends as Ctrl+wheel
 * and which zooms whatever its keys are.
 */
export function zooms(e: Modifiers, keys: readonly Key[] = shortcuts.zoom.keys): boolean {
  return e.ctrlKey || matches(mouse('wheel', e), keys);
}
