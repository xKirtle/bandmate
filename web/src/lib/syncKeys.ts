/**
 * The Sync mode Shortcut, cueing the next Line: whether a key press is it,
 * and should act now.
 */

import { ownArrow } from './keyPlace';
import { matches, type KeyDown } from './shortcuts';
import { rebound } from './shortcutKeys';

/** Where a key was pressed, and whether Sync mode is on. */
export type CueNextContext = {
  syncing: boolean;
  /** It was pressed in a text field, which takes Enter. */
  inTextField: boolean;
  /** It was pressed in a dialog or a ⋯ menu, whose Enter is for what's in it. */
  inDialogOrMenu: boolean;
  /** The arrows there are the control's own, e.g. a number box's. */
  ownsArrows: boolean;
};

/**
 * Whether a key press cues the next Line at the playhead: in Sync mode,
 * anywhere but a text field, a dialog or a ⋯ menu, even on a button.
 */
export function cuesNextLine(e: KeyDown, at: CueNextContext): boolean {
  if (!matches(e, rebound().cueNextLine.keys) || e.repeat) return false;
  return at.syncing && !e.defaultPrevented && !at.inTextField && !at.inDialogOrMenu && !ownArrow(e, at);
}
