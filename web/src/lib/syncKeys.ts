/**
 * The Sync mode Shortcut, cueing the next Line: whether a key press is it,
 * and should act now.
 */

import { matches, shortcuts, type KeyDown } from './shortcuts';

/** Where a key was pressed, and whether Sync mode is on. */
export type CueNextContext = {
  syncing: boolean;
  /** It was pressed in a text field, which takes Enter. */
  inTextField: boolean;
  /** It was pressed in a dialog or a ⋯ menu, whose Enter is for what's in it. */
  inDialogOrMenu: boolean;
};

/**
 * Whether a key press cues the next Line at the playhead: in Sync mode,
 * anywhere but a text field, a dialog or a ⋯ menu, even on a button.
 */
export function cuesNextLine(e: KeyDown, at: CueNextContext): boolean {
  if (!matches(e, shortcuts.cueNextLine.keys) || e.repeat) return false;
  return at.syncing && !e.defaultPrevented && !at.inTextField && !at.inDialogOrMenu;
}
