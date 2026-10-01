/**
 * The Timeline's editing and mouse Shortcuts: a focused Clip's keys, the
 * ruler's, and the modifiers held while dragging or turning the wheel.
 * Each handler keeps its own guards, e.g. whether the Timeline can be edited.
 */

import { opensMenu } from './menu';
import type { KeyPress } from './shortcuts';

/** The modifiers held with a pointer or wheel event, or a key press. */
export type Modifiers = Omit<KeyPress, 'key'>;

/** What a key press does to a focused Clip: delete it, open its ⋯ menu, or nothing. */
export function clipAction(e: KeyPress): 'delete' | 'menu' | null {
  if (e.key === 'Delete' || e.key === 'Backspace') return 'delete';
  return opensMenu(e) ? 'menu' : null;
}

/** Where a key press on the ruler seeks to, from `position` on a Timeline `length` long, or null if it doesn't. */
export function rulerSeek(e: KeyPress, position: number, length: number): number | null {
  const step = e.shiftKey ? 15 : 5;
  const to: Record<string, number> = {
    ArrowLeft: position - step,
    ArrowDown: position - step,
    ArrowRight: position + step,
    ArrowUp: position + step,
    Home: 0,
    End: length,
  };
  return to[e.key] ?? null;
}

/** Whether a Clip dragged with these modifiers slips its active Take inside it, rather than moving. */
export function slips(e: Modifiers): boolean {
  return e.altKey;
}

/** Whether a Clip or the Loop dragged with these modifiers goes anywhere, snapping to nothing. */
export function skipsSnapping(e: Modifiers): boolean {
  return e.shiftKey;
}

/** Whether the wheel turned with these modifiers zooms the Timeline. */
export function zooms(e: Modifiers): boolean {
  return e.ctrlKey;
}
