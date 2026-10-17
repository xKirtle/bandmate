// PROTOTYPE, throwaway: Rebinding Shortcuts. Three variants of where Shortcuts
// are rebound, switchable by ?variant= on /settings, plus search in the Song
// page's shortcuts dialog. In memory only: a reload puts every key back.
import { keysLabel, platform, shortcuts, shortcutsDialogKeys, type Key, type ShortcutGroup } from '../shortcuts';

export type Variant = 'current' | 'A' | 'B' | 'C';

/** The variant last flipped to, so the Song page's dialog knows where "Change keys" goes. */
export const proto = $state<{ variant: Variant }>({ variant: 'A' });

export type Way = { label: string | null; keys: Key[] };

export type Entry = {
  id: string;
  name: string;
  group: ShortcutGroup;
  description: string;
  /** A mouse Shortcut: only its modifier changes. */
  mouse: boolean;
  /** Shown but can't be rebound, e.g. a plain drag. */
  fixed: boolean;
};

const on = platform();

const entries: Entry[] = [
  ...Object.entries(shortcuts).map(([id, s]) => {
    const keys: readonly Key[] = 'keys' in s ? s.keys : [...s.back, ...s.forward];
    const mouse = keys.some((k) => ['click', 'drag', 'wheel'].includes(k.key));
    return {
      id,
      name: s.name,
      group: s.group,
      description: s.description,
      mouse,
      fixed: mouse && keys.every((k) => !k.mod && !k.alt && !k.shift),
    };
  }),
  {
    id: 'openShortcuts',
    name: 'Show the shortcuts',
    group: 'Song editing',
    description: 'Opens the list of Shortcuts.',
    mouse: false,
    fixed: false,
  },
];

function defaultsOf(id: string): Way[] {
  if (id === 'openShortcuts') return [{ label: null, keys: [...shortcutsDialogKeys] }];
  const s = shortcuts[id as keyof typeof shortcuts];
  return 'keys' in s
    ? [{ label: null, keys: [...s.keys] }]
    : [
        { label: 'Back', keys: [...s.back] },
        { label: 'Forward', keys: [...s.forward] },
      ];
}

const clone = (ways: Way[]): Way[] => ways.map((w) => ({ label: w.label, keys: w.keys.map((k) => ({ ...k })) }));

export const bindings = $state<Record<string, Way[]>>(
  Object.fromEntries(entries.map((e) => [e.id, clone(defaultsOf(e.id))])),
);

/** A message per Shortcut: the last refusal, or a note. */
export const messages = $state<Record<string, string>>({});

export function allEntries(): Entry[] {
  return entries;
}

export function label(key: Key): string {
  return keysLabel([key], on);
}

function norm(k: Key): string {
  return [k.key.toLowerCase(), !!k.mod, !!k.alt, !!k.shift].join('|');
}

const sameKey = (a: Key, b: Key) => norm(a) === norm(b);

function holder(key: Key, except: { id: string; way: number; index: number } | null): Entry | null {
  for (const e of entries) {
    const ways = bindings[e.id];
    for (let w = 0; w < ways.length; w++)
      for (let i = 0; i < ways[w].keys.length; i++) {
        if (except && except.id === e.id && except.way === w && except.index === i) continue;
        if (sameKey(ways[w].keys[i], key)) return e;
      }
  }
  return null;
}

/** Why a key can't be chosen at all, or null. */
function reserved(key: Key): string | null {
  const k = key.key;
  if (k === 'Tab') return `${label(key)} can't be chosen: it moves between controls.`;
  if (k === 'Escape' && !key.mod && !key.alt && !key.shift) return "Esc can't be chosen: it closes and cancels.";
  if ((k === 'Enter' || k === ' ') && !key.mod && !key.alt && !key.shift)
    return `A bare ${k === ' ' ? 'Space' : 'Enter'} can't be chosen: it presses buttons. Add a modifier.`;
  if (key.mod && !key.alt && ['w', 't', 'n', 'q', 'l'].includes(k.toLowerCase()))
    return `${label(key)} can't be chosen: the browser keeps it.`;
  return null;
}

const modifierKeys = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'];

/**
 * The key a press stands for, or null to keep waiting (a modifier alone,
 * for a keyboard Shortcut). A mouse Shortcut takes a bare modifier, its
 * gesture kept.
 */
export function keyFrom(e: KeyboardEvent, entry: Entry, gesture: string): Key | null {
  if (entry.mouse) {
    if (e.key === 'Shift') return { key: gesture, shift: true };
    if (e.key === 'Alt') return { key: gesture, alt: true };
    if (e.key === 'Control' || e.key === 'Meta') return { key: gesture, mod: true };
    return null;
  }
  if (modifierKeys.includes(e.key)) return null;
  let key = e.key;
  // A Mac's Option turns a letter into a symbol (⌥R is ®): fall back to the
  // key's place.
  if (e.altKey && /^Key[A-Z]$/.test(e.code) && key.toLowerCase() !== e.code.slice(3).toLowerCase())
    key = e.code.slice(3).toLowerCase();
  const letter = key.length === 1 && key.toLowerCase() !== key.toUpperCase();
  const named = key.length > 1 || key === ' ';
  return {
    key: letter ? key.toLowerCase() : key,
    mod: e.ctrlKey || e.metaKey || undefined,
    alt: e.altKey || undefined,
    // A symbol takes Shift to type, e.g. ?, so Shift is part of it already.
    shift: (e.shiftKey && (letter || named)) || undefined,
  };
}

function isDefault(id: string, key: Key) {
  return defaultsOf(id).some((w) => w.keys.some((k) => sameKey(k, key)));
}

/** Sets a key (index = keys.length adds one); a refusal goes to `messages`. */
export function setKey(id: string, way: number, index: number, key: Key): boolean {
  const why = reserved(key);
  if (why && !isDefault(id, key)) {
    messages[id] = why;
    return false;
  }
  const taken = holder(key, { id, way, index });
  if (taken) {
    messages[id] = `${label(key)} is already used by ${taken.name}.`;
    return false;
  }
  bindings[id][way].keys[index] = key;
  delete messages[id];
  delete fresh[id];
  return true;
}

export function removeKey(id: string, way: number, index: number) {
  bindings[id][way].keys.splice(index, 1);
  delete messages[id];
}

export function changed(id: string): boolean {
  return JSON.stringify(bindings[id].map((w) => w.keys.map(norm))) !==
    JSON.stringify(defaultsOf(id).map((w) => w.keys.map(norm)));
}

export function changedCount(): number {
  return entries.filter((e) => changed(e.id)).length;
}

/** Puts one Shortcut's keys back, unless another Shortcut holds one of them now. */
export function resetOne(id: string): boolean {
  for (const w of defaultsOf(id))
    for (const k of w.keys) {
      const taken = holder(k, null);
      if (taken && taken.id !== id) {
        messages[id] = `Can't reset: ${label(k)} is used by ${taken.name}.`;
        return false;
      }
    }
  bindings[id] = clone(defaultsOf(id));
  delete messages[id];
  return true;
}

export function resetAll() {
  for (const e of entries) bindings[e.id] = clone(defaultsOf(e.id));
  for (const id of Object.keys(messages)) delete messages[id];
}

/** Shortcuts marked new: a later release added them and their default was taken. */
export const fresh = $state<Record<string, true>>({});

/** Simulates a release adding a Shortcut on S while S is taken: it arrives with no key. */
export function simulateNewShortcut() {
  const id = 'splitClips';
  bindings[id] = bindings[id].map((w) => ({ ...w, keys: [] }));
  fresh[id] = true;
  messages[id] = 'New: S was already taken, so it has no key yet.';
}

export function keysText(id: string): string {
  return bindings[id]
    .flatMap((w) => w.keys)
    .map(label)
    .join(' ');
}

/** Whether an entry matches a search, by name, description or key. */
export function matchesSearch(e: Entry, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = `${e.name} ${e.description} ${keysText(e.id)} ${keysText(e.id).replace(/\+/g, ' ')}`.toLowerCase();
  return s.split(/\s+/).every((word) => hay.includes(word));
}

export type Group = { group: ShortcutGroup; entries: Entry[] };

export function grouped(q: string): Group[] {
  const groups: Group[] = [];
  for (const e of entries) {
    if (!matchesSearch(e, q)) continue;
    let g = groups.find((x) => x.group === e.group);
    if (!g) groups.push((g = { group: e.group, entries: [] }));
    g.entries.push(e);
  }
  return groups;
}

export function allGroups(): ShortcutGroup[] {
  return [...new Set(entries.map((e) => e.group))];
}
