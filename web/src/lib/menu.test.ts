import { describe as group, expect, it } from 'vitest';
import { KeyHints } from './keyHints';
import { fieldHint, fieldStep, fieldInRange, menuKey, opensMenu } from './menu';

group('menuKey', () => {
  it('moves down and up through the entries, wrapping round', () => {
    expect(menuKey('ArrowDown', 0, 3)).toBe(1);
    expect(menuKey('ArrowDown', 2, 3)).toBe(0);
    expect(menuKey('ArrowUp', 1, 3)).toBe(0);
    expect(menuKey('ArrowUp', 0, 3)).toBe(2);
  });

  it('jumps to the first and last entries', () => {
    expect(menuKey('Home', 2, 3)).toBe(0);
    expect(menuKey('End', 0, 3)).toBe(2);
  });

  it('starts from the first or last entry when none has focus', () => {
    expect(menuKey('ArrowDown', -1, 3)).toBe(0);
    expect(menuKey('ArrowUp', -1, 3)).toBe(2);
  });

  it('closes the menu on Escape and Tab', () => {
    expect(menuKey('Escape', 1, 3)).toBe('close');
    expect(menuKey('Tab', 1, 3)).toBe('close');
  });

  it('ignores other keys', () => {
    expect(menuKey('a', 1, 3)).toBeNull();
    expect(menuKey('Enter', 1, 3)).toBeNull();
  });
});

group('fieldStep', () => {
  const keys = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };
  const field = { step: 1, shiftStep: 10 };

  it('steps with Down and Up, by more with Shift', () => {
    expect(fieldStep({ ...keys, key: 'ArrowDown' }, 5, field)).toBe(4);
    expect(fieldStep({ ...keys, key: 'ArrowUp' }, 5, field)).toBe(6);
    expect(fieldStep({ ...keys, key: 'ArrowDown', shiftKey: true }, 5, field)).toBe(-5);
    expect(fieldStep({ ...keys, key: 'ArrowUp', shiftKey: true }, 5, field)).toBe(15);
  });

  it('leaves Left and Right to move the text cursor, with Shift or Alt too', () => {
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      expect(fieldStep({ ...keys, key }, 5, field)).toBeNull();
      expect(fieldStep({ ...keys, key, shiftKey: true }, 5, field)).toBeNull();
      expect(fieldStep({ ...keys, key, altKey: true }, 5, field)).toBeNull();
      expect(fieldStep({ ...keys, key, altKey: true, shiftKey: true }, 5, field)).toBeNull();
    }
  });

  it('leaves Down and Up with Alt or Ctrl, and other keys, alone', () => {
    expect(fieldStep({ ...keys, key: 'ArrowUp', altKey: true }, 5, field)).toBeNull();
    expect(fieldStep({ ...keys, key: 'ArrowDown', ctrlKey: true }, 5, field)).toBeNull();
    expect(fieldStep({ ...keys, key: ' ' }, 5, field)).toBeNull();
  });

  it('stops at the ends of a field with a range', () => {
    const ranged = { ...field, min: -36, max: 36 };
    expect(fieldStep({ ...keys, key: 'ArrowUp', shiftKey: true }, 30, ranged)).toBe(36);
    expect(fieldStep({ ...keys, key: 'ArrowDown', shiftKey: true }, -30, ranged)).toBe(-36);
  });
});

group('fieldInRange', () => {
  it('keeps a value typed within the range, if the field has one', () => {
    expect(fieldInRange(50, { min: -36, max: 36 })).toBe(36);
    expect(fieldInRange(-50, { min: -36, max: 36 })).toBe(-36);
    expect(fieldInRange(-4.5, { min: -36, max: 36 })).toBe(-4.5);
    expect(fieldInRange(5000, {})).toBe(5000);
  });
});

group('fieldHint', () => {
  const field = { step: 1, shiftStep: 10, unit: 'ms' };

  it('names the keys that step a field, as this platform does', () => {
    expect(fieldHint(field, new KeyHints('other', () => true))).toBe(
      '↑ or ↓ steps it by 1 ms, or by 10 with Shift+↑ or Shift+↓',
    );
    expect(fieldHint(field, new KeyHints('mac', () => true))).toBe('↑ or ↓ steps it by 1 ms, or by 10 with ⇧↑ or ⇧↓');
  });

  it('gives no hint without a fine pointer', () => {
    expect(fieldHint(field, new KeyHints('other', () => false))).toBeUndefined();
  });
});

group('opensMenu', () => {
  const keys = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

  it('opens on the Menu key and Shift+F10, as a context menu does', () => {
    expect(opensMenu({ ...keys, key: 'ContextMenu' })).toBe(true);
    expect(opensMenu({ ...keys, key: 'F10', shiftKey: true })).toBe(true);
  });

  it('leaves F10 alone, and other keys', () => {
    expect(opensMenu({ ...keys, key: 'F10' })).toBe(false);
    expect(opensMenu({ ...keys, key: 'F10', shiftKey: true, ctrlKey: true })).toBe(false);
    expect(opensMenu({ ...keys, key: 'Enter' })).toBe(false);
  });

  it('takes the Menu key only on its own', () => {
    expect(opensMenu({ ...keys, key: 'ContextMenu', ctrlKey: true })).toBe(false);
    expect(opensMenu({ ...keys, key: 'ContextMenu', shiftKey: true })).toBe(false);
  });
});
