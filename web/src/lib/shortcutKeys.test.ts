import { describe as group, expect, it } from 'vitest';
import type { Key, KeyPress } from './shortcuts';
import {
  anyChanged,
  choose,
  defaultShortcutKeys,
  heldWith,
  isChanged,
  isFixed,
  keyChosen,
  readShortcutKeys,
  refusalMessage,
  removeKey,
  reset,
  seen,
  shortcutKeysKey,
  storeShortcutKeys,
  toggleModifier,
  type Refusal,
  type ShortcutKeys,
  type Slot,
} from './shortcutKeys';
import { storage } from './storageFake';

const press = (key: string, mods: Partial<Omit<KeyPress, 'key'>> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

/** The keys after choosing, failing the test if it was refused. */
function chosen(...args: Parameters<typeof choose>): ShortcutKeys {
  const choice = choose(...args);
  if (!choice.ok) throw new Error(`refused: ${JSON.stringify(choice.refusal)}`);
  return choice.keys;
}

const record: Slot = { id: 'record', list: 'keys', index: 0 };
const split: Slot = { id: 'splitClips', list: 'keys', index: 0 };

group('choosing a key', () => {
  it("replaces the key clicked with the one pressed, leaving the Shortcut's others", () => {
    const keys = chosen(defaultShortcutKeys, { id: 'redo', list: 'keys', index: 1 }, { key: 'u', mod: true });
    expect(keys.keys.redo.keys).toEqual([
      { key: 'z', mod: true, shift: true },
      { key: 'u', mod: true },
    ]);
    expect(keys.keys.undo.keys).toEqual([{ key: 'z', mod: true }]);
  });

  it('adds a key at the end of the list', () => {
    const keys = chosen(defaultShortcutKeys, { id: 'record', list: 'keys', index: 1 }, { key: 't' });
    expect(keys.keys.record.keys).toEqual([{ key: 'r' }, { key: 't' }]);
  });

  it("changes a two-way Shortcut's back and forward keys on their own", () => {
    const keys = chosen(defaultShortcutKeys, { id: 'startOrEnd', list: 'forward', index: 0 }, { key: 'e', alt: true });
    expect(keys.keys.startOrEnd).toEqual({ back: [{ key: 'Home' }], forward: [{ key: 'e', alt: true }] });
  });

  it('takes the key pressed again where it is as it was', () => {
    const keys = chosen(defaultShortcutKeys, record, { key: 'r' });
    expect(isChanged(keys.keys, 'record')).toBe(false);
  });
});

group('refusing a key', () => {
  const refused = (slot: Slot, key: Key, from = defaultShortcutKeys): Refusal => {
    const choice = choose(from, slot, key);
    if (choice.ok) throw new Error('chosen');
    return choice.refusal;
  };

  it('refuses a key another Shortcut has, naming it', () => {
    expect(refused(record, { key: 's' })).toEqual({ kind: 'taken', key: { key: 's' }, by: 'splitClips' });
    expect(refused(record, { key: 'z', mod: true })).toEqual({
      kind: 'taken',
      key: { key: 'z', mod: true },
      by: 'undo',
    });
  });

  it('takes a key with other modifiers than one taken, e.g. Shift+S beside S', () => {
    expect(choose(defaultShortcutKeys, record, { key: 's', shift: true }).ok).toBe(true);
  });

  it("refuses a key another of the Shortcut's own places has", () => {
    expect(refused({ id: 'redo', list: 'keys', index: 2 }, { key: 'y', mod: true }).kind).toBe('own');
    expect(refused({ id: 'startOrEnd', list: 'forward', index: 1 }, { key: 'Home' }).kind).toBe('own');
  });

  it('refuses Tab, Shift+Tab, Esc, and a bare Enter or Space', () => {
    expect(refused(record, { key: 'Tab' }).kind).toBe('tab');
    expect(refused(record, { key: 'Tab', shift: true }).kind).toBe('tab');
    expect(refused(record, { key: 'Escape', shift: true }).kind).toBe('escape');
    expect(refused(record, { key: 'Enter' }).kind).toBe('presses');
    expect(refused(record, { key: ' ' }).kind).toBe('presses');
    expect(choose(defaultShortcutKeys, record, { key: 'Enter', shift: true }).ok).toBe(true);
    expect(choose(defaultShortcutKeys, record, { key: ' ', alt: true }).ok).toBe(true);
  });

  it("refuses the browser's own, with Ctrl or ⌘", () => {
    for (const key of ['w', 't', 'n', 'q', 'l', 'Tab']) {
      expect(refused(record, { key, mod: true }).kind).toBe('browser');
    }
    expect(refused(record, { key: 't', mod: true, shift: true }).kind).toBe('browser');
    expect(choose(defaultShortcutKeys, record, { key: 'w' }).ok).toBe(true);
  });

  it("takes one of them back where it's the Shortcut's own default", () => {
    const freed = removeKey(defaultShortcutKeys, { id: 'cueNextLine', list: 'keys', index: 0 });
    expect(choose(freed, { id: 'cueNextLine', list: 'keys', index: 0 }, { key: 'Enter' }).ok).toBe(true);
    expect(refused({ id: 'cueNextLine', list: 'keys', index: 1 }, { key: ' ' }).kind).toBe('presses');
  });

  it('says why, naming the key as the platform does', () => {
    const taken = refused(record, { key: 's' });
    expect(refusalMessage(taken, 'other')).toEqual({ text: 'S is already used by', by: 'splitClips' });
    expect(refusalMessage(taken, 'other', true)).toEqual({ text: "Can't reset: S is used by", by: 'splitClips' });
    expect(refusalMessage(refused(record, { key: 'w', mod: true }), 'mac')).toEqual({
      text: "⌘W can't be chosen: the browser keeps it.",
      by: null,
    });
    expect(refusalMessage(refused(record, { key: 'Tab', shift: true }), 'other').text).toBe(
      "Shift+Tab can't be chosen: it moves between controls.",
    );
  });
});

group('the key a press chooses', () => {
  it('is the key with its exact modifiers, Ctrl and ⌘ alike', () => {
    expect(keyChosen(press('R', { shiftKey: true }))).toEqual({ key: 'r', shift: true });
    expect(keyChosen(press('z', { metaKey: true }))).toEqual({ key: 'z', mod: true });
    expect(keyChosen(press('z', { ctrlKey: true, altKey: true }))).toEqual({ key: 'z', mod: true, alt: true });
    expect(keyChosen(press('ArrowUp', { shiftKey: true }))).toEqual({ key: 'ArrowUp', shift: true });
  });

  it('keeps it waiting for a modifier alone', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']) expect(keyChosen(press(key))).toBeNull();
  });

  it('takes Shift as part of a symbol typed with it', () => {
    expect(keyChosen(press('?', { shiftKey: true }))).toEqual({ key: '?' });
  });

  it("is the letter at the key's place where a Mac's Option makes a symbol", () => {
    expect(keyChosen(press('®', { altKey: true, code: 'KeyR' }))).toEqual({ key: 'r', alt: true });
  });
});

group('choosing what is held with the mouse', () => {
  /** The keys after toggling, failing the test if it was refused. */
  function toggled(...args: Parameters<typeof toggleModifier>): ShortcutKeys {
    const choice = toggleModifier(...args);
    if (!choice.ok) throw new Error(`refused: ${JSON.stringify(choice.refusal)}`);
    return choice.keys;
  }
  const refused = (...args: Parameters<typeof toggleModifier>): Refusal => {
    const choice = toggleModifier(...args);
    if (choice.ok) throw new Error('chosen');
    return choice.refusal;
  };

  it('turns a modifier on or off, keeping the gesture', () => {
    const both = toggled(defaultShortcutKeys, 'skipSnapping', 'alt');
    expect(both.keys.skipSnapping.keys).toEqual([{ key: 'drag', shift: true, alt: true }]);
    const three = toggled(both, 'skipSnapping', 'mod');
    const modAlt = toggled(three, 'skipSnapping', 'shift');
    expect(modAlt.keys.skipSnapping.keys).toEqual([{ key: 'drag', mod: true, alt: true }]);
  });

  it('names what is held for each modifier', () => {
    expect(heldWith(defaultShortcutKeys.keys, 'toggleClip')).toEqual({
      gesture: 'click',
      mod: true,
      alt: false,
      shift: false,
    });
    expect(heldWith(defaultShortcutKeys.keys, 'zoom').gesture).toBe('wheel');
  });

  it('refuses turning off the last modifier, as a plain gesture does something else', () => {
    expect(refused(defaultShortcutKeys, 'skipSnapping', 'shift')).toEqual({
      kind: 'bare',
      key: { key: 'drag' },
    });
    expect(refusalMessage(refused(defaultShortcutKeys, 'toggleClip', 'mod'), 'other')).toEqual({
      text: 'Needs at least one modifier: a plain click does something else.',
      by: null,
    });
    expect(refusalMessage(refused(defaultShortcutKeys, 'zoom', 'mod'), 'other').text).toBe(
      'Needs at least one modifier: a plain scroll does something else.',
    );
  });

  it('refuses a combination another mouse Shortcut holds with the same gesture, naming it', () => {
    const off = toggled(defaultShortcutKeys, 'skipSnapping', 'alt');
    expect(refused(off, 'skipSnapping', 'shift')).toEqual({
      kind: 'taken',
      key: { key: 'drag', alt: true },
      by: 'nudgeTake',
    });
    expect(refusalMessage(refused(off, 'skipSnapping', 'shift'), 'mac')).toEqual({
      text: '⌥+drag is already used by',
      by: 'nudgeTake',
    });
    // Wherever each works: Ctrl+drag adds Clips with a box, on empty lane space.
    const mod = toggled(defaultShortcutKeys, 'nudgeTake', 'mod');
    expect(refused(mod, 'nudgeTake', 'alt')).toEqual({ kind: 'taken', key: { key: 'drag', mod: true }, by: 'addBox' });
  });

  it('refuses Shift alone with the wheel, which scrolls the Timeline sideways', () => {
    const shift = toggled(defaultShortcutKeys, 'zoom', 'shift');
    expect(refused(shift, 'zoom', 'mod')).toEqual({ kind: 'sideways', key: { key: 'wheel', shift: true } });
    expect(refusalMessage(refused(shift, 'zoom', 'mod'), 'other')).toEqual({
      text: "Shift+wheel can't be chosen: it scrolls the Timeline sideways.",
      by: null,
    });
    expect(toggled(shift, 'zoom', 'alt').keys.zoom.keys).toEqual([{ key: 'wheel', mod: true, alt: true, shift: true }]);
    // Shift with a drag is free to choose.
    const shiftClick = toggled(toggled(defaultShortcutKeys, 'toggleClip', 'shift'), 'toggleClip', 'mod');
    expect(shiftClick.keys.toggleClip.keys).toEqual([{ key: 'click', shift: true }]);
  });

  it('takes a combination another gesture holds', () => {
    const alt = toggled(defaultShortcutKeys, 'toggleClip', 'alt');
    expect(toggled(alt, 'toggleClip', 'mod').keys.toggleClip.keys).toEqual([{ key: 'click', alt: true }]);
  });

  it('gives a mouse Shortcut left without a key its gesture with the modifier turned on', () => {
    const none = removeKey(defaultShortcutKeys, { id: 'zoom', list: 'keys', index: 0 });
    expect(heldWith(none.keys, 'zoom')).toEqual({ gesture: 'wheel', mod: false, alt: false, shift: false });
    expect(toggled(none, 'zoom', 'alt').keys.zoom.keys).toEqual([{ key: 'wheel', alt: true }]);
  });

  it('marks it changed, and resets it, as a key', () => {
    const alt = toggled(defaultShortcutKeys, 'toggleClip', 'alt');
    expect(isChanged(alt.keys, 'toggleClip')).toBe(true);
    const back = reset(alt, 'toggleClip');
    expect(back.ok && back.keys.keys.toggleClip.keys).toEqual([{ key: 'click', mod: true }]);
  });

  it('keeps the plain drag that selects with a box as it is', () => {
    expect(isFixed('boxSelect')).toBe(true);
    expect(isFixed('addBox')).toBe(false);
    expect(isFixed('record')).toBe(false);
  });
});

group('changing and resetting', () => {
  it('marks a Shortcut changed once its keys differ from its defaults, in any order', () => {
    expect(isChanged(defaultShortcutKeys.keys, 'redo')).toBe(false);
    const redo = (index: number): Slot => ({ id: 'redo', list: 'keys', index });
    const reordered = chosen(removeKey(defaultShortcutKeys, redo(0)), redo(1), { key: 'z', mod: true, shift: true });
    expect(reordered.keys.redo.keys).toEqual([
      { key: 'y', mod: true },
      { key: 'z', mod: true, shift: true },
    ]);
    expect(isChanged(reordered.keys, 'redo')).toBe(false);
    expect(anyChanged(reordered)).toBe(false);

    const none = removeKey(defaultShortcutKeys, split);
    expect(none.keys.splitClips.keys).toEqual([]);
    expect(isChanged(none.keys, 'splitClips')).toBe(true);
    expect(anyChanged(none)).toBe(true);
  });

  it("puts a Shortcut's defaults back", () => {
    const back = reset(chosen(defaultShortcutKeys, split, { key: 'k' }), 'splitClips');
    expect(back.ok && back.keys.keys.splitClips.keys).toEqual([{ key: 's' }]);
  });

  it('refuses to reset a Shortcut while another has one of its defaults, naming it', () => {
    const moved = chosen(
      chosen(defaultShortcutKeys, split, { key: 'k' }),
      { id: 'record', list: 'keys', index: 1 },
      {
        key: 's',
      },
    );
    expect(reset(moved, 'splitClips')).toEqual({
      ok: false,
      refusal: { kind: 'taken', key: { key: 's' }, by: 'record' },
    });
  });
});

group('keeping the keys on this device', () => {
  it('reads the defaults where none are kept, or what is kept is unreadable', () => {
    const kept = storage();
    expect(readShortcutKeys(kept)).toEqual(defaultShortcutKeys);
    expect(readShortcutKeys(undefined)).toEqual(defaultShortcutKeys);
    kept.setItem(shortcutKeysKey, 'not json');
    expect(readShortcutKeys(kept)).toEqual(defaultShortcutKeys);
  });

  it('reads back the keys kept, keeping only what differs from the defaults', () => {
    const kept = storage();
    const keys = chosen(defaultShortcutKeys, { id: 'seek', list: 'back', index: 0 }, { key: 'j' });
    storeShortcutKeys(kept, keys);
    expect(JSON.parse(kept.getItem(shortcutKeysKey)!)).toEqual({
      keys: {
        seek: {
          back: [{ key: 'j' }, { key: 'ArrowDown' }],
          forward: [{ key: 'ArrowRight' }, { key: 'ArrowUp' }],
        },
      },
      fresh: [],
    });
    expect(readShortcutKeys(kept)).toEqual(keys);
  });

  it('keeps nothing once every Shortcut is back at its defaults', () => {
    const kept = storage();
    storeShortcutKeys(kept, chosen(defaultShortcutKeys, record, { key: 't' }));
    storeShortcutKeys(kept, defaultShortcutKeys);
    expect(kept.getItem(shortcutKeysKey)).toBeNull();
  });

  it("leaves a Shortcut kept in a shape it doesn't have, or one there's no more, at its defaults", () => {
    const kept = storage();
    kept.setItem(shortcutKeysKey, JSON.stringify({ keys: { seek: { keys: [{ key: 'j' }] }, gone: { keys: [] } } }));
    expect(readShortcutKeys(kept)).toEqual(defaultShortcutKeys);
  });

  it('gives a Shortcut added since none of the defaults the user gave another, marking it new', () => {
    // As though Record were added after the user gave Undo its R.
    const kept = storage();
    kept.setItem(shortcutKeysKey, JSON.stringify({ keys: { undo: { keys: [{ key: 'r' }] } } }));
    const read = readShortcutKeys(kept);
    expect(read.keys.undo.keys).toEqual([{ key: 'r' }]);
    expect(read.keys.record.keys).toEqual([]);
    expect(read.fresh).toEqual(['record']);
    // Seen, it's no longer new, and stays without the key.
    storeShortcutKeys(kept, seen(read, 'record'));
    expect(readShortcutKeys(kept)).toEqual({ keys: read.keys, fresh: [] });
  });

  it('keeps a new Shortcut new while other keys change, until it is seen', () => {
    const kept = storage();
    kept.setItem(shortcutKeysKey, JSON.stringify({ keys: { undo: { keys: [{ key: 'r' }] } } }));
    storeShortcutKeys(kept, chosen(readShortcutKeys(kept), split, { key: 'k' }));
    expect(readShortcutKeys(kept).fresh).toEqual(['record']);
  });
});
