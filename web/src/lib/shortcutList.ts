import { keysLabel, type Key, type Platform, type Shortcut, type ShortcutGroup } from './shortcuts';

/** A Shortcut as the shortcuts dialog and Settings' Shortcuts tab list it. */
export type ListRow = {
  name: string;
  description: string;
  /** Where it works, as a sentence: "Works in the ruler, once it has focus." */
  worksIn: string;
  /**
   * Its keys as the platform names them: one list for a one-way Shortcut,
   * and for a two-way one, its keys going back, then forward.
   */
  keys: string[][];
};

/** One of the list's groups, headed by where its Shortcuts work. */
export type ListGroup = { group: ShortcutGroup; rows: ListRow[] };

/**
 * The Shortcuts as the shortcuts dialog and the Shortcuts tab list them:
 * every Shortcut in `list`, in its group, the groups and the Shortcuts in
 * each in the list's order.
 */
export function listGroups(list: Record<string, Shortcut>, on: Platform): ListGroup[] {
  const labels = (keys: readonly Key[]) => keys.map((key) => keysLabel([key], on));
  const groups: ListGroup[] = [];
  for (const shortcut of Object.values(list)) {
    let group = groups.find((g) => g.group === shortcut.group);
    if (!group) groups.push((group = { group: shortcut.group, rows: [] }));
    group.rows.push({
      name: shortcut.name,
      description: shortcut.description,
      worksIn: `Works in ${shortcut.worksIn}`,
      keys: 'keys' in shortcut ? [labels(shortcut.keys)] : [labels(shortcut.back), labels(shortcut.forward)],
    });
  }
  return groups;
}

// A Mac's modifier symbols, each with the names it's searched by. Mod is
// Ctrl or ⌘ on any platform, so ⌘ answers to Ctrl too.
const modifierNames: Record<string, readonly string[]> = {
  '⌘': ['Cmd', 'Command', 'Ctrl', 'Control'],
  '⌥': ['Option', 'Alt'],
  '⇧': ['Shift'],
};

/**
 * A key's label spelt out, for a search: a Mac's "⌘⇧Z" as "Cmd+Shift+Z",
 * "Command+Shift+Z", "Ctrl+Shift+Z" and so on, as hard-to-type symbols
 * would otherwise be the only way to find it. Any other label stands as it is.
 */
function spelledOut(label: string): string[] {
  const mods = [...label.slice(0, label.search(/[^⌘⌥⇧]|$/))];
  if (mods.length === 0) return [label];
  const name = label.slice(mods.length).replace(/^\+/, '');
  let spellings = [[] as string[]];
  for (const mod of mods) spellings = spellings.flatMap((s) => modifierNames[mod].map((n) => [...s, n]));
  return [label, ...spellings.map((s) => [...s, name].join('+'))];
}

/**
 * The list's groups as a search leaves them: only the Shortcuts whose
 * name, description, where they work or keys, as the rows name them or a
 * Mac's modifiers spelt out, hold every word of `query`, ignoring case, and
 * only the groups left with one. An empty search leaves every Shortcut.
 */
export function searchGroups(groups: readonly ListGroup[], query: string): ListGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (row: ListRow) => {
    // A line each, so a word can't match across two.
    const text = [row.name, row.description, row.worksIn, ...row.keys.flat().flatMap(spelledOut)]
      .join('\n')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  };
  return groups.map(({ group, rows }) => ({ group, rows: rows.filter(matches) })).filter(({ rows }) => rows.length > 0);
}
