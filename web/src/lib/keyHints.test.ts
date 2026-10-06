import { describe as group, expect, it } from 'vitest';
import { KeyHints, keyboardAndMouseQuery } from './keyHints';
import { allKeys, shortcuts } from './shortcuts';

const desktop = (on: 'mac' | 'other' = 'other') => new KeyHints(on, () => true);
const phone = () => new KeyHints('other', () => false);

group('KeyHints', () => {
  it("names a Shortcut's keys after a hint with a keyboard and mouse", () => {
    expect(desktop('mac').withKeys('Undo', shortcuts.undo.keys)).toBe('Undo (⌘Z)');
    expect(desktop().withKeys('Redo', shortcuts.redo.keys)).toBe('Redo (Ctrl+Shift+Z or Ctrl+Y)');
  });

  it('leaves the keys off a hint on a phone or a narrow window', () => {
    expect(phone().withKeys('Undo', shortcuts.undo.keys)).toBe('Undo');
  });

  it("names a Shortcut's keys for a hint of its own only with a keyboard and mouse", () => {
    expect(desktop('mac').label(shortcuts.cueNextLine.keys)).toBe('Enter');
    expect(desktop().label(allKeys([shortcuts.nudgeCue], 'forward'))).toBe('Alt+↑ or Alt+↓');
    expect(phone().label(shortcuts.cueNextLine.keys)).toBeNull();
  });

  it("names a two-way Shortcut's keys only with a keyboard and mouse", () => {
    expect(desktop('mac').twoWay(shortcuts.nudgeCue)).toBe('⌥↓ or ⌥↑');
    expect(desktop().twoWay(shortcuts.nudgeCue, 'forward')).toBe('Alt+↑ or Alt+↓');
    expect(phone().twoWay(shortcuts.nudgeCue)).toBeNull();
  });

  it("declares a Shortcut's keys for aria-keyshortcuts only with a keyboard and mouse", () => {
    expect(desktop('mac').aria(shortcuts.redo.keys)).toBe('Meta+Shift+Z Meta+Y');
    expect(desktop().aria(shortcuts.undo.keys)).toBe('Control+Z');
    expect(phone().aria(shortcuts.undo.keys)).toBeUndefined();
  });
});

group('keyboardAndMouseQuery', () => {
  it('is a window at least 40rem wide whose primary pointer can hover', () => {
    // A phone can report a fine pointer, but not one that hovers.
    expect(keyboardAndMouseQuery).toBe('(min-width: 40rem) and (hover: hover)');
  });
});
