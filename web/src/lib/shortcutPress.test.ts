// @vitest-environment happy-dom
import { afterEach, describe as group, expect, it } from 'vitest';
import { defaultKeyset, isMouse, keysIn, listsOf, type ShortcutId } from './shortcutKeys';
import { rebind } from './shortcutKeysFake';
import type { Key } from './shortcuts';
import { pressedInControl, pressedOnPage, type ShortcutPress } from './shortcutPress';

const press = (key: string, mods: Partial<Omit<ShortcutPress, 'key'>> = {}): ShortcutPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  defaultPrevented: false,
  target: null,
  ...mods,
});

/** A press of one of a Shortcut's keys, with exactly the modifiers it's held with. */
const pressOf = (key: Key, mods: Partial<Omit<ShortcutPress, 'key'>> = {}): ShortcutPress =>
  press(key.key, { ctrlKey: !!key.mod, altKey: !!key.alt, shiftKey: !!key.shift, ...mods });

// Every Shortcut pressed on a keyboard, with its first key: a mouse
// Shortcut is held with a click, a drag or the wheel, so it's never pressed.
const keyboardShortcuts = (Object.keys(defaultKeyset) as ShortcutId[])
  .filter((id) => !isMouse(id))
  .map((id) => ({ id, list: listsOf(id)[0], key: keysIn(defaultKeyset, id, listsOf(id)[0])[0] }));

// The Shortcuts that go on while their keys are held, and the only ones:
// seeking and nudging a Cue, where holding it is the point, and going to
// the start or end, which keeps the key so the page never scrolls instead.
const repeating: readonly ShortcutId[] = ['startOrEnd', 'seek', 'seekFar', 'nudgeCue'];

group('Which Shortcut a press is', () => {
  it.each(keyboardShortcuts)('answers $id for its own key', ({ id, list, key }) => {
    expect(pressedOnPage(pressOf(key))).toEqual({ id, way: list === 'keys' ? null : list });
  });

  it('answers nothing for a key no Shortcut has', () => {
    expect(pressedOnPage(press('q'))).toBeNull();
    expect(pressedOnPage(press('F4'))).toBeNull();
  });

  it('answers which way a two-way Shortcut goes', () => {
    expect(pressedOnPage(press('Home'))).toEqual({ id: 'startOrEnd', way: 'back' });
    expect(pressedOnPage(press('End'))).toEqual({ id: 'startOrEnd', way: 'forward' });
    expect(pressedOnPage(press('ArrowUp', { altKey: true }))).toEqual({ id: 'nudgeCue', way: 'forward' });
    expect(pressedOnPage(press('ArrowDown', { altKey: true }))).toEqual({ id: 'nudgeCue', way: 'back' });
  });

  it('takes a key only with its exact modifiers', () => {
    expect(pressedOnPage(press(' ', { shiftKey: true }))).toBeNull();
    expect(pressedOnPage(press('c'))).toBeNull();
    expect(pressedOnPage(press('c', { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

group('A held key', () => {
  it.each(keyboardShortcuts)('does $id once, unless it repeats', ({ id, key }) => {
    const held = pressedOnPage(pressOf(key, { repeat: true }));
    expect(held === null ? null : held.id).toBe(repeating.includes(id) ? id : null);
  });

  it('pastes, cuts and undoes once, however long Ctrl+V, Ctrl+X or Ctrl+Z is held', () => {
    expect(pressedOnPage(press('v', { ctrlKey: true, repeat: true }))).toBeNull();
    expect(pressedOnPage(press('x', { ctrlKey: true, repeat: true }))).toBeNull();
    expect(pressedOnPage(press('z', { ctrlKey: true, repeat: true }))).toBeNull();
  });

  it('goes on going to the start or the end, so the page never scrolls instead', () => {
    expect(pressedOnPage(press('Home', { repeat: true }))).toEqual({ id: 'startOrEnd', way: 'back' });
    expect(pressedOnPage(press('End', { repeat: true }))).toEqual({ id: 'startOrEnd', way: 'forward' });
  });

  it('goes on seeking while held, which scans the Song', () => {
    expect(pressedInControl(press('ArrowLeft', { repeat: true }))).toEqual({ id: 'seek', way: 'back' });
    expect(pressedInControl(press('ArrowRight', { shiftKey: true, repeat: true }))).toEqual({
      id: 'seekFar',
      way: 'forward',
    });
  });

  it('goes on nudging a Cue while held, which is the point of holding it', () => {
    expect(pressedOnPage(press('ArrowUp', { altKey: true, repeat: true }))).toEqual({
      id: 'nudgeCue',
      way: 'forward',
    });
    expect(pressedInControl(press('ArrowDown', { altKey: true, repeat: true }))).toEqual({
      id: 'nudgeCue',
      way: 'back',
    });
  });
});

group('A press a handler before has taken', () => {
  it('is left alone, wherever it was pressed', () => {
    expect(pressedOnPage(press(' ', { defaultPrevented: true }))).toBeNull();
    expect(pressedInControl(press('ArrowUp', { altKey: true, defaultPrevented: true }))).toBeNull();
  });
});

group("A key that's the control's own where it was pressed", () => {
  const typedIn = (element: Element) => press(' ', { target: element });

  afterEach(() => (document.body.innerHTML = ''));

  function fixture(html: string): Element {
    document.body.innerHTML = html;
    return document.body.firstElementChild as Element;
  }

  it('is left to the control on the page, e.g. a text field', () => {
    expect(pressedOnPage(typedIn(fixture('<input type="text" />')))).toBeNull();
  });

  it('is left to it in a dialog or a popover too', () => {
    const dialog = fixture('<div role="dialog"><button>Save</button></div>');
    expect(pressedOnPage(typedIn(dialog.firstElementChild as Element))).toBeNull();
  });

  it("is still the Shortcut's where it was pressed on the page itself", () => {
    expect(pressedOnPage(typedIn(fixture('<button>Play</button>')))).toEqual({ id: 'playPause', way: null });
  });

  it("is the control's own Shortcut in its own handler, e.g. a Cue time's nudge", () => {
    const field = fixture('<input type="text" />');
    const nudge = press('ArrowUp', { altKey: true, target: field });
    expect(pressedInControl(nudge)).toEqual({ id: 'nudgeCue', way: 'forward' });
    expect(pressedOnPage(nudge)).toBeNull();
  });
});

group('Keys as rebound on this device', () => {
  it('matches the keys chosen, and no longer the defaults', () => {
    rebind({ record: { keys: [{ key: 't' }] }, seek: { back: [{ key: 'j' }], forward: [{ key: 'l' }] } });
    expect(pressedOnPage(press('t'))).toEqual({ id: 'record', way: null });
    expect(pressedOnPage(press('r'))).toBeNull();
    expect(pressedInControl(press('j'))).toEqual({ id: 'seek', way: 'back' });
    expect(pressedOnPage(press('ArrowLeft'))).toBeNull();
  });

  it('matches nothing for a Shortcut left with no key at all', () => {
    rebind({ showShortcuts: { keys: [] } });
    expect(pressedOnPage(press('?'))).toBeNull();
  });

  it('keeps the repeat rule as it is, whatever keys a Shortcut is given', () => {
    // Keys no other Shortcut has, as rebinding insists on.
    rebind({
      pasteClips: { keys: [{ key: 'F7' }] },
      nudgeCue: { back: [], forward: [{ key: 'u' }] },
    });
    expect(pressedOnPage(press('F7', { repeat: true }))).toBeNull();
    expect(pressedOnPage(press('F7'))).toEqual({ id: 'pasteClips', way: null });
    expect(pressedInControl(press('u', { repeat: true }))).toEqual({ id: 'nudgeCue', way: 'forward' });
  });
});
