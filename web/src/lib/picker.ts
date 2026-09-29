export type PickerAction =
  /** Opens the list on option `index`, or, without one, on the picked option. */
  | { kind: 'open'; index?: number }
  /** Closes the list without a change. */
  | { kind: 'close' }
  | { kind: 'highlight'; index: number }
  | { kind: 'pick'; index: number };

/**
 * What a key does in a picker whose list is `open`, of `count` options with
 * option `active` highlighted (-1 for none), or null to leave the key alone,
 * e.g. to Tab away or to type ahead. Follows the ARIA select-only combobox.
 */
export function pickerKey(
  key: string,
  altKey: boolean,
  { open, active, count }: { open: boolean; active: number; count: number },
): PickerAction | null {
  if (!open) {
    switch (key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        return { kind: 'open' };
      case 'Home':
        return { kind: 'open', index: 0 };
      case 'End':
        return { kind: 'open', index: count - 1 };
      default:
        return null;
    }
  }
  switch (key) {
    case 'ArrowDown':
      return { kind: 'highlight', index: (active + 1) % count };
    case 'ArrowUp':
      if (altKey) return active >= 0 ? { kind: 'pick', index: active } : { kind: 'close' };
      return { kind: 'highlight', index: active <= 0 ? count - 1 : active - 1 };
    case 'Home':
      return { kind: 'highlight', index: 0 };
    case 'End':
      return { kind: 'highlight', index: count - 1 };
    case 'Enter':
    case ' ':
    case 'Tab':
      return active >= 0 ? { kind: 'pick', index: active } : { kind: 'close' };
    case 'Escape':
      return { kind: 'close' };
    default:
      return null;
  }
}

/**
 * The option that what's been `typed` jumps to from option `active`, or -1 if
 * none starts with it, ignoring case. The same letter again and again moves on
 * through the options starting with it; more letters narrow it down, keeping
 * `active` while it still matches.
 */
export function typeaheadIndex(labels: readonly string[], typed: string, active: number): number {
  const t = typed.toLowerCase();
  const sameLetter = [...t].every((c) => c === t[0]);
  const prefix = sameLetter ? t[0] : t;
  const from = sameLetter ? active + 1 : Math.max(active, 0);
  for (let i = 0; i < labels.length; i++) {
    const at = (from + i) % labels.length;
    if (labels[at].toLowerCase().startsWith(prefix)) return at;
  }
  return -1;
}
