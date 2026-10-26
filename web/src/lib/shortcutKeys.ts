/**
 * The Shortcuts' keys as the user rebinds them, a Device Setting: which
 * keys each Shortcut has on this device, choosing, removing and resetting
 * them, or for a mouse Shortcut, the modifiers held with its gesture, and
 * how they're kept. Keys are unique across the Song page, so a
 * key another Shortcut has is refused, never swapped or taken from it.
 * Only what differs from the defaults is kept, so a Shortcut a later
 * release adds gets its default keys, but those the user has given
 * another Shortcut: then it arrives without them, marked new.
 */

import type { DeviceSettingStorage } from './deviceSetting.svelte';
import {
  holdsNothing,
  isGesture,
  keysLabel,
  modifiers,
  pressedKey,
  sameKey,
  shiftCounts,
  shortcuts,
  type Key,
  type Gesture,
  type KeyPress,
  type Modifier,
  type OneWay,
  type Platform,
  type Shortcut,
  type TwoWay,
} from './shortcuts';

/** Names a Shortcut in `shortcuts`. */
export type ShortcutId = keyof typeof shortcuts;

/** Every Shortcut's keys: a one-way Shortcut's list, or a two-way one's keys going back and forward. */
export type Keyset = {
  readonly [Id in ShortcutId]: (typeof shortcuts)[Id] extends TwoWay ? TwoWay : OneWay;
};

/** The Shortcuts' keys on this device, and which Shortcuts are marked new, until their folds are opened. */
export type ShortcutKeys = { keys: Keyset; fresh: readonly ShortcutId[] };

const ids = Object.keys(shortcuts) as ShortcutId[];

function copyOf(keys: OneWay | TwoWay): OneWay | TwoWay {
  return 'keys' in keys ? { keys: [...keys.keys] } : { back: [...keys.back], forward: [...keys.forward] };
}

/** Every Shortcut's default keys. */
export const defaultKeyset = Object.fromEntries(ids.map((id) => [id, copyOf(shortcuts[id])])) as Keyset;

/** The Shortcuts' keys before any is rebound. */
export const defaultShortcutKeys: ShortcutKeys = { keys: defaultKeyset, fresh: [] };

/** Every Shortcut, as `shortcuts` lists it, with its keys in `keys`, e.g. as rebound on this device. */
export function withKeys(keys: Keyset): Record<ShortcutId, Shortcut> {
  return Object.fromEntries(
    ids.map((id) => {
      const { name, group, description, worksIn } = shortcuts[id];
      return [id, { name, group, description, worksIn, ...keys[id] }];
    }),
  ) as Record<ShortcutId, Shortcut>;
}

/** Which of a Shortcut's lists of keys: a one-way Shortcut's only one, or a two-way one's back or forward. */
export type KeyList = 'keys' | 'back' | 'forward';

/** Where a key chosen goes: a Shortcut's list, and its place there, or the list's length to add one. */
export type Slot = { id: ShortcutId; list: KeyList; index: number };

/** The lists of keys a Shortcut has, in order: its one list, or back then forward. */
export function listsOf(id: ShortcutId): KeyList[] {
  return 'keys' in shortcuts[id] ? ['keys'] : ['back', 'forward'];
}

/** A Shortcut's keys from its lists, in `listsOf`'s order. */
function fromLists(id: ShortcutId, lists: readonly (readonly Key[])[]): OneWay | TwoWay {
  return 'keys' in shortcuts[id] ? { keys: lists[0] } : { back: lists[0], forward: lists[1] };
}

/** A Shortcut's keys in one of its lists. */
export function keysIn(keys: Keyset, id: ShortcutId, list: KeyList): readonly Key[] {
  return (keys[id] as Partial<Record<KeyList, readonly Key[]>>)[list] ?? [];
}

/** Every key of a Shortcut, in all its lists. */
function allOf(keys: Keyset, id: ShortcutId): readonly Key[] {
  return listsOf(id).flatMap((list) => keysIn(keys, id, list));
}

/** Whether a Shortcut is the mouse's, held with a click, drag or wheel, rather than a key's. */
export function isMouse(id: ShortcutId): boolean {
  return allOf(defaultKeyset, id).some((key) => isGesture(key.key));
}

/** Whether a Shortcut is the mouse's with nothing held, e.g. the plain drag that selects with a box, which can't be changed. */
export function isFixed(id: ShortcutId): boolean {
  return isMouse(id) && allOf(defaultKeyset, id).every(holdsNothing);
}

/** What a mouse Shortcut is held with: its gesture, and whether each modifier is held. */
export type Held = { gesture: Gesture } & Record<Modifier, boolean>;

/** What a mouse Shortcut is held with in `keys`: its gesture, never changed, and its modifiers, none if it has no key. */
export function heldWith(keys: Keyset, id: ShortcutId): Held {
  // A mouse Shortcut's default key is its gesture.
  const gesture = keysIn(defaultKeyset, id, 'keys')[0].key as Gesture;
  const key: Key = keysIn(keys, id, 'keys')[0] ?? { key: gesture };
  return { gesture, mod: !!key.mod, alt: !!key.alt, shift: !!key.shift };
}

/**
 * Turns a modifier a mouse Shortcut is held with on or off, its gesture
 * kept. Turning off the last is refused, as the plain gesture does
 * something else, and so is a combination another Shortcut has, as a key.
 */
export function toggleModifier(current: ShortcutKeys, id: ShortcutId, modifier: Modifier): Choice {
  const { gesture, ...held } = heldWith(current.keys, id);
  held[modifier] = !held[modifier];
  const key: Key = { key: gesture };
  for (const m of modifiers) if (held[m]) key[m] = true;
  if (holdsNothing(key)) return { ok: false, refusal: { kind: 'bare', key } };
  return choose(current, { id, list: 'keys', index: 0 }, key);
}

// Keys pressed only with others, which keep it waiting for one that isn't.
const modifierKeys = [
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'Super',
  'Hyper',
  'Fn',
  'FnLock',
  'CapsLock',
];
// Presses that name no key: an accent to come, or one an input method takes.
const unnamed = ['Dead', 'Unidentified', 'Process'];

/**
 * The key a press chooses, with its exact modifiers, or null for a
 * modifier alone, which keeps it waiting. A letter is the one printed on
 * the key, or with a Mac's Option, the one at its place (see pressedKey).
 */
export function keyChosen(pressed: KeyPress): Key | null {
  if (modifierKeys.includes(pressed.key)) return null;
  let name = pressedKey(pressed);
  if (unnamed.includes(name)) return null;
  if (name.length === 1 && name.toLowerCase() !== name.toUpperCase()) name = name.toLowerCase();
  const key: Key = { key: name };
  if (pressed.ctrlKey || pressed.metaKey) key.mod = true;
  if (pressed.altKey) key.alt = true;
  // A symbol, e.g. ?, may take Shift to type: it's part of the symbol.
  if (pressed.shiftKey && shiftCounts(name)) key.shift = true;
  return key;
}

/** Why a key can't be chosen: what holds it, what it's kept for, or, for a mouse Shortcut, that nothing would be held. */
export type Refusal =
  | { kind: 'taken'; key: Key; by: ShortcutId }
  | { kind: 'own'; key: Key }
  | { kind: KeptFor; key: Key }
  | { kind: 'bare'; key: Key };

/**
 * What a key no Shortcut can have is kept for: moving between controls,
 * cancelling, pressing buttons, the browser, or, for Shift alone with the
 * wheel, scrolling the Timeline sideways.
 */
type KeptFor = 'tab' | 'escape' | 'presses' | 'browser' | 'sideways';

/** The keys after a key is chosen, or why it's refused. */
export type Choice = { ok: true; keys: ShortcutKeys } | { ok: false; refusal: Refusal };

// The browser's own, with Ctrl or ⌘: tabs and windows, the address bar,
// quitting. A page never hears most of them.
const browserKeys = ['w', 't', 'n', 'q', 'l', 'h', 'm', 'Tab', 'PageUp', 'PageDown'];

/** Why a key can never be a Shortcut's, but its default, or null if it can be. */
function kept(key: Key): KeptFor | null {
  const bare = !key.mod && !key.alt && !key.shift;
  if (key.mod && browserKeys.includes(key.key)) return 'browser';
  // The browser's print, which makes a Print of the Song, with Ctrl or ⌘ alone:
  // with Shift or Alt too, P is free.
  if (key.mod && !key.alt && !key.shift && key.key === 'p') return 'browser';
  if (key.key === 'Tab') return 'tab';
  if (key.key === 'Escape') return 'escape';
  if (bare && (key.key === 'Enter' || key.key === ' ')) return 'presses';
  if (key.key === 'wheel' && key.shift && !key.mod && !key.alt) return 'sideways';
  return null;
}

/** The Shortcut that has `key`, but at `except`, and where. */
function holder(keys: Keyset, key: Key, except?: Slot): Slot | null {
  for (const id of ids) {
    for (const list of listsOf(id)) {
      const index = keysIn(keys, id, list).findIndex((k) => sameKey(k, key));
      if (index < 0) continue;
      if (except && except.id === id && except.list === list && except.index === index) continue;
      return { id, list, index };
    }
  }
  return null;
}

function withList(keys: Keyset, id: ShortcutId, list: KeyList, to: readonly Key[]): Keyset {
  return { ...keys, [id]: { ...keys[id], [list]: to } };
}

/**
 * Chooses `key` for `slot`, replacing the key there, or adding it at the
 * list's end. It's refused if another Shortcut, or another of this one's
 * lists or places, has it, or if it's kept for the page or the browser,
 * unless it's one of this Shortcut's defaults.
 */
export function choose(current: ShortcutKeys, slot: Slot, key: Key): Choice {
  const why = kept(key);
  if (why && !allOf(defaultKeyset, slot.id).some((k) => sameKey(k, key))) {
    return { ok: false, refusal: { kind: why, key } };
  }
  const held = holder(current.keys, key, slot);
  if (held) {
    const refusal: Refusal = held.id === slot.id ? { kind: 'own', key } : { kind: 'taken', key, by: held.id };
    return { ok: false, refusal };
  }
  const list = [...keysIn(current.keys, slot.id, slot.list)];
  list[slot.index] = key;
  return { ok: true, keys: { ...current, keys: withList(current.keys, slot.id, slot.list, list) } };
}

/** Takes the key at `slot` off its Shortcut. */
export function removeKey(current: ShortcutKeys, slot: Slot): ShortcutKeys {
  const list = keysIn(current.keys, slot.id, slot.list).filter((_, i) => i !== slot.index);
  return { ...current, keys: withList(current.keys, slot.id, slot.list, list) };
}

function sameKeys(a: readonly Key[], b: readonly Key[]): boolean {
  return a.length === b.length && a.every((key) => b.some((k) => sameKey(k, key)));
}

/** Whether a Shortcut's keys differ from its defaults, in any of its lists. */
export function isChanged(keys: Keyset, id: ShortcutId): boolean {
  return listsOf(id).some((list) => !sameKeys(keysIn(keys, id, list), keysIn(defaultKeyset, id, list)));
}

/** Whether any Shortcut's keys differ from its defaults, or any is marked new. */
export function anyChanged(current: ShortcutKeys): boolean {
  return current.fresh.length > 0 || ids.some((id) => isChanged(current.keys, id));
}

/**
 * Puts a Shortcut's default keys back, and takes its new mark off, unless
 * another Shortcut has one of them now, which refuses it.
 */
export function reset(current: ShortcutKeys, id: ShortcutId): Choice {
  for (const key of allOf(defaultKeyset, id)) {
    const held = holder(current.keys, key);
    if (held && held.id !== id) return { ok: false, refusal: { kind: 'taken', key, by: held.id } };
  }
  return {
    ok: true,
    keys: { keys: { ...current.keys, [id]: copyOf(defaultKeyset[id]) }, fresh: current.fresh.filter((f) => f !== id) },
  };
}

/** Takes a Shortcut's new mark off, once its fold is opened. */
export function seen(current: ShortcutKeys, id: ShortcutId): ShortcutKeys {
  return current.fresh.includes(id) ? { ...current, fresh: current.fresh.filter((f) => f !== id) } : current;
}

const gestureNouns: Record<Gesture, string> = { click: 'click', drag: 'drag', wheel: 'scroll' };

/**
 * Why a key was refused, in a sentence, naming the Shortcut that has it,
 * if one does, after the text: "S is already used by", then "Split at the
 * playhead". `resetting` says it was refused putting the defaults back.
 */
export function refusalMessage(
  refusal: Refusal,
  on: Platform,
  resetting = false,
): { text: string; by: ShortcutId | null } {
  const name = keysLabel([refusal.key], on);
  switch (refusal.kind) {
    case 'taken':
      return { text: resetting ? `Can't reset: ${name} is used by` : `${name} is already used by`, by: refusal.by };
    case 'own':
      return { text: `${name} is already one of this Shortcut's keys.`, by: null };
    case 'tab':
      return { text: `${name} can't be chosen: it moves between controls.`, by: null };
    case 'escape':
      return { text: `${name} can't be chosen: Esc closes and cancels.`, by: null };
    case 'presses':
      return { text: `${name} can't be chosen on its own: it presses buttons. Hold a modifier with it.`, by: null };
    case 'browser':
      return { text: `${name} can't be chosen: the browser keeps it.`, by: null };
    case 'sideways':
      return { text: `${name} can't be chosen: it scrolls the Timeline sideways.`, by: null };
    case 'bare':
      return {
        text: `Needs at least one modifier: a plain ${isGesture(refusal.key.key) ? gestureNouns[refusal.key.key] : refusal.key.key} does something else.`,
        by: null,
      };
  }
}

// Where the Shortcuts' keys are kept on this device: each changed
// Shortcut's keys, by its id, and the Shortcuts marked new.
export const shortcutKeysKey = 'bandmate.shortcutKeys';

type Kept = { keys?: Record<string, unknown>; fresh?: unknown };

/**
 * What a Shortcut was kept as before it was renamed, so keys rebound then
 * are still rebound now rather than quietly back at their defaults. The
 * nudge gesture became a Clip's rather than a Take's (ADR 0028).
 */
const formerIds: Partial<Record<ShortcutId, string>> = { nudgeClip: 'nudgeTake' };

/** Every id a Shortcut may be kept under on this device: its own, then the one it had before it was renamed. */
function keptIds(id: ShortcutId): string[] {
  const former = formerIds[id];
  return former === undefined ? [id] : [id, former];
}

function readKey(value: unknown): Key | null {
  if (typeof value !== 'object' || value === null) return null;
  const { key, mod, alt, shift } = value as Record<string, unknown>;
  if (typeof key !== 'string' || key === '') return null;
  const read: Key = { key };
  if (mod === true) read.mod = true;
  if (alt === true) read.alt = true;
  if (shift === true) read.shift = true;
  return read;
}

function readList(value: unknown): Key[] | null {
  if (!Array.isArray(value)) return null;
  const keys = value.map(readKey);
  return keys.every((k) => k !== null) ? keys : null;
}

/**
 * Reads the keys kept on this device: the defaults for any Shortcut not
 * kept, but for its defaults another Shortcut was given, which it goes
 * without, marked new. What can't be read is left at its defaults. A
 * Shortcut renamed since takes what it was kept as under its old id.
 */
export function readShortcutKeys(storage: Storage | undefined): ShortcutKeys {
  let kept: Kept;
  try {
    kept = JSON.parse(storage?.getItem(shortcutKeysKey) ?? '{}') as Kept;
    if (typeof kept !== 'object' || kept === null) return defaultShortcutKeys;
  } catch {
    return defaultShortcutKeys;
  }
  const keys = { ...defaultKeyset } as Record<ShortcutId, OneWay | TwoWay>;
  const changed = new Set<ShortcutId>();
  for (const id of ids) {
    const value = keptIds(id)
      .map((keptId) => kept.keys?.[keptId])
      .find((v) => v !== undefined);
    if (typeof value !== 'object' || value === null) continue;
    const lists = listsOf(id).map((list) => readList((value as Record<string, unknown>)[list]));
    if (lists.some((l) => l === null)) continue;
    keys[id] = fromLists(id, lists as Key[][]);
    changed.add(id);
  }
  const marked: unknown[] = Array.isArray(kept.fresh) ? kept.fresh : [];
  const fresh = new Set(ids.filter((id) => keptIds(id).some((keptId) => marked.includes(keptId))));
  // A Shortcut at its defaults goes without those the user gave another.
  const given = ids.filter((id) => changed.has(id)).flatMap((id) => allOf(keys as Keyset, id));
  for (const id of ids) {
    if (changed.has(id)) continue;
    const isGiven = (key: Key) => given.some((g) => sameKey(g, key));
    if (!allOf(keys as Keyset, id).some(isGiven)) continue;
    keys[id] = fromLists(
      id,
      listsOf(id).map((list) => keysIn(keys as Keyset, id, list).filter((key) => !isGiven(key))),
    );
    fresh.add(id);
  }
  return { keys: keys as Keyset, fresh: ids.filter((id) => fresh.has(id)) };
}

/** Keeps the keys on this device: only those of Shortcuts that differ from their defaults, and which are new. */
export function storeShortcutKeys(storage: Storage | undefined, value: ShortcutKeys) {
  const changed = ids.filter((id) => isChanged(value.keys, id) || value.fresh.includes(id));
  try {
    if (changed.length === 0 && value.fresh.length === 0) {
      storage?.removeItem(shortcutKeysKey);
      return;
    }
    const keys = Object.fromEntries(changed.map((id) => [id, value.keys[id]]));
    storage?.setItem(shortcutKeysKey, JSON.stringify({ keys, fresh: value.fresh }));
  } catch {
    // Not kept, e.g. in a private window; the keys still apply until reload.
  }
}

/** The Shortcuts' keys, as a Device Setting is kept on this device. */
export const shortcutKeysSetting = {
  key: shortcutKeysKey,
  read: readShortcutKeys,
  store: storeShortcutKeys,
} satisfies DeviceSettingStorage<ShortcutKeys>;

// Where every handler and hint finds the keys: the defaults, until the
// app has them follow this device's: main.ts imports
// sharedShortcutKeys.svelte.ts, which does, before anything is mounted.
let source: () => Keyset = () => defaultKeyset;

/** Every Shortcut's keys as rebound on this device, which every handler matches and every hint names. */
export function rebound(): Keyset {
  return source();
}

/** Has `rebound` give the keys `from` gives, e.g. this device's, followed as they change. */
export function followKeys(from: () => Keyset) {
  source = from;
}
