/**
 * The Sync mode Shortcuts, cueing the next Line and nudging a Cue: whether
 * a key press is one, and should act now.
 */

import { matches, shortcuts, way, type KeyPress } from './shortcuts';

export type SyncKeyPress = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'defaultPrevented'
>;

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
export function cuesNextLine(e: SyncKeyPress, at: CueNextContext): boolean {
  if (!matches(e, shortcuts.cueNextLine.keys) || e.repeat) return false;
  return at.syncing && !e.defaultPrevented && !at.inTextField && !at.inDialogOrMenu;
}

/** Which way a key press nudges a Cue: 1 a tenth of a second later, -1 earlier, or null if it doesn't. */
export function cueNudge(e: KeyPress): 1 | -1 | null {
  const to = way(e, shortcuts.nudgeCue);
  return to === null ? null : to === 'forward' ? 1 : -1;
}
