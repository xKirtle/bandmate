/**
 * The Sync mode Shortcut, cueing the next Line: whether a key press is it,
 * and should act now. Which Shortcut a press is comes from
 * shortcutPress.ts.
 */

import { pressedOnPage, type ShortcutPress } from './shortcutPress';

/**
 * Whether a key press cues the next Line at the playhead: in Sync mode,
 * anywhere the key isn't the control's own, e.g. a text field, a popover
 * or a ⋯ menu, so even on a button.
 */
export function cuesNextLine(e: ShortcutPress, syncing: boolean): boolean {
  return syncing && pressedOnPage(e)?.id === 'cueNextLine';
}
