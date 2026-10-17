import { keysLabel, type Key, type Platform, type Shortcut, type ShortcutGroup } from './shortcuts';

/** A Shortcut as the shortcuts dialog lists it. */
export type DialogRow = {
  name: string;
  description: string;
  /**
   * Its keys as the platform names them: one list for a one-way Shortcut,
   * and for a two-way one, its keys going back, then forward.
   */
  keys: string[][];
};

/** One of the dialog's groups, headed by where its Shortcuts work. */
export type DialogGroup = { group: ShortcutGroup; rows: DialogRow[] };

/**
 * The shortcuts dialog's contents: every Shortcut in `list`, in its group,
 * the groups and the Shortcuts in each in the list's order.
 */
export function dialogGroups(list: Record<string, Shortcut>, on: Platform): DialogGroup[] {
  const labels = (keys: readonly Key[]) => keys.map((key) => keysLabel([key], on));
  const groups: DialogGroup[] = [];
  for (const shortcut of Object.values(list)) {
    let group = groups.find((g) => g.group === shortcut.group);
    if (!group) groups.push((group = { group: shortcut.group, rows: [] }));
    group.rows.push({
      name: shortcut.name,
      description: shortcut.description,
      keys: 'keys' in shortcut ? [labels(shortcut.keys)] : [labels(shortcut.back), labels(shortcut.forward)],
    });
  }
  return groups;
}

/**
 * The dialog's groups as a search leaves them: only the Shortcuts whose
 * name, description or keys, as the rows name them, hold every word of
 * `query`, ignoring case, and only the groups left with one. An empty
 * search leaves every Shortcut.
 */
export function searchGroups(groups: readonly DialogGroup[], query: string): DialogGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (row: DialogRow) => {
    // A line each, so a word can't match across two.
    const text = [row.name, row.description, ...row.keys.flat()].join('\n').toLowerCase();
    return words.every((word) => text.includes(word));
  };
  return groups.map(({ group, rows }) => ({ group, rows: rows.filter(matches) })).filter(({ rows }) => rows.length > 0);
}
