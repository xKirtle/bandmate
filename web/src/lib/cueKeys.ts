/**
 * The keys of a Cue's time: whether a key press nudges it. Nudging is for
 * tidying Cues after syncing, not during it, so it's Write mode only.
 * Which Shortcut a press is comes from shortcutPress.ts.
 */

import type { KeyHints } from './keyHints';
import { pressedInControl, type ShortcutPress } from './shortcutPress';
import { allKeys } from './shortcuts';
import { rebound } from './shortcutKeys';

/**
 * Which way a key press nudges a Cue: 1 a tenth of a second later, -1
 * earlier, or null if it doesn't, as in Sync mode. The Cue time hears it
 * in its own handler, so its keys are its own; held down, they go on
 * nudging.
 */
export function cueNudge(e: ShortcutPress, syncing: boolean): 1 | -1 | null {
  if (syncing) return null;
  const pressed = pressedInControl(e);
  if (pressed?.id !== 'nudgeCue') return null;
  return pressed.way === 'forward' ? 1 : -1;
}

/**
 * The keys that nudge a Cue, later then earlier, named for its tooltip and
 * declared for `aria-keyshortcuts`, or neither in Sync mode, where they do
 * nothing, or on a phone or a narrow window.
 */
export function cueNudgeHint(hints: KeyHints, syncing: boolean): { label: string | null; aria: string | undefined } {
  if (syncing) return { label: null, aria: undefined };
  return {
    label: hints.twoWay(rebound().nudgeCue, 'forward'),
    aria: hints.aria(allKeys([rebound().nudgeCue], 'forward')),
  };
}
