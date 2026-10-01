import { matches, shortcuts, stepBy, type KeyPress } from './shortcuts';

/**
 * What a key does in an open menu of `count` entries, with entry `current`
 * focused (-1 for none): the entry to focus next, 'close', or null to leave
 * the key alone.
 */
export function menuKey(key: string, current: number, count: number): number | 'close' | null {
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'Escape':
    case 'Tab':
      return 'close';
    default:
      return null;
  }
}

/**
 * Whether a key opens a menu from what has focus, as it would a context
 * menu: the Menu key, or Shift+F10.
 */
export function opensMenu(e: KeyPress): boolean {
  return matches(e, shortcuts.clipMenu.keys);
}

/**
 * An entry in an Actions menu, e.g. a ⋯ one, also shown as an icon button
 * where there's room for one. It runs at once, or, with `choices`, opens a list to pick one from
 * in the menu, e.g. which Section to add to, or with `field`, a number to set, e.g. a nudge;
 * such an entry shows only in ⋯.
 */
export type MenuAction = {
  icon: string;
  /** Names it in the menu, and to screen readers as a button. */
  label: string;
  /** The button's tooltip, when it has more to say than the label. */
  title?: string;
  /** Shown but unavailable, e.g. while what it does can't be done. */
  disabled?: boolean;
} & ({ run: () => void } | { choices: MenuChoice[] } | { field: MenuField });

/**
 * One of a menu entry's choices. With `checked`, the choices are a set of
 * which one is on, e.g. a Clip's active Take, marked as such.
 */
export type MenuChoice = { label: string; run: () => void; checked?: boolean };

/**
 * A number an entry sets from the menu, typed, or stepped with Alt+←/→, by
 * more with Shift. Each step is set at once.
 */
export type MenuField = {
  value: number;
  /** What it's counted in, e.g. "ms". */
  unit: string;
  step: number;
  shiftStep: number;
  set: (value: number) => void;
};

/**
 * What a key does to a menu's field at `value`: the value it steps it to,
 * or null to leave the key alone.
 */
export function fieldStep(e: KeyPress, value: number, field: Pick<MenuField, 'step' | 'shiftStep'>): number | null {
  const by = stepBy(e, [
    [shortcuts.step, field.step],
    [shortcuts.shiftStep, field.shiftStep],
  ]);
  return by === null ? null : value + by;
}
