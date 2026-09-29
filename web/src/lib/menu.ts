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
 * An entry in an Actions menu, e.g. a ⋯ one, also shown as an icon button
 * where there's room for one. It runs at once, or, with `choices`, opens a list to pick one from
 * in the menu, e.g. which Section to add to; such an entry shows only in ⋯.
 */
export type MenuAction = {
  icon: string;
  /** Names it in the menu, and to screen readers as a button. */
  label: string;
  /** The button's tooltip, when it has more to say than the label. */
  title?: string;
} & ({ run: () => void } | { choices: MenuChoice[] });

/** One of a menu entry's choices. */
export type MenuChoice = { label: string; run: () => void };
