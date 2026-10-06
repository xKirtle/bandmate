/**
 * The keys of a Cue's time: whether a key press nudges it. Nudging is for
 * tidying Cues after syncing, not during it, so it's Write mode only.
 */

import type { KeyHints } from './keyHints';
import { allKeys, shortcuts, way, type KeyPress } from './shortcuts';

/** Which way a key press nudges a Cue: 1 a tenth of a second later, -1 earlier, or null if it doesn't, as in Sync mode. */
export function cueNudge(e: KeyPress, syncing: boolean): 1 | -1 | null {
  if (syncing) return null;
  const to = way(e, shortcuts.nudgeCue);
  return to === null ? null : to === 'forward' ? 1 : -1;
}

/**
 * The keys that nudge a Cue, later then earlier, named for its tooltip and
 * declared for `aria-keyshortcuts`, or neither in Sync mode, where they do
 * nothing, or on a phone or a narrow window.
 */
export function cueNudgeHint(hints: KeyHints, syncing: boolean): { label: string | null; aria: string | undefined } {
  if (syncing) return { label: null, aria: undefined };
  return {
    label: hints.twoWay(shortcuts.nudgeCue, 'forward'),
    aria: hints.aria(allKeys([shortcuts.nudgeCue], 'forward')),
  };
}
