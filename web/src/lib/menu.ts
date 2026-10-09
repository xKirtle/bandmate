import type { Icon } from './icons';
import type { KeyHints } from './keyHints';
import { matches, shortcuts, stepBy, type KeyPress, type TwoWay } from './shortcuts';

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
  /** Beside the label in the menu, and alone on its icon button. */
  icon: Icon;
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
 * A number an entry sets from the menu, typed, or stepped with ↑/↓, by
 * more with Shift, as a number box steps. Each step is set at once.
 */
export type MenuField = {
  value: number;
  /** What it's counted in, e.g. "ms". */
  unit: string;
  step: number;
  shiftStep: number;
  /** The least and most it can be, if it's limited, e.g. a Gain; typed or stepped past, it stops there. */
  min?: number;
  max?: number;
  /** What it goes back to, e.g. a Tempo's 100%, offered under it while it's anything else. */
  reset?: { value: number; label: string };
  set: (value: number) => void;
};

/** A value for a field, kept within its range, if it has one. */
export function fieldInRange(value: number, field: Pick<MenuField, 'min' | 'max'>): number {
  return Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, value));
}

// A field's keys are a number box's own, not Shortcuts: ←/→ are left to
// move the text cursor, and Alt+←/→ to the browser. They're taken from
// the box, which would step by `step` alone, to step by more with Shift.
const stepKeys: TwoWay = { back: [{ key: 'ArrowDown' }], forward: [{ key: 'ArrowUp' }] };
const shiftStepKeys: TwoWay = {
  back: [{ key: 'ArrowDown', shift: true }],
  forward: [{ key: 'ArrowUp', shift: true }],
};

/**
 * What a key does to a menu's field at `value`: the value it steps it to,
 * or null to leave the key alone.
 */
export function fieldStep(
  e: KeyPress,
  value: number,
  field: Pick<MenuField, 'step' | 'shiftStep' | 'min' | 'max'>,
): number | null {
  const by = stepBy(e, [
    [stepKeys, field.step],
    [shiftStepKeys, field.shiftStep],
  ]);
  return by === null ? null : fieldInRange(value + by, field);
}

/** A field's tooltip, naming the keys that step it, e.g. "↑ or ↓ steps it by 1 ms, …", or undefined on a phone or a narrow window. */
export function fieldHint(field: Pick<MenuField, 'step' | 'shiftStep' | 'unit'>, hints: KeyHints): string | undefined {
  const step = hints.twoWay(stepKeys, 'forward');
  if (!step) return undefined;
  return `${step} steps it by ${field.step} ${field.unit}, or by ${field.shiftStep} with ${hints.twoWay(shiftStepKeys, 'forward')}`;
}
