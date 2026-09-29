/**
 * The options a combobox offers: all of them until something is typed
 * (`query` null), then those containing it, ignoring case.
 */
export function filterOptions(options: readonly string[], query: string | null): string[] {
  const q = query?.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter((o) => o.toLowerCase().includes(q));
}

/** Where `value` is among `options`, ignoring case and spaces around it; -1 if it isn't. */
export function optionIndex(options: readonly string[], value: string): number {
  const v = value.trim().toLowerCase();
  return options.findIndex((o) => o.toLowerCase() === v);
}

export type ComboboxAction =
  | { kind: 'open' }
  | { kind: 'close' }
  /** Takes back what was typed, to the saved value. */
  | { kind: 'revert' }
  | { kind: 'highlight'; index: number }
  | { kind: 'pick'; index: number };

/**
 * What a key does in a combobox whose list is `open`, showing `count`
 * options with option `active` highlighted (-1 for none), or null to leave
 * the key to the field.
 */
export function comboboxKey(
  key: string,
  altKey: boolean,
  { open, active, count }: { open: boolean; active: number; count: number },
): ComboboxAction | null {
  if (!open) {
    if (key === 'ArrowDown') return { kind: 'open' };
    if (key === 'Escape') return { kind: 'revert' };
    return null;
  }
  switch (key) {
    case 'ArrowDown':
      return { kind: 'highlight', index: (active + 1) % count };
    case 'ArrowUp':
      if (altKey) return { kind: 'close' };
      return { kind: 'highlight', index: active <= 0 ? count - 1 : active - 1 };
    case 'Enter':
      return active >= 0 ? { kind: 'pick', index: active } : { kind: 'close' };
    case 'Escape':
      return { kind: 'close' };
    default:
      return null;
  }
}
