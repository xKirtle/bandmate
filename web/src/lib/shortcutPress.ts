/**
 * Which Shortcut a key press on the Song page is: the one place that
 * decides it, for every handler there. It matches a press against the keys
 * as rebound on this device (see shortcutKeys.ts), leaves alone a press a
 * handler before has taken, one that's the control's own where it was
 * pressed (see keyPlace.ts) and a held key's repeat of a Shortcut that
 * doesn't repeat, and says no more: what each Shortcut then does, and
 * whether it can act now, is its handler's (see songKeys.ts,
 * timelineKeys.ts, syncKeys.ts and cueKeys.ts).
 */

import { ownKey } from './keyPlace';
import { rebound, type ShortcutId } from './shortcutKeys';
import { matches, shortcuts, way, type KeyDown, type Shortcut, type Way } from './shortcuts';

/** A key press as a handler on the Song page hears it, with where it was pressed. */
export type ShortcutPress = KeyDown & Pick<KeyboardEvent, 'target'>;

/** The Shortcut a key press is, and which way it goes if it's a two-way one, e.g. seeking back. */
export type PressedShortcut = { id: ShortcutId; way: Way | null };

const definitions: Record<ShortcutId, Shortcut> = shortcuts;
const ids = Object.keys(shortcuts) as ShortcutId[];

/** Which Shortcut a press is, by its keys alone, taken or not and wherever it landed. */
function matched(e: ShortcutPress): PressedShortcut | null {
  const keys = rebound();
  for (const id of ids) {
    // A held key does its Shortcut once, unless the Shortcut repeats. Keys
    // are unique, so a repeat is no other Shortcut's either.
    if (e.repeat && !definitions[id].repeats) continue;
    const of = keys[id];
    if ('keys' in of) {
      if (matches(e, of.keys)) return { id, way: null };
      continue;
    }
    const going = way(e, of);
    if (going) return { id, way: going };
  }
  return null;
}

/**
 * Which Shortcut a key press anywhere on the Song page is, for a handler
 * on the window: nothing where it's the control's own key, e.g. typed in
 * a text field or pressed in a dialog, which the control keeps.
 */
export function pressedOnPage(e: ShortcutPress): PressedShortcut | null {
  if (e.defaultPrevented || ownKey({ key: e.key, target: e.target })) return null;
  return matched(e);
}

/**
 * Which Shortcut a key press is for the control it was pressed in, which
 * hears it in its own handler, e.g. a Cue time nudged or the ruler
 * seeking: its own keys are its to act on, so where it was pressed rules
 * nothing out.
 */
export function pressedInControl(e: ShortcutPress): PressedShortcut | null {
  if (e.defaultPrevented) return null;
  return matched(e);
}
