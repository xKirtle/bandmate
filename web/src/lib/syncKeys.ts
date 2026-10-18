/**
 * The Sync mode Shortcut, cueing the next Line: whether a key press is it,
 * and should act now.
 */

import type { KeyAt } from './keyPlace';
import { matches, type KeyDown } from './shortcuts';
import { rebound } from './shortcutKeys';

/** Whether the key is the control's own where it was pressed, and whether Sync mode is on. */
export type CueNextContext = KeyAt & {
  syncing: boolean;
};

/**
 * Whether a key press cues the next Line at the playhead: in Sync mode,
 * anywhere the key isn't the control's own, e.g. a text field, a popover
 * or a ⋯ menu, so even on a button.
 */
export function cuesNextLine(e: KeyDown, at: CueNextContext): boolean {
  if (!matches(e, rebound().cueNextLine.keys) || e.repeat) return false;
  return at.syncing && !e.defaultPrevented && !at.own;
}
