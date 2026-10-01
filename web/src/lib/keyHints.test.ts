import { describe as group, expect, it } from 'vitest';
import { KeyHints } from './keyHints';
import { allKeys, shortcuts } from './shortcuts';

const desktop = (on: 'mac' | 'other' = 'other') => new KeyHints(on, () => true);
const phone = () => new KeyHints('other', () => false);

group('KeyHints', () => {
  it("names a Shortcut's keys after a hint with a fine pointer", () => {
    expect(desktop('mac').named('Undo', shortcuts.undo.keys)).toBe('Undo (⌘Z)');
    expect(desktop().named('Redo', shortcuts.redo.keys)).toBe('Redo (Ctrl+Shift+Z or Ctrl+Y)');
  });

  it('leaves the keys off a hint without a fine pointer', () => {
    expect(phone().named('Undo', shortcuts.undo.keys)).toBe('Undo');
  });

  it("names a Shortcut's keys for a hint of its own only with a fine pointer", () => {
    expect(desktop('mac').label(shortcuts.cueNextLine.keys)).toBe('Enter');
    expect(desktop().label(allKeys([shortcuts.nudgeCue], 'forward'))).toBe('Alt+↑ or Alt+↓');
    expect(phone().label(shortcuts.cueNextLine.keys)).toBeNull();
  });

  it("declares a Shortcut's keys for aria-keyshortcuts only with a fine pointer", () => {
    expect(desktop('mac').aria(shortcuts.redo.keys)).toBe('Meta+Shift+Z Meta+Y');
    expect(desktop().aria(shortcuts.undo.keys)).toBe('Control+Z');
    expect(phone().aria(shortcuts.undo.keys)).toBeUndefined();
  });
});
