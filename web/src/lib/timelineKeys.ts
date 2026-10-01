/**
 * The Timeline's editing and mouse Shortcuts: a focused Clip's keys, the
 * ruler's, and the modifiers held while dragging or turning the wheel.
 * Each handler keeps its own guards, e.g. whether the Timeline can be edited.
 */

import { opensMenu } from './menu';
import { matches, shortcuts, stepBy, way, type Key, type KeyPress, type Way } from './shortcuts';

/** The modifiers held with a pointer or wheel event, or a key press. */
export type Modifiers = Omit<KeyPress, 'key'>;

/** A mouse action, `drag` or `wheel`, held with these modifiers, as a key press to match. */
function mouse(key: 'drag' | 'wheel', e: Modifiers): KeyPress {
  // Picked one by one: an event's modifiers are on its prototype, which spreading it would miss.
  return { key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey };
}

/** What a key press does to a focused Clip: delete it, open its ⋯ menu, or nothing. */
export function clipAction(e: KeyPress): 'delete' | 'menu' | null {
  if (matches(e, shortcuts.deleteClip.keys)) return 'delete';
  return opensMenu(e) ? 'menu' : null;
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
